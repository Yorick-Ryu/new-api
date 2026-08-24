package model

import (
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

const (
	SubscriptionQuotaWindowPrimary = "primary"
	SubscriptionQuotaWindowAll     = "all"

	SubscriptionQuotaPeriodHour  = "hour"
	SubscriptionQuotaPeriodDay   = "day"
	SubscriptionQuotaPeriodWeek  = "week"
	SubscriptionQuotaPeriodMonth = "month"

	SubscriptionMaxExtraQuotaWindows = 2
)

var ErrSubscriptionQuotaWindowExceeded = errors.New("subscription quota window exceeded")

// SubscriptionQuotaWindowConfig is persisted as JSON on a plan. The config is
// converted into an independent counter row when a new subscription is opened.
// Existing subscriptions are deliberately not backfilled.
type SubscriptionQuotaWindowConfig struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	PeriodUnit  string `json:"period_unit"`
	PeriodValue int    `json:"period_value"`
	AmountTotal int64  `json:"amount_total"`
}

// UserSubscriptionQuotaWindow is a purchase-time snapshot and atomic usage
// counter for one additional quota window.
type UserSubscriptionQuotaWindow struct {
	Id                 int    `json:"id"`
	UserSubscriptionId int    `json:"user_subscription_id" gorm:"uniqueIndex:idx_user_subscription_window_key,priority:1;index"`
	WindowKey          string `json:"window_key" gorm:"type:varchar(32);uniqueIndex:idx_user_subscription_window_key,priority:2"`
	Name               string `json:"name" gorm:"type:varchar(64);not null"`
	PeriodUnit         string `json:"period_unit" gorm:"type:varchar(16);not null"`
	PeriodValue        int    `json:"period_value" gorm:"type:int;not null"`
	AmountTotal        int64  `json:"amount_total" gorm:"type:bigint;not null"`
	AmountUsed         int64  `json:"amount_used" gorm:"type:bigint;not null;default:0"`
	WindowStart        int64  `json:"window_start" gorm:"type:bigint;not null"`
	NextResetTime      int64  `json:"next_reset_time" gorm:"type:bigint;default:0;index"`
	CreatedAt          int64  `json:"created_at" gorm:"bigint"`
	UpdatedAt          int64  `json:"updated_at" gorm:"bigint"`
}

func (w *UserSubscriptionQuotaWindow) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	w.CreatedAt = now
	w.UpdatedAt = now
	return nil
}

func (w *UserSubscriptionQuotaWindow) BeforeUpdate(tx *gorm.DB) error {
	w.UpdatedAt = common.GetTimestamp()
	return nil
}

func parseSubscriptionQuotaWindowConfigs(raw string) ([]SubscriptionQuotaWindowConfig, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "null" || raw == "[]" {
		return []SubscriptionQuotaWindowConfig{}, nil
	}
	var configs []SubscriptionQuotaWindowConfig
	if err := common.UnmarshalJsonStr(raw, &configs); err != nil {
		return nil, fmt.Errorf("invalid quota_windows: %w", err)
	}
	return configs, nil
}

// NormalizeAndSerializeSubscriptionQuotaWindows validates plan configuration,
// assigns stable keys to new rows, and returns its canonical JSON form.
func NormalizeAndSerializeSubscriptionQuotaWindows(raw string) (string, error) {
	configs, err := parseSubscriptionQuotaWindowConfigs(raw)
	if err != nil {
		return "", err
	}
	if len(configs) == 0 {
		return "", nil
	}
	if len(configs) > SubscriptionMaxExtraQuotaWindows {
		return "", fmt.Errorf("additional quota windows cannot exceed %d", SubscriptionMaxExtraQuotaWindows)
	}
	seenKeys := make(map[string]struct{}, len(configs))
	for i := range configs {
		config := &configs[i]
		config.Key = strings.TrimSpace(config.Key)
		if config.Key == "" {
			config.Key = fmt.Sprintf("window_%d", i+1)
		}
		if !validSubscriptionQuotaWindowKey(config.Key) {
			return "", fmt.Errorf("invalid quota window key: %s", config.Key)
		}
		if config.Key == SubscriptionQuotaWindowPrimary || config.Key == SubscriptionQuotaWindowAll {
			return "", fmt.Errorf("reserved quota window key: %s", config.Key)
		}
		if _, exists := seenKeys[config.Key]; exists {
			return "", fmt.Errorf("duplicate quota window key: %s", config.Key)
		}
		seenKeys[config.Key] = struct{}{}

		config.Name = strings.TrimSpace(config.Name)
		if config.Name == "" {
			config.Name = fmt.Sprintf("Window %d", i+1)
		}
		if utf8.RuneCountInString(config.Name) > 64 {
			return "", errors.New("quota window name cannot exceed 64 characters")
		}
		if config.PeriodValue <= 0 {
			return "", errors.New("quota window period must be greater than zero")
		}
		switch config.PeriodUnit {
		case SubscriptionQuotaPeriodHour, SubscriptionQuotaPeriodDay, SubscriptionQuotaPeriodWeek, SubscriptionQuotaPeriodMonth:
		default:
			return "", fmt.Errorf("unsupported quota window period unit: %s", config.PeriodUnit)
		}
		if config.AmountTotal <= 0 {
			return "", errors.New("quota window amount must be greater than zero")
		}
	}
	encoded, err := common.Marshal(configs)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

func validSubscriptionQuotaWindowKey(key string) bool {
	if key == "" || len(key) > 32 {
		return false
	}
	for _, char := range key {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') || char == '_' || char == '-' {
			continue
		}
		return false
	}
	return true
}

