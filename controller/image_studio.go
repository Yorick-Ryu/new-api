package controller

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	imagedto "github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	_ "golang.org/x/image/webp"
	"gorm.io/gorm"
)

type imageStudioInput struct {
	Model        string   `json:"model"`
	Prompt       string   `json:"prompt"`
	Size         string   `json:"size,omitempty"`
	Quality      string   `json:"quality,omitempty"`
	N            uint     `json:"n"`
	ReferenceID  string   `json:"reference_id,omitempty"`
	ReferenceIDs []string `json:"reference_ids,omitempty"`
}

type imageStudioCapability struct {
	Model      string   `json:"model"`
	Sizes      []string `json:"sizes"`
	Qualities  []string `json:"qualities"`
	MaxCount   uint     `json:"max_count"`
	Editing    bool     `json:"editing"`
	CustomSize bool     `json:"custom_size"`
}

func imageStudioCapabilities(userID int) ([]imageStudioCapability, error) {
	user, err := model.GetUserCache(userID)
	if err != nil {
		return nil, err
	}
	if user.Status != common.UserStatusEnabled || !service.IsUserSelectableGroup(user.Group, "default") {
		return nil, errors.New("Default group is unavailable for this account")
	}
	models := service.GetGroupsEnabledModels([]string{"default"})
	result := make([]imageStudioCapability, 0)
	for _, name := range models {
		if !slices.Contains(model.GetModelSupportEndpointTypes(name), constant.EndpointTypeImageGeneration) {
			continue
		}
		capability := imageStudioCapability{Model: name, Sizes: []string{""}, Qualities: []string{""}, MaxCount: 1}
		// Conservative defaults for unknown models: omit optional parameters.
		switch {
		case strings.HasPrefix(name, "gpt-image-"):
			capability.Sizes = []string{"", "1024x1024", "1536x1024", "1024x1536"}
			if strings.HasPrefix(name, "gpt-image-2") {
				capability.Sizes = []string{"", "1024x1024", "1536x864", "864x1536"}
				capability.CustomSize = true
			}
			capability.Qualities = []string{"", "low", "medium", "high"}
			capability.MaxCount = 4
			capability.Editing = true
		case name == "dall-e-3":
			capability.Sizes = []string{"", "1024x1024", "1792x1024", "1024x1792"}
			capability.Qualities = []string{"", "standard", "hd"}
		}
		result = append(result, capability)
	}
	return result, nil
}

