package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
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
const ImageStudioProvisionalUploadTTL = 2 * time.Minute
const ImageStudioMaxReferences = 4
const ImageStudioMaxReferenceBytes int64 = 20 << 20
const ImageStudioMaxUserReferenceBytes int64 = 256 << 20

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

// GetImageStudioToken is read-only; opening the workbench never creates or upgrades a key.
func GetImageStudioToken(userID int) (*Token, error) {
	var association ImageStudioToken
	if err := DB.Where("user_id = ?", userID).First(&association).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	token, err := GetTokenByIds(association.TokenID, userID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return token, err
}

func CanUpgradeImageStudioToken(token *Token, legacyModels []string) bool {
	if token.Group != "default" || token.Name != "Image Studio" || token.Status != common.TokenStatusEnabled ||
		token.ExpiredTime != -1 || !token.UnlimitedQuota || !token.ModelLimitsEnabled ||
		len(token.GetIpLimits()) != 0 || token.AutoGroups != "" || token.CrossGroupRetry || len(legacyModels) == 0 {
		return false
	}
	limits, legacy := token.GetModelLimits(), slices.Clone(legacyModels)
	slices.Sort(limits)
	slices.Sort(legacy)
	return slices.Equal(limits, legacy)
}

func GetOrCreateImageStudioToken(userID int, imageModels, legacyModels []string) (*Token, error) {
	imageStudioTokenMu.Lock()
	defer imageStudioTokenMu.Unlock()
	var token Token
	created := false
	upgraded := false
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
			err = lockForUpdate(tx).Where("id = ? AND user_id = ?", association.TokenID, userID).First(&token).Error
			if err == nil {
				// Only upgrade the original, uncustomized default-group policy.
				// Owner-set restrictions, expiry, quota and disabled states remain authoritative.
				if CanUpgradeImageStudioToken(&token, legacyModels) {
					if err := invalidateTokenCacheForMutation(token.Key); err != nil {
						return errors.New("Unable to refresh image API key")
					}
					token.Group, token.ModelLimits = "auto", strings.Join(imageModels, ",")
					if err := tx.Session(&gorm.Session{Logger: logger.Discard}).Model(&token).Select("group", "model_limits").Updates(&token).Error; err != nil {
						return errors.New("Unable to update image API key")
					}
					upgraded, role = true, user.Role
				}
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
			ModelLimitsEnabled: true, ModelLimits: strings.Join(imageModels, ","), Group: "auto"}
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
	if upgraded {
		RecordAuditLog(nil, AuditLog{UserId: userID, ActorRole: role, Category: AuditCategorySecurity, Action: "image_studio.token.upgrade", Success: true, Content: fmt.Sprintf("Updated image API key %d to automatic routing", token.Id)})
	}
	return &token, nil
}

var ErrImageStudioDuplicate = errors.New("identical image task is active")
var ErrImageStudioBusy = errors.New("too many active image tasks")
var ErrImageStudioConflict = errors.New("request key already used with different parameters")
var ErrImageStudioReferences = errors.New("invalid reference image selections")
var ErrImageStudioJobActive = errors.New("wait for the image task to finish")

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
	// Keep the overlay in the same ownership, retention and child-job lifecycle
	// as references, without consuming one of the four source-image slots.
	var markup struct {
		MarkupID string `json:"markup_id"`
	}
	if job.Request != "" {
		if err := common.Unmarshal([]byte(job.Request), &markup); err != nil {
			return nil, err
		}
	}
	if markup.MarkupID != "" {
		if len(referenceIDs) == 0 || ValidateImageStudioReferenceIDs([]string{markup.MarkupID}) != nil || slices.Contains(referenceIDs, markup.MarkupID) {
			return nil, ErrImageStudioReferences
		}
		referenceIDs = append(slices.Clone(referenceIDs), markup.MarkupID)
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
		now := time.Now().Unix()
		for _, referenceID := range referenceIDs {
			var asset ImageStudioAsset
			if referenceID == markup.MarkupID {
				if err := lockForUpdate(tx).Where("id = ? AND user_id = ? AND kind = 'reference' AND (expires_at = 0 OR expires_at > ?)", referenceID, job.UserID, now).First(&asset).Error; err != nil {
					return err
				}
				continue
			}
			if err := lockForUpdate(tx).Where(
				"id = ? AND user_id = ? AND ((kind = 'reference' AND (expires_at = 0 OR expires_at > ?)) OR (kind = 'original' AND expires_at > ? AND size <= ?))",
				referenceID, job.UserID, now, now, ImageStudioMaxReferenceBytes,
			).First(&asset).Error; err != nil {
				return err
			}
			if asset.Kind == "original" {
				if asset.JobID == "" {
					return gorm.ErrRecordNotFound
				}
				var sourceJob ImageStudioJob
				if err := tx.Where("id = ? AND user_id = ? AND deleted_at = 0 AND status = ? AND expires_at > ?", asset.JobID, job.UserID, "success", now).First(&sourceJob).Error; err != nil {
					return err
				}
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
		return nil
	})
}

func DeleteExpiredImageStudioAsset(id string, now int64) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		result := tx.Where("id = ? AND expires_at > 0 AND expires_at <= ?", id, now).Delete(&ImageStudioAsset{})
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

// CreateImageStudioReference bounds live reference bytes per account under the
// same user lock used by job submission, evicting oldest non-active references
// when needed. Returns ErrImageStudioBusy only if active-job references alone
// prevent fitting the new upload within ImageStudioMaxUserReferenceBytes.
func CreateImageStudioReference(asset *ImageStudioAsset) ([]ImageStudioAsset, error) {
	var evicted []ImageStudioAsset
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id").First(&user, asset.UserID).Error; err != nil {
			return err
		}
		if asset.Size > ImageStudioMaxUserReferenceBytes {
			return ErrImageStudioBusy
		}
		now := time.Now().Unix()
		var usedBytes int64
		if err := tx.Model(&ImageStudioAsset{}).
			Where("user_id = ? AND kind = ? AND (expires_at = 0 OR expires_at > ?)", asset.UserID, "reference", now).
			Select("COALESCE(SUM(size), 0)").Scan(&usedBytes).Error; err != nil {
			return err
		}
		if usedBytes+asset.Size > ImageStudioMaxUserReferenceBytes {
			needed := usedBytes + asset.Size - ImageStudioMaxUserReferenceBytes
			activeStatuses := []string{"queued", "running", "saving", "group"}
			activeJobs := tx.Model(&ImageStudioJob{}).Select("id").Where("user_id = ? AND status IN ?", asset.UserID, activeStatuses)
			activeRefs := tx.Model(&ImageStudioJobReference{}).Select("asset_id").Where("job_id IN (?)", activeJobs)
			legacyActiveRefs := tx.Model(&ImageStudioJob{}).Select("reference_id").Where("user_id = ? AND status IN ? AND reference_id <> ''", asset.UserID, activeStatuses)
			var candidates []ImageStudioAsset
			if err := tx.Where("user_id = ? AND kind = ? AND (expires_at = 0 OR expires_at > ?) AND id NOT IN (?) AND id NOT IN (?)",
				asset.UserID, "reference", now, activeRefs, legacyActiveRefs).
				Order("created_at ASC, id ASC").
				Find(&candidates).Error; err != nil {
				return err
			}
			var freed int64
			evictIDs := make([]string, 0, len(candidates))
			for _, candidate := range candidates {
				evicted = append(evicted, candidate)
				evictIDs = append(evictIDs, candidate.ID)
				freed += candidate.Size
				if freed >= needed {
					break
				}
			}
			if freed < needed {
				evicted = nil
				return ErrImageStudioBusy
			}
			if err := tx.Model(&ImageStudioAsset{}).
				Where("user_id = ? AND kind = ? AND id IN ?", asset.UserID, "reference", evictIDs).
				Update("expires_at", now).Error; err != nil {
				evicted = nil
				return err
			}
		}
		return tx.Create(asset).Error
	})
	if err != nil {
		return nil, err
	}
	return evicted, nil
}

