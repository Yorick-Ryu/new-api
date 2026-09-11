package model

import (
	"errors"
	"fmt"
	"math"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// Model multipliers apply to subscription quota only, after normal model pricing.
// Exact requested model names are used; an unlisted model consumes at 1x.
func ParseSubscriptionModelMultipliers(raw string) (map[string]float64, error) {
	multipliers := make(map[string]float64)
	if strings.TrimSpace(raw) == "" {
		return multipliers, nil
	}
	if len(raw) > 32768 {
		return nil, errors.New("subscription model multipliers are too large")
	}
	if err := common.UnmarshalJsonStr(raw, &multipliers); err != nil || multipliers == nil {
		return nil, errors.New("subscription model multipliers must be a JSON object")
	}
	if len(multipliers) > 100 {
		return nil, errors.New("at most 100 subscription model multipliers are allowed")
	}
	for name, multiplier := range multipliers {
		if name == "" || strings.TrimSpace(name) != name || len(name) > 200 || strings.Contains(name, "*") {
			return nil, fmt.Errorf("invalid subscription model name: %q", name)
		}
		if math.IsNaN(multiplier) || math.IsInf(multiplier, 0) || multiplier < 0.001 || multiplier > 1000 {
			return nil, fmt.Errorf("subscription model multiplier for %s must be between 0.001 and 1000", name)
		}
	}
	return multipliers, nil
}

func NormalizeSubscriptionModelMultipliers(raw string) (string, error) {
	multipliers, err := ParseSubscriptionModelMultipliers(raw)
	if err != nil {
		return "", err
	}
	encoded, err := common.Marshal(multipliers)
	return string(encoded), err
}

// SubscriptionQuotaWithMultiplier rounds the total, never a delta, so partial
// reservations, settlement and refunds agree even for fractional multipliers.
func SubscriptionQuotaWithMultiplier(amount int64, multiplier float64) (int64, error) {
	if amount < 0 || amount > common.MaxQuota || math.IsNaN(multiplier) || math.IsInf(multiplier, 0) || multiplier < 0.001 || multiplier > 1000 {
		return 0, errors.New("invalid subscription quota or model multiplier")
	}
	quota, err := common.QuotaRoundStrict(float64(amount) * multiplier)
	if err != nil {
		return 0, err
	}
	if amount > 0 && quota == 0 {
		quota = 1
	}
	return int64(quota), nil
}

// UpdateSubscriptionPreConsumeAmount keeps the full reservation in the
// idempotency record, so a failed request can refund additional reservations
// in the same transaction, including every quota window.
func UpdateSubscriptionPreConsumeAmount(requestId string, amount int64) error {
	if requestId == "" || amount < 0 || amount > common.MaxQuota {
		return errors.New("invalid subscription reservation")
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var record SubscriptionPreConsumeRecord
		if err := lockForUpdate(tx).Where("request_id = ?", requestId).First(&record).Error; err != nil {
			return err
		}
		if record.Status != "consumed" {
			return errors.New("subscription reservation is already refunded")
		}
		if err := postConsumeUserSubscriptionDeltaTx(tx, record.UserSubscriptionId, amount-record.PreConsumed); err != nil {
			return err
		}
		return tx.Model(&record).Update("pre_consumed", amount).Error
	})
}
