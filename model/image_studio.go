package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/google/uuid"
	"gorm.io/gorm/logger"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const ImageStudioRetention = 24 * time.Hour
const ImageStudioMaxReferences = 4

// ImageStudioJob is a durable workbench request. Request contains parameters,
// never credentials or image bytes. A running job is never automatically replayed.
type ImageStudioJob struct {
	ParentID    string `json:"-" gorm:"type:varchar(64);not null;default:'';index"`
	Slot        int    `json:"-"`
	ID          string `json:"id" gorm:"type:varchar(64);primaryKey"`
	UserID      int    `json:"-" gorm:"uniqueIndex:idx_image_studio_request;index"`
	TokenID     int    `json:"-"`
	ClientIP    string `json:"-" gorm:"type:varchar(64)"`
	RequestKey  string `json:"-" gorm:"type:varchar(64);uniqueIndex:idx_image_studio_request"`
	ReferenceID string `json:"-" gorm:"type:varchar(64);index"`
	RequestHash string `json:"-" gorm:"type:varchar(64)"`
	Request     string `json:"-" gorm:"type:text"`
	Status      string `json:"status" gorm:"type:varchar(24);index"`
	CreatedAt   int64  `json:"created_at"`
	UpdatedAt   int64  `json:"-"`
	ExpiresAt   int64  `json:"-" gorm:"index"`
	LeaseUntil  int64  `json:"-" gorm:"index"`
	Owner       string `json:"-" gorm:"type:varchar(64)"`
	Error       string `json:"error,omitempty" gorm:"type:varchar(255)"`
	DeletedAt   int64  `json:"-"`
}

type ImageStudioAsset struct {
	ID        string `json:"id" gorm:"type:varchar(64);primaryKey"`
	UserID    int    `json:"-" gorm:"index"`
	JobID     string `json:"-" gorm:"type:varchar(64);index"`
	Kind      string `json:"kind" gorm:"type:varchar(16)"`
	ObjectKey string `json:"-" gorm:"type:varchar(512)"`
	Mime      string `json:"mime" gorm:"type:varchar(64)"`
	Size      int64  `json:"size"`
	CreatedAt int64  `json:"-"`
	ExpiresAt int64  `json:"-" gorm:"index"`
}

// Keep reference associations separate from the request JSON so every active
// input image can be protected by indexed queries on all supported databases.
type ImageStudioJobReference struct {
	JobID   string `gorm:"type:varchar(64);primaryKey"`
	AssetID string `gorm:"type:varchar(64);primaryKey;index"`
}

// A purpose association survives token renaming. Never replace a disabled,
// expired or depleted token: those are deliberate credential controls.
type ImageStudioToken struct {
	UserID  int `gorm:"primaryKey;autoIncrement:false"`
	TokenID int `gorm:"uniqueIndex"`
}

var imageStudioTokenMu sync.Mutex
var ErrImageStudioTokenLimit = errors.New("API key limit reached; remove an unused key before generating images")

func GetOrCreateImageStudioToken(userID int, imageModels []string) (*Token, error) {
	imageStudioTokenMu.Lock()
	defer imageStudioTokenMu.Unlock()
	var token Token
	created := false
	role := 0
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).First(&user, userID).Error; err != nil {
			return err
		}
		if user.Status != common.UserStatusEnabled {
			return errors.New("Image account is unavailable")
		}
		var association ImageStudioToken
		err := tx.Where("user_id = ?", userID).First(&association).Error
		if err == nil {
			err = tx.Where("id = ? AND user_id = ?", association.TokenID, userID).First(&token).Error
			if err == nil {
				return nil
			}
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var count int64
		if err := tx.Model(&Token{}).Where("user_id = ?", userID).Count(&count).Error; err != nil {
			return err
		}
		if count >= int64(operation_setting.GetMaxUserTokens()) {
			return ErrImageStudioTokenLimit
		}
		if len(imageModels) == 0 {
			return errors.New("Image model is unavailable")
		}
		key, err := common.GenerateKey()
		if err != nil {
			return errors.New("Unable to create image API key")
		}
		now := time.Now().Unix()
		token = Token{UserId: userID, Name: "Image Studio", Key: key, Status: common.TokenStatusEnabled,
			CreatedTime: now, AccessedTime: now, ExpiredTime: -1, UnlimitedQuota: true,
			ModelLimitsEnabled: true, ModelLimits: strings.Join(imageModels, ","), Group: "default"}
		// GORM error SQL must not include the newly generated credential.
		if err := tx.Session(&gorm.Session{Logger: logger.Discard}).Create(&token).Error; err != nil {
			return errors.New("Unable to create image API key")
		}
		created, role = true, user.Role
		association = ImageStudioToken{UserID: userID, TokenID: token.Id}
		return tx.Save(&association).Error
	})
	if err != nil {
		return nil, err
	}
	if created {
		RecordAuditLog(nil, AuditLog{UserId: userID, ActorRole: role, Category: AuditCategorySecurity, Action: "image_studio.token.create", Success: true, Content: fmt.Sprintf("Created image API key %d", token.Id)})
	}
	return &token, nil
}