// FinalizeImageStudioReference transitions a provisional upload to a live
// reference (expires_at = 0) under the user lock. Returns false if the
// provisional row was evicted or deleted before the upload completed.
func FinalizeImageStudioReference(userID int, id string, provisionalExpiry int64) (bool, error) {
	var finalized bool
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id").First(&user, userID).Error; err != nil {
			return err
		}
		res := tx.Model(&ImageStudioAsset{}).
			Where("id = ? AND user_id = ? AND kind = ? AND expires_at = ?", id, userID, "reference", provisionalExpiry).
			Update("expires_at", 0)
		if res.Error != nil {
			return res.Error
		}
		finalized = res.RowsAffected == 1
		return nil
	})
	return finalized, err
}

// DiscardImageStudioReference removes an uncommitted provisional reference row
// when storage write fails, avoiding phantom capacity usage.
func DiscardImageStudioReference(userID int, id string, provisionalExpiry int64) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id").First(&user, userID).Error; err != nil {
			return err
		}
		return tx.Where("id = ? AND user_id = ? AND kind = ? AND expires_at = ?", id, userID, "reference", provisionalExpiry).
			Delete(&ImageStudioAsset{}).Error
	})
}

// DeleteImageStudioJob soft-deletes a terminal job (and any batch children)
// under the user lock, expiring its generated outputs and any unshared
// kind='reference' uploads while preserving shared references and reused
// kind='original' assets.
func DeleteImageStudioJob(userID int, jobID string) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id").First(&user, userID).Error; err != nil {
			return err
		}
		var job ImageStudioJob
		if err := tx.Where("id = ? AND user_id = ? AND parent_id = ? AND deleted_at = 0", jobID, userID, "").First(&job).Error; err != nil {
			return err
		}
		if job.Status == "queued" || job.Status == "running" || job.Status == "saving" || job.Status == "group" {
			return ErrImageStudioJobActive
		}
		now := time.Now().Unix()
		var members []ImageStudioJob
		if err := tx.Where("user_id = ? AND (id = ? OR parent_id = ?)", userID, job.ID, job.ID).Find(&members).Error; err != nil {
			return err
		}
		ids := make([]string, 0, len(members))
		candidateSet := make(map[string]struct{})
		for _, member := range members {
			ids = append(ids, member.ID)
			if member.ReferenceID != "" {
				candidateSet[member.ReferenceID] = struct{}{}
			}
		}
		var linked []string
		if err := tx.Model(&ImageStudioJobReference{}).Where("job_id IN ?", ids).Pluck("asset_id", &linked).Error; err != nil {
			return err
		}
		for _, assetID := range linked {
			if assetID != "" {
				candidateSet[assetID] = struct{}{}
			}
		}
		if err := tx.Model(&ImageStudioJob{}).Where("id IN ?", ids).Updates(map[string]any{"deleted_at": now, "expires_at": now}).Error; err != nil {
			return err
		}
		if err := tx.Model(&ImageStudioAsset{}).Where("job_id IN ? AND user_id = ?", ids, userID).Update("expires_at", now).Error; err != nil {
			return err
		}
		if err := tx.Where("job_id IN ?", ids).Delete(&ImageStudioJobReference{}).Error; err != nil {
			return err
		}
		if len(candidateSet) == 0 {
			return nil
		}
		candidates := make([]string, 0, len(candidateSet))
		for assetID := range candidateSet {
			candidates = append(candidates, assetID)
		}
		var stillLinked []string
		if err := tx.Model(&ImageStudioJobReference{}).Where("asset_id IN ?", candidates).Pluck("asset_id", &stillLinked).Error; err != nil {
			return err
		}
		for _, assetID := range stillLinked {
			delete(candidateSet, assetID)
		}
		if len(candidateSet) > 0 {
			var stillLegacy []string
			if err := tx.Model(&ImageStudioJob{}).Where("user_id = ? AND deleted_at = 0 AND reference_id IN ?", userID, candidates).Pluck("reference_id", &stillLegacy).Error; err != nil {
				return err
			}
			for _, assetID := range stillLegacy {
				delete(candidateSet, assetID)
			}
		}
		if len(candidateSet) == 0 {
			return nil
		}
		unshared := make([]string, 0, len(candidateSet))
		for assetID := range candidateSet {
			unshared = append(unshared, assetID)
		}
		return tx.Model(&ImageStudioAsset{}).Where("user_id = ? AND kind = ? AND id IN ? AND (expires_at = 0 OR expires_at > ?)", userID, "reference", unshared, now).Update("expires_at", now).Error
	})
}