func ImageStudioOptions(c *gin.Context) {
	capabilities, err := imageStudioCapabilities(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	_, storeErr := service.NewImageStudioStore()
	common.ApiSuccess(c, gin.H{"models": capabilities, "available": storeErr == nil})
}

func validateImageStudioInput(input imageStudioInput, capabilities []imageStudioCapability) error {
	if strings.TrimSpace(input.Prompt) == "" || utf8.RuneCountInString(input.Prompt) > 16000 || input.N < 1 || input.N > imagedto.MaxImageN {
		return errors.New("Invalid image parameters")
	}
	references, err := imageStudioReferences(input)
	if err != nil {
		return err
	}
	for _, capability := range capabilities {
		if capability.Model != input.Model {
			continue
		}
		if input.N > capability.MaxCount || !slices.Contains(capability.Qualities, input.Quality) || len(references) > 0 && !capability.Editing {
			return errors.New("Unsupported image parameters")
		}
		if !slices.Contains(capability.Sizes, input.Size) {
			if !capability.CustomSize {
				return errors.New("Unsupported image parameters")
			}
			if !validImageStudioCustomSize(input.Size) {
				return errors.New("Custom image dimensions must be multiples of 16, no larger than 3840 pixels per edge, with 655,360 to 8,294,400 total pixels and an aspect ratio between 1:3 and 3:1.")
			}
		}
		return nil
	}
	return errors.New("Image model is unavailable")
}

func imageStudioReferences(input imageStudioInput) ([]string, error) {
	if input.ReferenceID != "" && len(input.ReferenceIDs) > 0 {
		return nil, errors.New("Reference image selections conflict")
	}
	ids := input.ReferenceIDs
	if input.ReferenceID != "" {
		ids = []string{input.ReferenceID}
	}
	if err := model.ValidateImageStudioReferenceIDs(ids); err != nil {
		return nil, errors.New("Use up to 4 different reference images")
	}
	return ids, nil
}

func validImageStudioCustomSize(size string) bool {
	widthText, heightText, found := strings.Cut(size, "x")
	if !found {
		return false
	}
	width, widthErr := strconv.ParseUint(widthText, 10, 64)
	height, heightErr := strconv.ParseUint(heightText, 10, 64)
	if widthErr != nil || heightErr != nil || width == 0 || height == 0 || width > 3840 || height > 3840 || width%16 != 0 || height%16 != 0 {
		return false
	}
	// Divide before comparing so even maximum uint64 dimensions cannot overflow.
	if width > 8_294_400/height {
		return false
	}
	if width*height < 655_360 { // Both edges are already bounded before multiplying.
		return false
	}
	longSide, shortSide := max(width, height), min(width, height)
	ratio, remainder := longSide/shortSide, longSide%shortSide
	return ratio < 3 || ratio == 3 && remainder == 0
}

func CreateImageStudioJob(c *gin.Context) {
	if c.GetBool("use_access_token") {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "Image generation requires a dashboard session"})
		return
	}
	if c.ContentType() != "application/json" {
		c.JSON(http.StatusUnsupportedMediaType, gin.H{"success": false, "message": "Use application/json for image requests"})
		return
	}
	if _, err := service.NewImageStudioStore(); err != nil {
		c.JSON(503, gin.H{"success": false, "message": "Image storage is unavailable"})
		return
	}
	requestKey := c.GetHeader("Idempotency-Key")
	if _, err := uuid.Parse(requestKey); err != nil {
		c.JSON(400, gin.H{"success": false, "message": "Invalid request key"})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 96<<10)
	var input imageStudioInput
	if err := common.DecodeJson(c.Request.Body, &input); err != nil {
		c.JSON(400, gin.H{"success": false, "message": "Invalid image parameters"})
		return
	}
	capabilities, err := imageStudioCapabilities(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err = validateImageStudioInput(input, capabilities); err != nil {
		c.JSON(400, gin.H{"success": false, "message": err.Error()})
		return
	}
	imageModels := make([]string, 0, len(capabilities))
	for _, capability := range capabilities {
		imageModels = append(imageModels, capability.Model)
	}
	token, err := model.GetOrCreateImageStudioToken(c.GetInt("id"), imageModels)
	if err != nil {
		message := "Unable to prepare image API key"
		if errors.Is(err, model.ErrImageStudioTokenLimit) {
			message = err.Error()
		}
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": message})
		return
	}
	if token.Group != "default" {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "Image API key must use the default group"})
		return
	}
	// Reuse the complete relay authentication path, including status, expiry,
	// balance, current user permissions and the actual client's IP restriction.
	authorization := c.Request.Header.Get("Authorization")
	c.Request.Header.Set("Authorization", "Bearer "+token.Key)
	middleware.TokenAuth()(c)
	if authorization == "" {
		c.Request.Header.Del("Authorization")
	} else {
		c.Request.Header.Set("Authorization", authorization)
	}
	if c.IsAborted() {
		return
	}
	if token.ModelLimitsEnabled && !token.GetModelLimitsMap()[input.Model] {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "Image model is not allowed by the image API key"})
		return
	}
	encoded, err := common.Marshal(input)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	digest := sha256.Sum256(encoded)
	now := time.Now().Unix()
	job := &model.ImageStudioJob{ID: uuid.NewString(), UserID: c.GetInt("id"), TokenID: token.Id, ClientIP: c.ClientIP(), RequestKey: requestKey, RequestHash: hex.EncodeToString(digest[:]), Request: string(encoded), Status: "queued", CreatedAt: now, UpdatedAt: now}
	references, _ := imageStudioReferences(input) // Validated before encoding the request.
	saved, err := model.CreateImageStudioJob(job, references, c.GetHeader("X-Confirm-Duplicate") == "true")
	if err != nil {
		switch {
		case errors.Is(err, model.ErrImageStudioDuplicate):
			c.JSON(409, gin.H{"success": false, "code": "image_task_duplicate", "message": "An identical image task is already in progress"})
		case errors.Is(err, model.ErrImageStudioBusy):
			c.JSON(429, gin.H{"success": false, "message": "Too many active image tasks"})
		case errors.Is(err, model.ErrImageStudioConflict):
			c.JSON(409, gin.H{"success": false, "message": "Request key already used"})
		case errors.Is(err, gorm.ErrRecordNotFound):
			c.JSON(400, gin.H{"success": false, "message": "Reference image is unavailable"})
		case errors.Is(err, model.ErrImageStudioReferences):
			c.JSON(400, gin.H{"success": false, "message": "Use up to 4 different reference images"})
		default:
			common.ApiError(c, errors.New("Unable to create image task"))
		}
		return
	}
	common.ApiSuccess(c, gin.H{"id": saved.ID})
}

