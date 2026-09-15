package model

import (
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/auto_ban"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrAutoBanSettingsConflict = errors.New("automatic ban settings changed; reload before saving")

// Serialize database reads/commits and snapshot publication so a background
// refresh cannot overwrite a newer local save with a value it read earlier.
// Request handlers only load the atomic snapshot and never take this lock.
var autoBanSettingsUpdateMu sync.Mutex

// Stored in the main database so the evidence and account update commit together.
type AutoBanEvent struct {
	ID                int    `json:"id" gorm:"primaryKey"`
	EventKey          string `json:"-" gorm:"size:64;uniqueIndex"`
	UserID            int    `json:"user_id" gorm:"index"`
	UserStatus        *int   `json:"user_status" gorm:"-"`
	CreatedAt         int64  `json:"created_at" gorm:"index"`
	RequestID         string `json:"request_id" gorm:"size:100"`
	UpstreamRequestID string `json:"upstream_request_id" gorm:"size:200"`
	ChannelID         int    `json:"channel_id"`
	Model             string `json:"model" gorm:"size:200"`
	TokenID           int    `json:"token_id"`
	Version           string `json:"version" gorm:"size:64"`
	Mode              string `json:"mode" gorm:"size:16"`
	Action            string `json:"action" gorm:"size:32"`
	Reason            string `json:"reason" gorm:"type:text"`
	Rules             string `json:"rules" gorm:"type:text"`
	HTTPStatus        int    `json:"http_status"`
	ErrorSummary      string `json:"error_summary" gorm:"type:text"`
}

func GetAutoBanSettings() (auto_ban.Settings, error) {
	var option Option
	err := DB.Where(&Option{Key: auto_ban.OptionKey}).First(&option).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return auto_ban.Defaults(), nil
	}
	if err != nil {
		return auto_ban.Settings{}, err
	}
	var settings auto_ban.Settings
	if err := common.UnmarshalJsonStr(option.Value, &settings); err != nil {
		return settings, err
	}
	return settings, auto_ban.Validate(settings)
}

// The administrator reads the database for edit conflicts; upstream failures
// use the immutable snapshot published only after this transaction commits.
func SaveAutoBanSettings(settings auto_ban.Settings) (auto_ban.Settings, error) {
	if err := auto_ban.Validate(settings); err != nil {
		return settings, err
	}
	autoBanSettingsUpdateMu.Lock()
	defer autoBanSettingsUpdateMu.Unlock()
	var snapshot *auto_ban.Snapshot
	err := DB.Transaction(func(tx *gorm.DB) error {
		initial, err := common.Marshal(auto_ban.Defaults())
		if err != nil {
			return err
		}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&Option{Key: auto_ban.OptionKey, Value: string(initial)}).Error; err != nil {
			return err
		}
		var option Option
		if err := lockForUpdate(tx).Where(&Option{Key: auto_ban.OptionKey}).First(&option).Error; err != nil {
			return err
		}
		var current auto_ban.Settings
		if err := common.UnmarshalJsonStr(option.Value, &current); err != nil {
			return err
		}
		if settings.Version != current.Version {
			return ErrAutoBanSettingsConflict
		}
		settings.Version = uuid.NewString()
		data, err := common.Marshal(settings)
		if err != nil {
			return err
		}
		snapshot, err = auto_ban.ParseSnapshot(string(data))
		if err != nil {
			return err
		}
		result := tx.Model(&Option{}).Where(&Option{Key: auto_ban.OptionKey}).Where("value = ?", option.Value).Update("value", string(data))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrAutoBanSettingsConflict
		}
		return nil
	})
	if err == nil {
		auto_ban.PublishSnapshot(snapshot)
	}
	return settings, err
}

func ApplyAutoBanEvent(event *AutoBanEvent) error {
	if event.UserID <= 0 || event.EventKey == "" || (event.Mode != "observe" && event.Mode != "ban") {
		return fmt.Errorf("invalid automatic ban event")
	}
	changed := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id", "role", "status", "auth_version").First(&user, event.UserID).Error; err != nil {
			return err
		}
		event.CreatedAt = time.Now().Unix()
		event.Action = "recorded"
		if user.Role >= common.RoleAdminUser {
			event.Action = "protected"
		} else if event.Mode == "ban" {
			if user.Status == common.UserStatusEnabled {
				event.Action = "banned"
			} else {
				event.Action = "already_disabled"
			}
		}
		result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(event)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		if event.Action != "banned" {
			return nil
		}
		if _, err := IncrementUserAuthVersionWithTx(tx, user.Id); err != nil {
			return err
		}
		if err := tx.Model(&User{}).Where("id = ?", user.Id).Update("status", common.UserStatusDisabled).Error; err != nil {
			return err
		}
		changed = true
		return nil
	})
	if err != nil || !changed {
		return err
	}
	// The version fence denies stale cached identities even if publication fails.
	return errors.Join(PublishUserAuthCache(event.UserID), InvalidateUserTokensCache(event.UserID))
}

func ListAutoBanEvents(before int, limit int) ([]AutoBanEvent, error) {
	if limit < 1 || limit > 100 {
		limit = 30
	}
	query := DB.Order("id DESC").Limit(limit)
	if before > 0 {
		query = query.Where("id < ?", before)
	}
	var events []AutoBanEvent
	if err := query.Find(&events).Error; err != nil || len(events) == 0 {
		return events, err
	}
	// Current account state is only needed on the administrator's records page.
	userIDs := make([]int, 0, len(events))
	for _, event := range events {
		userIDs = append(userIDs, event.UserID)
	}
	var users []User
	if err := DB.Select("id", "status").Where("id IN ?", userIDs).Find(&users).Error; err != nil {
		return nil, err
	}
	statuses := make(map[int]int, len(users))
	for _, user := range users {
		statuses[user.Id] = user.Status
	}
	for i := range events {
		if status, exists := statuses[events[i].UserID]; exists {
			events[i].UserStatus = &status
		}
	}
	return events, nil
}