var ErrImageStudioDuplicate = errors.New("identical image task is active")
var ErrImageStudioBusy = errors.New("too many active image tasks")
var ErrImageStudioConflict = errors.New("request key already used with different parameters")
var ErrImageStudioReferences = errors.New("invalid reference image selections")

func ValidateImageStudioReferenceIDs(ids []string) error {
	if len(ids) > ImageStudioMaxReferences {
		return ErrImageStudioReferences
	}
	seen := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		if id == "" || len(id) > 64 {
			return ErrImageStudioReferences
		}
		if _, exists := seen[id]; exists {
			return ErrImageStudioReferences
		}
		seen[id] = struct{}{}
	}
	return nil
}

// CreateImageStudioJob serializes submissions per user, including concurrent
// retries. The unique key also protects installations using SQLite.
func CreateImageStudioJob(job *ImageStudioJob, referenceIDs []string, confirmDuplicate bool) (*ImageStudioJob, error) {
	if err := ValidateImageStudioReferenceIDs(referenceIDs); err != nil {
		return nil, err
	}
	var result ImageStudioJob
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id").First(&user, job.UserID).Error; err != nil {
			return err
		}
		err := tx.Where("user_id = ? AND request_key = ?", job.UserID, job.RequestKey).First(&result).Error
		if err == nil {
			if result.RequestHash != job.RequestHash {
				return ErrImageStudioConflict
			}
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if !confirmDuplicate && job.RequestHash != "" {
			var duplicates int64
			if err := tx.Model(&ImageStudioJob{}).Where("user_id = ? AND parent_id = ? AND request_hash = ? AND status IN ?", job.UserID, "", job.RequestHash, []string{"queued", "running", "saving", "group"}).Count(&duplicates).Error; err != nil {
				return err
			}
			if duplicates > 0 {
				return ErrImageStudioDuplicate
			}
		}
		var active int64
		if err := tx.Model(&ImageStudioJob{}).Where("user_id = ? AND parent_id = ? AND status IN ?", job.UserID, "", []string{"queued", "running", "saving", "group"}).Count(&active).Error; err != nil {
			return err
		}
		if active >= 3 {
			return ErrImageStudioBusy
		}
		job.ReferenceID = ""
		for _, referenceID := range referenceIDs {
			var asset ImageStudioAsset
			if err := lockForUpdate(tx).Where("id = ? AND user_id = ? AND kind = 'reference' AND expires_at > ?", referenceID, job.UserID, time.Now().Unix()).First(&asset).Error; err != nil {
				return err
			}
		}
		if len(referenceIDs) > 0 {
			job.ReferenceID = referenceIDs[0]
		}
		var input map[string]json.RawMessage
		if err := common.Unmarshal([]byte(job.Request), &input); job.Request != "" && err != nil {
			return err
		}
		count := 1
		if raw := input["n"]; raw != nil {
			if err := common.Unmarshal(raw, &count); err != nil {
				return err
			}
		}
		if count < 1 || count > 4 {
			return errors.New("invalid image count")
		}
		if count > 1 {
			job.Status = "group"
		}
		if err := tx.Create(job).Error; err != nil {
			return err
		}
		for _, referenceID := range referenceIDs {
			if err := tx.Create(&ImageStudioJobReference{JobID: job.ID, AssetID: referenceID}).Error; err != nil {
				return err
			}
		}
		if count > 1 {
			input["n"] = json.RawMessage("1")
			payload, err := common.Marshal(input)
			if err != nil {
				return err
			}
			for slot := range count {
				child := *job
				child.ID, child.RequestKey = uuid.NewString(), uuid.NewString()
				child.ParentID, child.Slot, child.Status, child.Request = job.ID, slot, "queued", string(payload)
				if err := tx.Create(&child).Error; err != nil {
					return err
				}
				for _, referenceID := range referenceIDs {
					if err := tx.Create(&ImageStudioJobReference{JobID: child.ID, AssetID: referenceID}).Error; err != nil {
						return err
					}
				}
			}
		}
		result = *job
		return nil
	})
	return &result, err
}

func ClaimImageStudioJob(owner string, now int64) (*ImageStudioJob, error) {
	var jobs []ImageStudioJob
	err := DB.Where("status = ? OR (status = ? AND owner = ? AND lease_until < ? AND expires_at > ?)", "queued", "saving", owner, now, now).Order("created_at").Limit(8).Find(&jobs).Error
	if err != nil {
		return nil, err
	}
	for _, job := range jobs {
		status := job.Status
		if status == "queued" {
			status = "running"
		}
		result := DB.Model(&ImageStudioJob{}).Where("id = ? AND status = ? AND lease_until = ?", job.ID, job.Status, job.LeaseUntil).Updates(map[string]any{"status": status, "owner": owner, "lease_until": now + 1200, "updated_at": now})
		if result.Error != nil {
			return nil, result.Error
		}
		if result.RowsAffected == 1 {
			job.Status = status
			job.Owner = owner
			return &job, nil
		}
	}
	return nil, nil
}

