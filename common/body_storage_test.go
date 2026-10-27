package common

import (
	"bytes"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBodyStorageWriterReplayAndCleanup(t *testing.T) {
	config := GetDiskCacheConfig()
	t.Cleanup(func() { SetDiskCacheConfig(config) })
	for _, disk := range []bool{false, true} {
		t.Run(map[bool]string{false: "memory", true: "spill"}[disk], func(t *testing.T) {
			SetDiskCacheConfig(DiskCacheConfig{Enabled: disk, ThresholdMB: 1, MaxSizeMB: 16, Path: t.TempDir()})
			payload := bytes.Repeat([]byte("body"), (1<<20)/4)
			var writer BodyStorageWriter
			defer writer.Close()
			_, err := writer.Write(payload[:len(payload)-1])
			require.NoError(t, err)
			_, err = writer.Write(payload[len(payload)-1:])
			require.NoError(t, err)
			storage, err := writer.Finish()
			require.NoError(t, err)
			defer storage.Close()
			assert.Equal(t, disk, storage.IsDisk())
			assert.EqualValues(t, len(payload), storage.Size())
			require.NoError(t, writer.Close(), "ownership transferred to storage")
			_, err = writer.Write([]byte("late"))
			require.ErrorIs(t, err, ErrStorageClosed)
			first, err := storage.NewReader()
			require.NoError(t, err)
			defer first.Close()
			_, err = first.Read(make([]byte, 7))
			require.NoError(t, err)
			second, err := storage.NewReader()
			require.NoError(t, err)
			got, err := io.ReadAll(second)
			require.NoError(t, err)
			require.NoError(t, second.Close())
			assert.Equal(t, payload, got, "independent replay cursor")
			require.NoError(t, storage.Close())
			_, err = storage.NewReader()
			require.ErrorIs(t, err, ErrStorageClosed)
			files, _, err := GetDiskCacheInfo()
			require.NoError(t, err)
			assert.Zero(t, files)
		})
	}
}

func TestBodyStorageWriterFailures(t *testing.T) {
	config := GetDiskCacheConfig()
	t.Cleanup(func() { SetDiskCacheConfig(config) })
	for _, mode := range []string{"abort", "write error", "create error"} {
		t.Run(mode, func(t *testing.T) {
			path := t.TempDir()
			if mode == "create error" {
				path = filepath.Join(path, "not-a-directory")
				require.NoError(t, os.WriteFile(path, nil, 0600))
			}
			SetDiskCacheConfig(DiskCacheConfig{Enabled: true, ThresholdMB: 0, MaxSizeMB: 16, Path: path})
			var writer BodyStorageWriter
			defer writer.Close()
			_, err := writer.Write([]byte("payload"))
			require.NoError(t, err)
			if mode == "create error" {
				storage, err := writer.Finish()
				require.NoError(t, err)
				defer storage.Close()
				assert.False(t, storage.IsDisk())
				got, err := storage.Bytes()
				require.NoError(t, err)
				assert.Equal(t, "payload", string(got))
				return
			}
			if mode == "write error" {
				require.NoError(t, writer.file.Close())
				_, err = writer.Write([]byte("tail"))
				require.Error(t, err)
				storage, err := writer.Finish()
				require.Error(t, err)
				assert.Nil(t, storage, "never replay a truncated output")
			}
			_ = writer.Close()
			files, _, err := GetDiskCacheInfo()
			require.NoError(t, err)
			assert.Zero(t, files, "abort and write failure must unlink temporary output")
		})
	}
}

func TestNewReplayableBodyReaderKeepsStorageLifecycleWithCaller(t *testing.T) {
	payload := []byte(`{"model":"test-model","input":"hello"}`)
	storage, err := CreateBodyStorage(payload)
	require.NoError(t, err)
	defer storage.Close()

	body := NewReplayableBodyReader(storage)
	assert.EqualValues(t, len(payload), body.Size())
	_, exposesCloser := any(body).(io.Closer)
	assert.False(t, exposesCloser, "the request body must not expose the storage closer")

	req, err := http.NewRequest(http.MethodPost, "https://example.com", body)
	require.NoError(t, err)
	require.NoError(t, req.Body.Close())

	replayBody, err := body.NewReader()
	require.NoError(t, err, "closing the HTTP request body must not close the storage")
	replay, err := io.ReadAll(replayBody)
	require.NoError(t, err)
	require.NoError(t, replayBody.Close())
	assert.Equal(t, payload, replay)

	require.NoError(t, storage.Close())
	_, err = body.NewReader()
	require.ErrorIs(t, err, ErrStorageClosed)
}