func normalizeSubscriptionQuotaWindowKey(windowKey string) (string, error) {
	windowKey = strings.TrimSpace(windowKey)
	if windowKey == "" {
		return SubscriptionQuotaWindowPrimary, nil
	}
	if windowKey == SubscriptionQuotaWindowPrimary || windowKey == SubscriptionQuotaWindowAll {
		return windowKey, nil
	}
	if !validSubscriptionQuotaWindowKey(windowKey) {
		return "", fmt.Errorf("invalid subscription quota window key: %s", windowKey)
	}
	return windowKey, nil
}

func addMonthsClamped(base time.Time, months int) time.Time {
	firstOfTargetMonth := time.Date(base.Year(), base.Month(), 1, base.Hour(), base.Minute(), base.Second(), base.Nanosecond(), base.Location()).
		AddDate(0, months, 0)
	lastDay := firstOfTargetMonth.AddDate(0, 1, -1).Day()
	day := base.Day()
	if day > lastDay {
		day = lastDay
	}
	return time.Date(firstOfTargetMonth.Year(), firstOfTargetMonth.Month(), day,
		base.Hour(), base.Minute(), base.Second(), base.Nanosecond(), base.Location())
}

// calcSubscriptionQuotaWindow returns the fixed window containing now. Every
// window is anchored to the subscription opening time. Month windows preserve
// the opening day where possible and clamp to the target month's last day.
func calcSubscriptionQuotaWindow(startUnix, nowUnix, endUnix int64, periodUnit string, periodValue int) (int64, int64, error) {
	if startUnix <= 0 || periodValue <= 0 {
		return 0, 0, errors.New("invalid quota window boundary args")
	}
	if nowUnix < startUnix {
		nowUnix = startUnix
	}
	if periodUnit == SubscriptionQuotaPeriodMonth {
		start := time.Unix(startUnix, 0)
		now := time.Unix(nowUnix, 0)
		monthDistance := (now.Year()-start.Year())*12 + int(now.Month()-start.Month())
		windowIndex := monthDistance / periodValue
		windowStart := addMonthsClamped(start, windowIndex*periodValue)
		if windowStart.After(now) && windowIndex > 0 {
			windowIndex--
			windowStart = addMonthsClamped(start, windowIndex*periodValue)
		}
		nextReset := addMonthsClamped(start, (windowIndex+1)*periodValue).Unix()
		if endUnix > 0 && nextReset > endUnix {
			nextReset = 0
		}
		return windowStart.Unix(), nextReset, nil
	}

	secondsPerUnit := int64(0)
	switch periodUnit {
	case SubscriptionQuotaPeriodHour:
		secondsPerUnit = 60 * 60
	case SubscriptionQuotaPeriodDay:
		secondsPerUnit = 24 * 60 * 60
	case SubscriptionQuotaPeriodWeek:
		secondsPerUnit = 7 * 24 * 60 * 60
	default:
		return 0, 0, fmt.Errorf("unsupported quota window period unit: %s", periodUnit)
	}
	if int64(periodValue) > int64(1<<63-1)/secondsPerUnit {
		return 0, 0, errors.New("quota window period is too large")
	}
	windowSeconds := int64(periodValue) * secondsPerUnit
	elapsed := nowUnix - startUnix
	windowIndex := elapsed / windowSeconds
	if windowIndex > (int64(1<<63-1)-startUnix)/windowSeconds {
		return 0, 0, errors.New("quota window boundary overflow")
	}
	windowStart := startUnix + windowIndex*windowSeconds
	if windowStart > int64(1<<63-1)-windowSeconds {
		return windowStart, 0, nil
	}
	nextReset := windowStart + windowSeconds
	if endUnix > 0 && nextReset > endUnix {
		nextReset = 0
	}
	return windowStart, nextReset, nil
}