type imageStudioAssetView struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	URL  string `json:"url"`
}
type imageStudioItemView struct {
	ID      string `json:"id"`
	Status  string `json:"status"`
	Error   string `json:"error,omitempty"`
	AssetID string `json:"asset_id,omitempty"`
}
type imageStudioJobView struct {
	Items      []imageStudioItemView  `json:"items,omitempty"`
	ID         string                 `json:"id"`
	RequestKey string                 `json:"request_key"`
	Status     string                 `json:"status"`
	CreatedAt  int64                  `json:"created_at"`
	ExpiresAt  int64                  `json:"expires_at"`
	Input      imageStudioInput       `json:"input"`
	Error      string                 `json:"error,omitempty"`
	Assets     []imageStudioAssetView `json:"assets"`
	Quota      *int                   `json:"quota,omitempty"`
}

func ListImageStudioJobs(c *gin.Context) {
	var jobs []model.ImageStudioJob
	query := model.DB.Where("user_id = ? AND parent_id = ? AND deleted_at = 0", c.GetInt("id"), "")
	limit := 50
	var selectedIDs, selectedKeys []string
	for _, selection := range []struct {
		name   string
		values *[]string
	}{{"ids", &selectedIDs}, {"request_keys", &selectedKeys}} {
		if values, exists := c.Request.URL.Query()[selection.name]; exists {
			if len(values) != 1 || len(strings.Split(values[0], ",")) > 100 {
				c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid image task IDs"})
				return
			}
			*selection.values = strings.Split(values[0], ",")
			for _, id := range *selection.values {
				if _, err := uuid.Parse(id); err != nil {
					c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid image task IDs"})
					return
				}
			}
		}
	}
	if len(selectedIDs)+len(selectedKeys) > 100 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid image task IDs"})
		return
	}
	if len(selectedIDs)+len(selectedKeys) > 0 {
		query = query.Where("(id IN ? OR request_key IN ?)", selectedIDs, selectedKeys)
		limit = 100
	}
	if before := c.Query("before"); before != "" {
		query = query.Where("created_at < ?", before)
	}
	if err := query.Order("created_at DESC, id DESC").Limit(limit).Find(&jobs).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	// Consume logs remain authoritative, including subscription-funded requests.
	costs := make(map[string]int)
	ids := make([]string, 0, len(jobs))
	for _, job := range jobs {
		ids = append(ids, job.ID)
	}
	var children []model.ImageStudioJob
	if len(ids) > 0 {
		if err := model.DB.Where("user_id = ? AND parent_id IN ?", c.GetInt("id"), ids).Order("slot").Find(&children).Error; err != nil {
			common.ApiError(c, err)
			return
		}
	}
	grouped := make(map[string][]model.ImageStudioJob)
	for _, child := range children {
		grouped[child.ParentID] = append(grouped[child.ParentID], child)
		ids = append(ids, child.ID)
	}
	if len(ids) > 0 && model.LOG_DB != nil {
		var logs []model.Log
		if err := model.LOG_DB.Select("request_id", "quota").Where("user_id = ? AND type = ? AND request_id IN ?", c.GetInt("id"), model.LogTypeConsume, ids).Find(&logs).Error; err != nil {
			common.ApiError(c, errors.New("Unable to load image costs"))
			return
		}
		for _, log := range logs {
			costs[log.RequestId] += log.Quota
		}
	}
	result := make([]imageStudioJobView, 0, len(jobs))
	now := time.Now().Unix()
	for _, job := range jobs {
		view := imageStudioJobView{ID: job.ID, RequestKey: job.RequestKey, Status: job.Status, CreatedAt: job.CreatedAt, ExpiresAt: job.ExpiresAt, Error: job.Error, Assets: []imageStudioAssetView{}}
		if view.ExpiresAt == 0 {
			view.ExpiresAt = job.CreatedAt + int64(model.ImageStudioRetention.Seconds())
		}
		_ = common.Unmarshal([]byte(job.Request), &view.Input)
		if quota, ok := costs[job.ID]; ok {
			view.Quota = &quota
		}
		if job.ExpiresAt > 0 && job.ExpiresAt <= now {
			view.Status = "expired"
		}
		members := []model.ImageStudioJob{job}
		if group := grouped[job.ID]; len(group) > 0 {
			for i := range group {
				if group[i].ExpiresAt > 0 && group[i].ExpiresAt <= now {
					group[i].Status = "expired"
				}
			}
			members = group
			view.Status = model.ImageStudioGroupStatus(group)
			view.ExpiresAt = job.CreatedAt + int64(model.ImageStudioRetention.Seconds())
			total, known := 0, true
			for _, child := range group {
				view.ExpiresAt = max(view.ExpiresAt, child.ExpiresAt)
				if quota, ok := costs[child.ID]; ok {
					total += quota
				} else if child.Status != "failed" {
					known = false
				}
			}
			if known {
				view.Quota = &total
			}
		}
		for _, member := range members {
			item := imageStudioItemView{ID: member.ID, Status: member.Status, Error: member.Error}
			if member.ExpiresAt > 0 && member.ExpiresAt <= now {
				item.Status = "expired"
			}
			if item.Status == "success" {
				var assets []model.ImageStudioAsset
				if err := model.DB.Where("job_id = ? AND user_id = ? AND expires_at > ?", member.ID, job.UserID, now).Order("id").Find(&assets).Error; err != nil {
					common.ApiError(c, err)
					return
				}
				for _, asset := range assets {
					view.Assets = append(view.Assets, imageStudioAssetView{ID: asset.ID, Kind: asset.Kind, URL: "/api/image-studio/assets/" + url.PathEscape(asset.ID) + "/content"})
					if asset.Kind == "original" {
						item.AssetID = asset.ID
					}
				}
			}
			if len(grouped[job.ID]) > 0 {
				view.Items = append(view.Items, item)
			}
		}
		result = append(result, view)
	}
	common.ApiSuccess(c, result)
}

