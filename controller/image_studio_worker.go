package controller

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	taskdto "github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	imagedto "github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/image/draw"
)

const imageStudioResponseLimit = 224 << 20

type imageStudioWorker struct {
	store            *service.ImageStudioStore
	directory, owner string
}

// Results are spooled to a persistent, bounded directory before publishing local delivery files.
// Recovery only replays storage operations, never an upstream generation.
func StartImageStudioWorker() {
	store, err := service.NewImageStudioStore()
	if err != nil {
		return
	}
	directory := common.GetEnvOrDefaultString("IMAGE_STUDIO_SPOOL_DIR", "./data/image-studio/spool")
	if err = os.MkdirAll(directory, 0700); err != nil {
		common.SysError("image studio spool directory is unavailable")
		return
	}
	ownerPath := filepath.Join(directory, ".owner")
	ownerBytes, err := os.ReadFile(ownerPath)
	if os.IsNotExist(err) {
		// Publish the identity atomically; it survives container replacement and
		// competing starters sharing the same persistent volume.
		file, createErr := os.CreateTemp(directory, ".owner-")
		if createErr != nil {
			common.SysError("image studio worker identity is unavailable")
			return
		}
		name := file.Name()
		_, writeErr := file.WriteString(uuid.NewString())
		closeErr := file.Close()
		if writeErr == nil && closeErr == nil {
			_ = os.Link(name, ownerPath)
		}
		_ = os.Remove(name)
		ownerBytes, err = os.ReadFile(ownerPath)
	}
	if err != nil {
		common.SysError("image studio worker identity is unavailable")
		return
	}
	owner := strings.TrimSpace(string(ownerBytes))
	if _, err := uuid.Parse(owner); err != nil {
		common.SysError("image studio worker identity is invalid")
		return
	}
	worker := &imageStudioWorker{store: store, directory: directory, owner: owner}
	for range 2 {
		go worker.run()
	}
	go func() {
		for {
			worker.cleanup()
			time.Sleep(time.Minute)
		}
	}()
}

func (w *imageStudioWorker) run() {
	for {
		job, err := model.ClaimImageStudioJob(w.owner, time.Now().Unix())
		if err != nil {
			common.SysError("image studio task lookup failed")
		}
		if job == nil {
			time.Sleep(3 * time.Second)
			continue
		}
		w.execute(job)
	}
}

func (w *imageStudioWorker) setStatus(job *model.ImageStudioJob, status, message string) {
	result := model.DB.Model(&model.ImageStudioJob{}).Where("id = ? AND owner = ? AND status IN ?", job.ID, w.owner, []string{"running", "saving"}).Updates(map[string]any{"status": status, "error": message, "lease_until": time.Now().Add(time.Minute).Unix(), "updated_at": time.Now().Unix()})
	if result.Error != nil {
		common.SysError("image studio task update failed")
	}
}