// EvictImageStudioReferences marks oldest global non-active reference uploads
// expired until at least bytesNeeded bytes are reclaimed (excluding excludeID).
// Candidate owners are locked in ascending user_id order before re-verifying
// live and non-active status, matching CreateImageStudioJob lock order and
// preventing concurrent active-job races across SQLite, MySQL and PostgreSQL.
func EvictImageStudioReferences(bytesNeeded int64, excludeID string) ([]ImageStudioAsset, error) {
	if bytesNeeded <= 0 {
		return nil, nil
	}
	activeStatuses := []string{"queued", "running", "saving", "group"}
	scanNow := time.Now().Unix()
	initialActiveJobs := DB.Model(&ImageStudioJob{}).Select("id").Where("status IN ?", activeStatuses)
	initialActiveRefs := DB.Model(&ImageStudioJobReference{}).Select("asset_id").Where("job_id IN (?)", initialActiveJobs)
	initialLegacyActive := DB.Model(&ImageStudioJob{}).Select("reference_id").Where("status IN ? AND reference_id <> ''", activeStatuses)
	var initial []ImageStudioAsset
	if err := DB.Select("id", "user_id", "size").
		Where("kind = ? AND (expires_at = 0 OR expires_at > ?) AND id <> ? AND id NOT IN (?) AND id NOT IN (?)",
			"reference", scanNow, excludeID, initialActiveRefs, initialLegacyActive).
		Order("created_at ASC, id ASC").
		Find(&initial).Error; err != nil {
		return nil, err
	}
	if len(initial) == 0 {
		return nil, nil
	}
	userSet := make(map[int]struct{})
	var scannedBytes int64
	for _, candidate := range initial {
		userSet[candidate.UserID] = struct{}{}
		scannedBytes += candidate.Size
		if scannedBytes >= bytesNeeded*2 {
			break
		}
	}
	if scannedBytes < bytesNeeded {
		return nil, nil
	}
	userIDs := make([]int, 0, len(userSet))
	for userID := range userSet {
		userIDs = append(userIDs, userID)
	}
	slices.Sort(userIDs)

	var evicted []ImageStudioAsset
	err := DB.Transaction(func(tx *gorm.DB) error {
		// Acquire users locks in ascending order BEFORE any non-locking SELECT
		// so MySQL REPEATABLE READ and PostgreSQL READ COMMITTED see all
		// concurrent CreateImageStudioJob commits before checking active jobs.
		for _, userID := range userIDs {
			var user User
			if err := lockForUpdate(tx).Select("id").First(&user, userID).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					continue
				}
				return err
			}
		}
		now := time.Now().Unix()
		activeJobs := tx.Model(&ImageStudioJob{}).Select("id").Where("user_id IN ? AND status IN ?", userIDs, activeStatuses)
		activeRefs := tx.Model(&ImageStudioJobReference{}).Select("asset_id").Where("job_id IN (?)", activeJobs)
		legacyActiveRefs := tx.Model(&ImageStudioJob{}).Select("reference_id").Where("user_id IN ? AND status IN ? AND reference_id <> ''", userIDs, activeStatuses)
		var candidates []ImageStudioAsset
		if err := tx.Where("user_id IN ? AND kind = ? AND (expires_at = 0 OR expires_at > ?) AND id <> ? AND id NOT IN (?) AND id NOT IN (?)",
			userIDs, "reference", now, excludeID, activeRefs, legacyActiveRefs).
			Order("created_at ASC, id ASC").
			Find(&candidates).Error; err != nil {
			return err
		}
		var freed int64
		evictIDs := make([]string, 0, len(candidates))
		for _, candidate := range candidates {
			evicted = append(evicted, candidate)
			evictIDs = append(evictIDs, candidate.ID)
			freed += candidate.Size
			if freed >= bytesNeeded {
				break
			}
		}
		if freed < bytesNeeded {
			evicted = nil
			return nil
		}
		if err := tx.Model(&ImageStudioAsset{}).
			Where("kind = ? AND id IN ?", "reference", evictIDs).
			Update("expires_at", now).Error; err != nil {
			evicted = nil
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return evicted, nil
}

// ReleaseTerminalImageStudioReferences marks reference uploads attached to a
// terminal job expired when no active job still references them. Only
// kind='reference' assets are ever released; generated kind='original' assets
// keep their own delivery retention.
func ReleaseTerminalImageStudioReferences(userID int, jobID string, now int64) ([]ImageStudioAsset, error) {
	var released []ImageStudioAsset
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id").First(&user, userID).Error; err != nil {
			return err
		}
		var job ImageStudioJob
		if err := tx.Where("id = ? AND user_id = ?", jobID, userID).First(&job).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		switch job.Status {
		case "queued", "running", "saving", "group":
			return nil
		}
		candidateSet := make(map[string]struct{})
		if job.ReferenceID != "" {
			candidateSet[job.ReferenceID] = struct{}{}
		}
		var linked []string
		if err := tx.Model(&ImageStudioJobReference{}).Where("job_id = ?", job.ID).Pluck("asset_id", &linked).Error; err != nil {
			return err
		}
		for _, assetID := range linked {
			if assetID != "" {
				candidateSet[assetID] = struct{}{}
			}
		}
		if len(candidateSet) == 0 {
			return nil
		}
		candidates := make([]string, 0, len(candidateSet))
		for assetID := range candidateSet {
			candidates = append(candidates, assetID)
		}
		activeStatuses := []string{"queued", "running", "saving", "group"}
		activeJobs := tx.Model(&ImageStudioJob{}).Select("id").Where("user_id = ? AND status IN ?", userID, activeStatuses)
		var stillActive []string
		if err := tx.Model(&ImageStudioJobReference{}).
			Where("asset_id IN ? AND job_id IN (?)", candidates, activeJobs).
			Pluck("asset_id", &stillActive).Error; err != nil {
			return err
		}
		for _, assetID := range stillActive {
			delete(candidateSet, assetID)
		}
		if len(candidateSet) > 0 {
			var stillLegacyActive []string
			if err := tx.Model(&ImageStudioJob{}).
				Where("user_id = ? AND status IN ? AND reference_id IN ?", userID, activeStatuses, candidates).
				Pluck("reference_id", &stillLegacyActive).Error; err != nil {
				return err
			}
			for _, assetID := range stillLegacyActive {
				delete(candidateSet, assetID)
			}
		}
		if len(candidateSet) == 0 {
			return nil
		}
		releaseIDs := make([]string, 0, len(candidateSet))
		for assetID := range candidateSet {
			releaseIDs = append(releaseIDs, assetID)
		}
		if err := tx.Where("user_id = ? AND kind = ? AND id IN ?", userID, "reference", releaseIDs).Find(&released).Error; err != nil {
			return err
		}
		if len(released) == 0 {
			return nil
		}
		matchedIDs := make([]string, 0, len(released))
		for _, asset := range released {
			matchedIDs = append(matchedIDs, asset.ID)
		}
		if err := tx.Model(&ImageStudioAsset{}).
			Where("user_id = ? AND kind = ? AND id IN ? AND (expires_at = 0 OR expires_at > ?)", userID, "reference", matchedIDs, now).
			Update("expires_at", now).Error; err != nil {
			released = nil
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return released, nil
}

func GetImageStudioAsset(userID int, id string) (*ImageStudioAsset, error) {
	var asset ImageStudioAsset
	now := time.Now().Unix()
	if err := DB.Where("id = ? AND user_id = ? AND (expires_at = 0 OR expires_at > ?)", id, userID, now).First(&asset).Error; err != nil {
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