func DeleteImageStudioJob(c *gin.Context) {
	var job model.ImageStudioJob
	if err := model.DB.Where("id = ? AND user_id = ? AND parent_id = ? AND deleted_at = 0", c.Param("id"), c.GetInt("id"), "").First(&job).Error; err != nil {
		c.Status(404)
		return
	}
	if job.Status == "queued" || job.Status == "running" || job.Status == "saving" || job.Status == "group" {
		c.JSON(409, gin.H{"success": false, "message": "Wait for the image task to finish"})
		return
	}
	err := model.DB.Transaction(func(tx *gorm.DB) error {
		var members []model.ImageStudioJob
		if err := tx.Where("user_id = ? AND (id = ? OR parent_id = ?)", job.UserID, job.ID, job.ID).Find(&members).Error; err != nil {
			return err
		}
		ids := make([]string, 0, len(members))
		for _, member := range members {
			ids = append(ids, member.ID)
		}
		if err := tx.Model(&model.ImageStudioJob{}).Where("id IN ?", ids).Updates(map[string]any{"deleted_at": time.Now().Unix(), "expires_at": time.Now().Unix()}).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.ImageStudioAsset{}).Where("job_id IN ? AND user_id = ?", ids, job.UserID).Update("expires_at", time.Now().Unix()).Error; err != nil {
			return err
		}
		return tx.Where("job_id IN ?", ids).Delete(&model.ImageStudioJobReference{}).Error
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func imageStudioMime(data []byte) (string, error) {
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > 32000000 {
		return "", errors.New("Invalid or oversized image")
	}
	switch format {
	case "png":
		return "image/png", nil
	case "jpeg":
		return "image/jpeg", nil
	case "webp":
		return "image/webp", nil
	}
	return "", errors.New("Use a PNG, JPEG or WebP image")
}

func UploadImageStudioReference(c *gin.Context) {
	store, err := service.NewImageStudioStore()
	if err != nil {
		c.JSON(503, gin.H{"success": false, "message": "Image storage is unavailable"})
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.ImageStudioMaxReferenceBytes+4096)
	file, _, err := c.Request.FormFile("image")
	if c.Request.MultipartForm != nil {
		defer c.Request.MultipartForm.RemoveAll()
	}
	if err != nil {
		c.JSON(400, gin.H{"success": false, "message": "Unable to read reference image"})
		return
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, service.ImageStudioMaxReferenceBytes+1))
	if err != nil || len(data) > service.ImageStudioMaxReferenceBytes {
		c.Status(413)
		return
	}
	storeImageStudioReference(c, store, data)
}

func CloneImageStudioReference(c *gin.Context) {
	asset, err := model.GetImageStudioAsset(c.GetInt("id"), c.Param("id"))
	if err != nil || asset.Kind != "original" {
		c.Status(404)
		return
	}
	store, err := service.NewImageStudioStore()
	if err != nil {
		c.Status(503)
		return
	}
	data, err := store.Get(c.Request.Context(), asset.ObjectKey)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	storeImageStudioReference(c, store, data)
}

func storeImageStudioReference(c *gin.Context, store *service.ImageStudioStore, data []byte) {
	if len(data) > service.ImageStudioMaxReferenceBytes {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"success": false, "message": "Reference images must be 20 MB or smaller"})
		return
	}
	mime, err := imageStudioMime(data)
	if err != nil {
		c.JSON(400, gin.H{"success": false, "message": err.Error()})
		return
	}
	id := uuid.NewString()
	now := time.Now()
	asset := model.ImageStudioAsset{ID: id, UserID: c.GetInt("id"), Kind: "reference", ObjectKey: "references/" + id, Mime: mime, Size: int64(len(data)), CreatedAt: now.Unix(), ExpiresAt: now.Add(model.ImageStudioRetention).Unix()}
	// Track before upload so interrupted uploads are still cleaned up.
	if err = model.CreateImageStudioReference(&asset); err != nil {
		if errors.Is(err, model.ErrImageStudioBusy) {
			c.JSON(429, gin.H{"success": false, "message": "Too many reference images"})
			return
		}
		common.ApiError(c, err)
		return
	}
	if err = store.Put(c.Request.Context(), asset.ObjectKey, data, mime); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"id": id})
}

func ImageStudioAssetURL(c *gin.Context) {
	asset, err := model.GetImageStudioAsset(c.GetInt("id"), c.Param("id"))
	if err != nil {
		c.Status(404)
		return
	}
	link := "/api/image-studio/assets/" + url.PathEscape(asset.ID) + "/content"
	if c.Query("download") == "1" {
		link += "?download=1"
	}
	common.ApiSuccess(c, gin.H{"url": link})
}

func ImageStudioAssetContent(c *gin.Context) {
	asset, err := model.GetImageStudioAsset(c.GetInt("id"), c.Param("id"))
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	store, err := service.NewImageStudioStore()
	if err != nil {
		c.Status(http.StatusServiceUnavailable)
		return
	}
	data, err := store.Get(c.Request.Context(), asset.ObjectKey)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	if c.Query("download") == "1" {
		extension := "png"
		if asset.Mime == "image/jpeg" {
			extension = "jpg"
		}
		if asset.Mime == "image/webp" {
			extension = "webp"
		}
		c.Header("Content-Disposition", `attachment; filename="image.`+extension+`"`)
	}
	c.Data(http.StatusOK, asset.Mime, data)
}