func (w *imageStudioWorker) execute(job *model.ImageStudioJob) {
	defer func() {
		if err := model.RefreshImageStudioGroup(job.ParentID); err != nil {
			common.SysError("image studio group update failed")
		}
	}()
	defer func() {
		if recover() != nil {
			w.setStatus(job, "unknown", "Image result could not be confirmed")
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	path := filepath.Join(w.directory, job.ID+".json")
	if job.Status == "running" {
		if err := w.generate(ctx, job, path); err != nil {
			return
		}
	}
	if err := w.persist(ctx, job, path); err != nil {
		w.setStatus(job, "saving", "Image saving failed; retrying automatically")
		return
	}
	_ = os.Remove(path)
	cached, _ := filepath.Glob(filepath.Join(w.directory, job.ID+"-*.image"))
	for _, file := range cached {
		_ = os.Remove(file)
	}
}

// This handler is in-process only and has no public listener. Identity comes
// exclusively from the owned DB job. The dedicated key stays on the server.
func (w *imageStudioWorker) generate(ctx context.Context, job *model.ImageStudioJob, path string) error {
	var input imageStudioInput
	if err := common.Unmarshal([]byte(job.Request), &input); err != nil {
		w.setStatus(job, "failed", "Invalid image parameters")
		return err
	}
	token, err := model.GetTokenByIds(job.TokenID, job.UserID)
	if err != nil || token.Group != "default" {
		w.setStatus(job, "failed", "Image API key is unavailable")
		return errors.New("image token unavailable")
	}
	capabilities, err := imageStudioCapabilities(job.UserID)
	if err == nil {
		err = validateImageStudioInput(input, capabilities)
	}
	if err != nil {
		w.setStatus(job, "failed", "Image model is unavailable")
		return err
	}
	if strings.HasPrefix(input.Model, "gpt-image-") {
		if input.Quality == "" {
			input.Quality = "auto"
		}
		if input.Size == "" {
			input.Size = "auto"
		}
	}
	var body bytes.Buffer
	requestPath := "/v1/images/generations"
	contentType := "application/json"
	referenceIDs, _ := imageStudioReferences(input) // Validated above, including legacy single references.
	if len(referenceIDs) > 0 {
		writer := multipart.NewWriter(&body)
		for key, value := range map[string]string{"model": input.Model, "prompt": input.Prompt, "n": strconv.Itoa(int(input.N)), "size": input.Size, "quality": input.Quality} {
			if value != "" {
				if err = writer.WriteField(key, value); err != nil {
					return err
				}
			}
		}
		fieldName := "image"
		if len(referenceIDs) > 1 {
			fieldName = "image[]"
		}
		for i, id := range referenceIDs {
			var reference model.ImageStudioAsset
			// An active job protects its already validated references even when
			// their original upload expiry passes while it waits in the queue.
			err = model.DB.Where("id = ? AND user_id = ? AND kind = ?", id, job.UserID, "reference").First(&reference).Error
			if err != nil {
				w.setStatus(job, "failed", "Reference image is unavailable")
				return err
			}
			data, err := w.store.Get(ctx, reference.ObjectKey)
			if err != nil || len(data) > service.ImageStudioMaxReferenceBytes {
				w.setStatus(job, "failed", "Reference image is unavailable")
				return errors.New("reference image cannot be read")
			}
			ext := "png"
			if reference.Mime == "image/jpeg" {
				ext = "jpg"
			}
			if reference.Mime == "image/webp" {
				ext = "webp"
			}
			part, err := writer.CreateFormFile(fieldName, fmt.Sprintf("reference-%d.%s", i+1, ext))
			if err != nil {
				return err
			}
			if _, err = part.Write(data); err != nil {
				return err
			}
		}
		if err = writer.Close(); err != nil {
			return err
		}
		contentType = writer.FormDataContentType()
		requestPath = "/v1/images/edits"
	} else {
		payload := imagedto.ImageRequest{Model: input.Model, Prompt: input.Prompt, N: &input.N, Size: input.Size, Quality: input.Quality}
		encoded, err := common.Marshal(payload)
		if err != nil {
			return err
		}
		body.Write(encoded)
	}
	// Refuse additional work when unsaved local results reach the fixed 1 GiB cap.
	entries, _ := os.ReadDir(w.directory)
	var diskBytes int64
	for _, entry := range entries {
		if info, e := entry.Info(); e == nil {
			diskBytes += info.Size()
		}
	}
	if diskBytes > (1<<30)-2*(imageStudioResponseLimit+4*service.ImageStudioMaxGeneratedBytes) || w.store.AvailableCapacity(2*(4*service.ImageStudioMaxGeneratedBytes+4*(1<<20))) != nil {
		w.setStatus(job, "failed", "Image storage is temporarily busy")
		return errors.New("spool full")
	}
	file, err := os.OpenFile(path+".partial", os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		w.setStatus(job, "failed", "Image storage is temporarily busy")
		return err
	}
	defer file.Close()
	defer os.Remove(path + ".partial")
	response := &imageStudioResponseWriter{header: make(http.Header), file: file, status: 200}
	engine := gin.New()
	engine.Use(middleware.BodyStorageCleanup())
	_ = engine.SetTrustedProxies(nil)
	engine.Use(func(c *gin.Context) {
		c.Set(common.RequestIdKey, job.ID)
		c.Next()
	})
	engine.POST(requestPath, middleware.TokenAuth(), middleware.SystemPerformanceCheck(), middleware.ModelRequestRateLimit(), middleware.Distribute(), func(c *gin.Context) {
		service.GetChannelConstraints(c).AddPin(taskdto.ChannelPin{ChannelId: c.GetInt("channel_id"), Source: taskdto.PinSourceOriginTask, Rank: taskdto.PinRankOriginTask, RetryMode: taskdto.PinRetrySingleAttempt})
		// Workbench jobs always use wallet funding. Override only this authenticated
		// request's settings copy, never the user's saved billing preference.
		settings, _ := common.GetContextKeyType[imagedto.UserSetting](c, constant.ContextKeyUserSetting)
		settings.BillingPreference = "wallet_only"
		common.SetContextKey(c, constant.ContextKeyUserSetting, settings)
		Relay(c, types.RelayFormatOpenAIImage)
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, requestPath, &body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Authorization", "Bearer "+token.Key)
	req.RemoteAddr = net.JoinHostPort(job.ClientIP, "0")
	engine.ServeHTTP(response, req)
	if response.status >= 400 {
		status, message := classifyImageStudioFailure(response.status, response.errorBody)
		w.setStatus(job, status, message)
		return errors.New("image relay failed")
	}
	if response.err != nil || file.Sync() != nil {
		w.setStatus(job, "unknown", "Image result could not be confirmed")
		return errors.New("spool write failed")
	}
	if err = file.Close(); err != nil {
		return err
	}
	if err = os.Rename(path+".partial", path); err != nil {
		w.setStatus(job, "unknown", "Image result could not be confirmed")
		return err
	}
	job.ExpiresAt = time.Now().Add(model.ImageStudioRetention).Unix()
	job.Status = "saving"
	result := model.DB.Model(&model.ImageStudioJob{}).Where("id = ? AND status = ? AND owner = ?", job.ID, "running", w.owner).Updates(map[string]any{"status": "saving", "expires_at": job.ExpiresAt})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errors.New("image task state changed")
	}
	return nil
}

type imageStudioResponseWriter struct {
	header    http.Header
	file      *os.File
	status    int
	size      int
	err       error
	errorBody []byte
}

func (w *imageStudioResponseWriter) Header() http.Header    { return w.header }
func (w *imageStudioResponseWriter) WriteHeader(status int) { w.status = status }
func (w *imageStudioResponseWriter) Write(data []byte) (int, error) {
	// Retain only a bounded error envelope for classification. Never expose its
	// upstream message (which may contain credentials) in the task record.
	if w.status >= 400 && len(w.errorBody) < (64<<10)+1 {
		w.errorBody = append(w.errorBody, data[:min(len(data), (64<<10)+1-len(w.errorBody))]...)
	}
	if w.size+len(data) > imageStudioResponseLimit {
		w.err = errors.New("image result exceeds size limit")
		return 0, w.err
	}
	n, err := w.file.Write(data)
	w.size += n
	if err != nil {
		w.err = err
	}
	return n, err
}
func (w *imageStudioResponseWriter) Flush() {}

type imageStudioPayload struct {
	URL    string `json:"url"`
	Base64 string `json:"b64_json"`
}

func decodeImageStudioResponse(data []byte) ([]imageStudioPayload, error) {
	var envelope struct {
		Data json.RawMessage `json:"data"`
	}
	if err := common.Unmarshal(data, &envelope); err != nil {
		return nil, err
	}
	var items []imageStudioPayload
	raw := bytes.TrimSpace(envelope.Data)
	if len(raw) > 0 && raw[0] == '{' {
		var item imageStudioPayload
		if err := common.Unmarshal(raw, &item); err != nil {
			return nil, err
		}
		items = append(items, item)
	} else {
		if err := common.Unmarshal(raw, &items); err != nil {
			return nil, err
		}
	}
	// Prefer the base64 representation when a provider splits URL/base64 entries.
	var encoded, urls []imageStudioPayload
	for _, item := range items {
		if item.Base64 != "" {
			encoded = append(encoded, item)
		} else if item.URL != "" {
			urls = append(urls, item)
		}
	}
	if len(encoded) >= len(urls) {
		items = encoded
	} else {
		items = urls
	}
	if len(items) == 0 || len(items) > 4 {
		return nil, errors.New("no usable images")
	}
	return items, nil
}

func (w *imageStudioWorker) persist(ctx context.Context, job *model.ImageStudioJob, path string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	items, err := decodeImageStudioResponse(raw)
	if err != nil {
		w.setStatus(job, "unknown", "Image result could not be confirmed")
		return nil
	}
	assets := make([]model.ImageStudioAsset, 0, len(items)*2)
	for i, item := range items {
		cachedPath := filepath.Join(w.directory, fmt.Sprintf("%s-%d.image", job.ID, i))
		data, cacheErr := os.ReadFile(cachedPath)
		if cacheErr != nil && !os.IsNotExist(cacheErr) {
			return cacheErr
		}
		if cacheErr == nil {
			err = nil
		} else if item.Base64 != "" {
			data, err = base64.StdEncoding.DecodeString(item.Base64)
		} else {
			if err = service.ValidateSSRFProtectedFetchURL(item.URL); err != nil {
				return errors.New("image download blocked")
			}
			req, e := http.NewRequestWithContext(ctx, http.MethodGet, item.URL, nil)
			if e != nil {
				return e
			}
			res, e := service.GetSSRFProtectedHTTPClient().Do(req)
			if e != nil {
				return errors.New("image download failed")
			}
			if res.StatusCode != 200 {
				res.Body.Close()
				return errors.New("image download failed")
			}
			data, err = io.ReadAll(io.LimitReader(res.Body, service.ImageStudioMaxGeneratedBytes+1))
			res.Body.Close()
		}
		if err != nil || len(data) > service.ImageStudioMaxGeneratedBytes {
			return errors.New("invalid image payload")
		}
		_, err = imageStudioMime(data)
		if err != nil {
			return err
		}
		if cacheErr != nil {
			if err := os.WriteFile(cachedPath+".partial", data, 0600); err != nil {
				return err
			}
			if err := os.Rename(cachedPath+".partial", cachedPath); err != nil {
				return err
			}
		}
	}
	// Cache every image before publishing delivery files; a disk error must not make
	// later images depend on short-lived upstream URLs on the next attempt.
	for i := range items {
		data, err := os.ReadFile(filepath.Join(w.directory, fmt.Sprintf("%s-%d.image", job.ID, i)))
		if err != nil {
			return err
		}
		mime, err := imageStudioMime(data)
		if err != nil {
			return err
		}
		decoded, _, err := image.Decode(bytes.NewReader(data))
		if err != nil {
			return err
		}
		bounds := decoded.Bounds()
		width := min(512, bounds.Dx())
		height := max(1, bounds.Dy()*width/bounds.Dx())
		thumb := image.NewRGBA(image.Rect(0, 0, width, height))
		draw.ApproxBiLinear.Scale(thumb, thumb.Bounds(), decoded, bounds, draw.Src, nil)
		var preview bytes.Buffer
		if err = jpeg.Encode(&preview, thumb, &jpeg.Options{Quality: 80}); err != nil {
			return err
		}
		for _, variant := range []struct {
			kind, mime string
			data       []byte
		}{{"original", mime, data}, {"thumbnail", "image/jpeg", preview.Bytes()}} {
			id := fmt.Sprintf("%s-%d-%s", job.ID, i, variant.kind)
			asset := model.ImageStudioAsset{ID: id, UserID: job.UserID, JobID: job.ID, Kind: variant.kind, ObjectKey: "generated/" + job.ID + "/" + fmt.Sprintf("%d-%s", i, variant.kind), Mime: variant.mime, Size: int64(len(variant.data)), CreatedAt: time.Now().Unix(), ExpiresAt: job.ExpiresAt}
			// Register the key first, so cleanup also finds partial storage attempts.
			if err = model.DB.Where("id = ?", id).FirstOrCreate(&asset).Error; err != nil {
				return err
			}
			if err = w.store.Put(ctx, asset.ObjectKey, variant.data, variant.mime); err != nil {
				return err
			}
			assets = append(assets, asset)
		}
	}
	return model.SaveImageStudioAssets(job, assets)
}

func (w *imageStudioWorker) cleanup() {
	now := time.Now().Unix()
	w.store.CleanupPartials(time.Now().Add(-model.ImageStudioRetention))
	var interrupted []model.ImageStudioJob
	if err := model.DB.Where("status IN ? AND lease_until < ?", []string{"running", "unknown"}, now).Limit(100).Find(&interrupted).Error; err != nil {
		return
	}
	for _, job := range interrupted {
		status := "unknown"
		expires := int64(0)
		if job.Owner == w.owner {
			if info, err := os.Stat(filepath.Join(w.directory, job.ID+".json")); err == nil {
				status = "saving"
				expires = info.ModTime().Add(model.ImageStudioRetention).Unix()
			}
		}
		model.DB.Model(&model.ImageStudioJob{}).Where("id = ? AND status = ? AND lease_until < ?", job.ID, job.Status, now).Updates(map[string]any{"status": status, "expires_at": expires, "error": "Image result could not be confirmed"})
	}
	model.DB.Model(&model.ImageStudioJob{}).Where("status = ? AND created_at < ?", "queued", now-int64(model.ImageStudioRetention.Seconds())).Updates(map[string]any{"status": "failed", "error": "Image task expired before generation"})
	model.DB.Model(&model.ImageStudioJob{}).Where("expires_at > 0 AND expires_at <= ? AND status IN ?", now, []string{"success", "saving"}).Updates(map[string]any{"status": "expired", "error": ""})
	activeJobs := model.DB.Model(&model.ImageStudioJob{}).Select("id").Where("status IN ?", []string{"queued", "running", "saving"})
	activeRefs := model.DB.Model(&model.ImageStudioJobReference{}).Select("asset_id").Where("job_id IN (?)", activeJobs)
	legacyRefs := model.DB.Model(&model.ImageStudioJob{}).Select("reference_id").Where("status IN ? AND reference_id <> ''", []string{"queued", "running", "saving"})
	var assets []model.ImageStudioAsset
	if err := model.DB.Where("expires_at <= ? AND id NOT IN (?) AND id NOT IN (?)", now, activeRefs, legacyRefs).Limit(100).Find(&assets).Error; err == nil {
		for _, asset := range assets {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			err := w.store.Delete(ctx, asset.ObjectKey)
			cancel()
			if err == nil {
				_ = model.DeleteExpiredImageStudioAsset(asset.ID, now)
			}
		}
	}
	entries, _ := os.ReadDir(w.directory)
	for _, entry := range entries {
		if entry.IsDir() || !(strings.HasSuffix(entry.Name(), ".json") || strings.HasSuffix(entry.Name(), ".partial") || strings.HasSuffix(entry.Name(), ".image")) {
			continue
		}
		if info, err := entry.Info(); err == nil && info.ModTime().Add(model.ImageStudioRetention).Unix() <= now {
			_ = os.Remove(filepath.Join(w.directory, entry.Name()))
		}
	}
	// Reconcile parents after interrupted or expired children, including crashes
	// between publishing a child result and updating its parent.
	var groups []model.ImageStudioJob
	if model.DB.Where("status = ?", "group").Find(&groups).Error == nil {
		for _, group := range groups {
			_ = model.RefreshImageStudioGroup(group.ID)
		}
	}
	// Server prompt/parameter rows are delivery metadata, not browser history.
	// Billing logs keep the normal system retention policy.
	_ = model.DeleteOldImageStudioJobs(now - int64(model.ImageStudioRetention.Seconds()))
}

// classifyImageStudioFailure separates definite rejections from requests whose
// completion cannot be established. An arbitrary 5xx response is not evidence
// that retrying a paid generation would be safe.
func classifyImageStudioFailure(status int, body []byte) (string, string) {
	failed := "Image generation failed; check usage logs"
	unavailable := "Image generation failed; service temporarily unavailable. Please try again later."
	if status == http.StatusRequestTimeout || status == http.StatusGatewayTimeout {
		return "unknown", "Image result could not be confirmed"
	}
	if status < 500 {
		if status == http.StatusUnauthorized || status == http.StatusForbidden || status == http.StatusTooManyRequests {
			return "failed", unavailable
		}
		return "failed", failed
	}
	var envelope struct {
		Error types.OpenAIError `json:"error"`
	}
	if len(body) <= 64<<10 && common.Unmarshal(body, &envelope) == nil {
		code, _ := envelope.Error.Code.(string)
		for _, marker := range []string{code, envelope.Error.Type} {
			switch marker {
			case "auth_unavailable", "authentication_error", "refresh_token_reused", "channel:no_available_key", "channel:invalid_key", "get_channel_failed", "insufficient_quota", "rate_limit_exceeded":
				return "failed", unavailable
			}
		}
		// Some OpenAI-compatible relays preserve the CPA error identifier only
		// at the start of the message. Do not match arbitrary text or HTML.
		if strings.HasPrefix(strings.TrimSpace(envelope.Error.Message), "auth_unavailable:") {
			return "failed", unavailable
		}
	}
	return "unknown", "Image result could not be confirmed"
}
