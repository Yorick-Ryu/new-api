package service

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/google/uuid"
)

const ImageStudioMaxReferenceBytes = 20 << 20
const ImageStudioMaxGeneratedBytes = 40 << 20
const ImageStudioMaxStorageBytes int64 = 4 << 30

var imageStudioStorageMu sync.Mutex

// ImageStudioStore is private, bounded delivery storage. Browsers keep their
// own history; these files are removed by the worker after their 24-hour TTL.
// Keep this directory on a persistent volume, shared by workers serving one DB.
type ImageStudioStore struct {
	directory string
}

func NewImageStudioStore() (*ImageStudioStore, error) {
	directory := common.GetEnvOrDefaultString("IMAGE_STUDIO_STORAGE_DIR", "./data/image-studio/files")
	if err := os.MkdirAll(directory, 0700); err != nil {
		return nil, errors.New("image storage is unavailable")
	}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, errors.New("image storage is unavailable")
	}
	root.Close()
	return &ImageStudioStore{directory: directory}, nil
}

func validImageStudioObjectKey(key string) bool {
	return filepath.IsLocal(key) && !strings.ContainsAny(key, "\\\x00") &&
		!strings.Contains(key, "..") && (strings.HasPrefix(key, "references/") || strings.HasPrefix(key, "generated/"))
}

// AvailableCapacity is checked before charging; Put also enforces the hard cap.
func (s *ImageStudioStore) AvailableCapacity(bytes int64) error {
	var used int64
	err := filepath.WalkDir(s.directory, func(_ string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.Type().IsRegular() {
			info, err := entry.Info()
			if err != nil {
				return err
			}
			used += info.Size()
			if used > ImageStudioMaxStorageBytes-bytes {
				return errors.New("image storage is temporarily full")
			}
		}
		return nil
	})
	return err
}

func (s *ImageStudioStore) Put(ctx context.Context, key string, data []byte, _ string) error {
	if !validImageStudioObjectKey(key) || len(data) > ImageStudioMaxGeneratedBytes {
		return errors.New("invalid image storage request")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	imageStudioStorageMu.Lock()
	defer imageStudioStorageMu.Unlock()
	if err := s.AvailableCapacity(int64(len(data))); err != nil {
		return err
	}
	root, err := os.OpenRoot(s.directory)
	if err != nil {
		return errors.New("image storage is unavailable")
	}
	defer root.Close()
	if err := root.MkdirAll(filepath.Dir(key), 0700); err != nil {
		return errors.New("image storage is unavailable")
	}
	temporary := filepath.Join(filepath.Dir(key), "."+uuid.NewString()+".partial")
	file, err := root.OpenFile(temporary, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return errors.New("image storage is unavailable")
	}
	defer root.Remove(temporary)
	_, writeErr := file.Write(data)
	syncErr := file.Sync()
	closeErr := file.Close()
	if writeErr != nil || syncErr != nil || closeErr != nil {
		return errors.New("image storage write failed")
	}
	return root.Rename(temporary, key)
}

func (s *ImageStudioStore) Delete(ctx context.Context, key string) error {
	if !validImageStudioObjectKey(key) {
		return errors.New("invalid image storage request")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	root, err := os.OpenRoot(s.directory)
	if err != nil {
		return errors.New("image storage is unavailable")
	}
	defer root.Close()
	if err := root.Remove(key); err != nil && !os.IsNotExist(err) {
		return errors.New("image storage delete failed")
	}
	if strings.HasPrefix(key, "generated/") {
		_ = root.Remove(filepath.Dir(key)) // Remove an empty job directory only.
	}
	return nil
}

// CleanupPartials removes only interrupted atomic writes, never active assets.
func (s *ImageStudioStore) CleanupPartials(before time.Time) {
	root, err := os.OpenRoot(s.directory)
	if err != nil {
		return
	}
	defer root.Close()
	_ = fs.WalkDir(root.FS(), ".", func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() || !strings.HasPrefix(entry.Name(), ".") || !strings.HasSuffix(entry.Name(), ".partial") {
			return nil
		}
		if info, err := entry.Info(); err == nil && info.ModTime().Before(before) {
			_ = root.Remove(path)
		}
		return nil
	})
}

func (s *ImageStudioStore) Get(ctx context.Context, key string) ([]byte, error) {
	if !validImageStudioObjectKey(key) {
		return nil, errors.New("invalid image storage request")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(s.directory)
	if err != nil {
		return nil, errors.New("image storage is unavailable")
	}
	defer root.Close()
	file, err := root.Open(key)
	if err != nil {
		return nil, errors.New("image cannot be read")
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, ImageStudioMaxGeneratedBytes+1))
	if err != nil || len(data) > ImageStudioMaxGeneratedBytes {
		return nil, errors.New("image cannot be read")
	}
	return data, nil
}