func SaveImageStudioAssets(job *ImageStudioJob, assets []ImageStudioAsset) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		for _, asset := range assets {
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&asset).Error; err != nil {
				return err
			}
		}
		result := tx.Model(&ImageStudioJob{}).Where("id = ? AND status = ? AND owner = ?", job.ID, "saving", job.Owner).Updates(map[string]any{"status": "success", "error": "", "lease_until": 0})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("image task state changed")
		}
		references := tx.Model(&ImageStudioJobReference{}).Select("asset_id").Where("job_id = ?", job.ID)
		return tx.Model(&ImageStudioAsset{}).Where("user_id = ? AND kind = ? AND expires_at < ?", job.UserID, "reference", job.ExpiresAt).
			Where("id IN (?) OR id = ?", references, job.ReferenceID).Update("expires_at", job.ExpiresAt).Error
	})
}

func DeleteExpiredImageStudioAsset(id string, now int64) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Where("id = ? AND expires_at <= ?", id, now).Delete(&ImageStudioAsset{})
		if result.Error != nil || result.RowsAffected == 0 {
			return result.Error
		}
		return tx.Where("asset_id = ?", id).Delete(&ImageStudioJobReference{}).Error
	})
}

func DeleteOldImageStudioJobs(before int64) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		jobs := tx.Model(&ImageStudioJob{}).Select("id").Where("created_at < ? AND (expires_at = 0 OR expires_at <= ?) AND status NOT IN ?", before, time.Now().Unix(), []string{"queued", "running", "saving"})
		if err := tx.Where("job_id IN (?)", jobs).Delete(&ImageStudioJobReference{}).Error; err != nil {
			return err
		}
		return tx.Where("created_at < ? AND (expires_at = 0 OR expires_at <= ?) AND status NOT IN ?", before, time.Now().Unix(), []string{"queued", "running", "saving"}).Delete(&ImageStudioJob{}).Error
	})
}

// CreateImageStudioReference bounds retained uploads per account under the
// same user lock used by job submission.
func CreateImageStudioReference(asset *ImageStudioAsset) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id").First(&user, asset.UserID).Error; err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&ImageStudioAsset{}).Where("user_id = ? AND kind = ? AND expires_at > ?", asset.UserID, "reference", time.Now().Unix()).Count(&count).Error; err != nil {
			return err
		}
		if count >= 30 {
			return ErrImageStudioBusy
		}
		return tx.Create(asset).Error
	})
}

func GetImageStudioAsset(userID int, id string) (*ImageStudioAsset, error) {
	var asset ImageStudioAsset
	now := time.Now().Unix()
	if err := DB.Where("id = ? AND user_id = ? AND expires_at > ?", id, userID, now).First(&asset).Error; err != nil {
		return nil, err
	}
	if asset.JobID != "" {
		var job ImageStudioJob
		if err := DB.Where("id = ? AND user_id = ? AND deleted_at = 0 AND status = ? AND expires_at > ?", asset.JobID, userID, "success", now).First(&job).Error; err != nil {
			return nil, err
		}
	}
	return &asset, nil
}

// ImageStudioGroupStatus preserves uncertain and partially successful results.
func ImageStudioGroupStatus(children []ImageStudioJob) string {
	var success, failed, expired, unknown, queued, active int
	for _, child := range children {
		switch child.Status {
		case "success":
			success++
		case "failed":
			failed++
		case "expired":
			expired++
			failed++
		case "queued":
			queued++
			active++
		case "running", "saving":
			active++
		default:
			unknown++
		}
	}
	if queued == len(children) && queued > 0 {
		return "queued"
	}
	if active > 0 {
		return "running"
	}
	if unknown > 0 || len(children) == 0 {
		return "unknown"
	}
	if success == len(children) {
		return "success"
	}
	if expired == len(children) {
		return "expired"
	}
	if failed == len(children) {
		return "failed"
	}
	return "partial"
}

// Only children are claimable. Parent rows track admission and group deletion.
func RefreshImageStudioGroup(parentID string) error {
	if parentID == "" {
		return nil
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var parent ImageStudioJob
		if err := lockForUpdate(tx).Where("id = ?", parentID).First(&parent).Error; err != nil {
			return err
		}
		var children []ImageStudioJob
		if err := tx.Where("parent_id = ?", parentID).Find(&children).Error; err != nil {
			return err
		}
		status := ImageStudioGroupStatus(children)
		if status == "queued" || status == "running" {
			status = "group"
		}
		expires := int64(0)
		for _, child := range children {
			expires = max(expires, child.ExpiresAt)
		}
		return tx.Model(&parent).Updates(map[string]any{"status": status, "expires_at": expires, "updated_at": time.Now().Unix()}).Error
	})
}