func createSubscriptionQuotaWindowsTx(tx *gorm.DB, sub *UserSubscription, rawConfig string) error {
	if tx == nil || sub == nil || sub.Id <= 0 {
		return errors.New("invalid subscription quota window create args")
	}
	normalizedConfig, err := NormalizeAndSerializeSubscriptionQuotaWindows(rawConfig)
	if err != nil {
		return err
	}
	configs, err := parseSubscriptionQuotaWindowConfigs(normalizedConfig)
	if err != nil {
		return err
	}
	if len(configs) == 0 {
		return nil
	}
	if len(configs) > SubscriptionMaxExtraQuotaWindows {
		return fmt.Errorf("additional quota windows cannot exceed %d", SubscriptionMaxExtraQuotaWindows)
	}
	windows := make([]UserSubscriptionQuotaWindow, 0, len(configs))
	for _, config := range configs {
		windowStart, nextReset, err := calcSubscriptionQuotaWindow(
			sub.StartTime, sub.StartTime, sub.EndTime, config.PeriodUnit, config.PeriodValue,
		)
		if err != nil {
			return err
		}
		windows = append(windows, UserSubscriptionQuotaWindow{
			UserSubscriptionId: sub.Id,
			WindowKey:          config.Key,
			Name:               config.Name,
			PeriodUnit:         config.PeriodUnit,
			PeriodValue:        config.PeriodValue,
			AmountTotal:        config.AmountTotal,
			AmountUsed:         0,
			WindowStart:        windowStart,
			NextResetTime:      nextReset,
		})
	}
	return tx.Create(&windows).Error
}

func findSubscriptionQuotaWindowsForUpdateTx(tx *gorm.DB, sub *UserSubscription) ([]UserSubscriptionQuotaWindow, error) {
	if tx == nil || sub == nil {
		return nil, errors.New("invalid subscription quota window load args")
	}
	var windows []UserSubscriptionQuotaWindow
	if err := lockForUpdate(tx).
		Where("user_subscription_id = ?", sub.Id).
		Order("id asc").
		Find(&windows).Error; err != nil {
		return nil, err
	}
	return windows, nil
}

func loadSubscriptionQuotaWindowsForUpdateTx(tx *gorm.DB, sub *UserSubscription, now int64) ([]UserSubscriptionQuotaWindow, bool, error) {
	windows, err := findSubscriptionQuotaWindowsForUpdateTx(tx, sub)
	if err != nil {
		return nil, false, err
	}
	changed := false
	for i := range windows {
		window := &windows[i]
		if window.NextResetTime <= 0 || window.NextResetTime > now {
			continue
		}
		windowStart, nextReset, err := calcSubscriptionQuotaWindow(
			sub.StartTime, now, sub.EndTime, window.PeriodUnit, window.PeriodValue,
		)
		if err != nil {
			return nil, false, err
		}
		window.AmountUsed = 0
		window.WindowStart = windowStart
		window.NextResetTime = nextReset
		if err := tx.Save(window).Error; err != nil {
			return nil, false, err
		}
		changed = true
	}
	return windows, changed, nil
}

func checkSubscriptionQuotaWindows(windows []UserSubscriptionQuotaWindow, amount int64) error {
	for _, window := range windows {
		if window.AmountUsed < 0 || window.AmountUsed >= window.AmountTotal || amount > window.AmountTotal-window.AmountUsed {
			return fmt.Errorf("%w: key=%s need=%d", ErrSubscriptionQuotaWindowExceeded, window.WindowKey, amount)
		}
	}
	return nil
}

func applySubscriptionQuotaWindowDeltaRowsTx(tx *gorm.DB, windows []UserSubscriptionQuotaWindow, delta int64) error {
	for i := range windows {
		window := &windows[i]
		newUsed := int64(0)
		if delta > 0 {
			if window.AmountUsed < 0 || window.AmountUsed > window.AmountTotal || delta > window.AmountTotal-window.AmountUsed {
				return fmt.Errorf("subscription quota window used exceeds total, key=%s delta=%d total=%d",
					window.WindowKey, delta, window.AmountTotal)
			}
			newUsed = window.AmountUsed + delta
		} else if delta > -window.AmountUsed {
			newUsed = window.AmountUsed + delta
		}
		window.AmountUsed = newUsed
		if err := tx.Save(window).Error; err != nil {
			return err
		}
	}
	return nil
}

func applySubscriptionQuotaWindowDeltaTx(tx *gorm.DB, sub *UserSubscription, delta int64) error {
	windows, err := findSubscriptionQuotaWindowsForUpdateTx(tx, sub)
	if err != nil {
		return err
	}
	return applySubscriptionQuotaWindowDeltaRowsTx(tx, windows, delta)
}

func resetSubscriptionQuotaWindowTx(tx *gorm.DB, sub *UserSubscription, windowKey string) (bool, error) {
	if tx == nil || sub == nil {
		return false, errors.New("invalid subscription quota window reset args")
	}
	windowKey = strings.TrimSpace(windowKey)
	if windowKey == "" {
		windowKey = SubscriptionQuotaWindowPrimary
	}
	query := lockForUpdate(tx).Where("user_subscription_id = ?", sub.Id)
	if windowKey != SubscriptionQuotaWindowAll {
		query = query.Where("window_key = ?", windowKey)
	}
	var windows []UserSubscriptionQuotaWindow
	if err := query.Order("id asc").Find(&windows).Error; err != nil {
		return false, err
	}
	if len(windows) == 0 {
		return false, nil
	}
	for i := range windows {
		windows[i].AmountUsed = 0
		if err := tx.Save(&windows[i]).Error; err != nil {
			return false, err
		}
	}
	return true, nil
}
