package model

import (
	"errors"
	"math"
	"time"

	"gorm.io/gorm"
)

// ValidateSubscriptionPurchase checks checkout eligibility without changing state.
// Renewals bypass the new-purchase limit only for an owned, matching subscription.
func ValidateSubscriptionPurchase(userId int, plan *SubscriptionPlan, renewalSubscriptionId int) error {
	return validateSubscriptionPurchaseTx(DB, userId, plan, renewalSubscriptionId)
}

func validateSubscriptionPurchaseTx(tx *gorm.DB, userId int, plan *SubscriptionPlan, renewalSubscriptionId int) error {
	if tx == nil || userId <= 0 || plan == nil || plan.Id <= 0 || renewalSubscriptionId < 0 {
		return errors.New("invalid subscription purchase")
	}
	if renewalSubscriptionId > 0 {
		var count int64
		if err := tx.Model(&UserSubscription{}).
			Where("id = ? AND user_id = ? AND plan_id = ? AND status IN ?", renewalSubscriptionId, userId, plan.Id, []string{"active", "expired"}).
			Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			return errors.New("订阅不存在或不可续费")
		}
		return nil
	}
	if plan.MaxPurchasePerUser > 0 {
		var count int64
		if err := tx.Model(&UserSubscription{}).Where("user_id = ? AND plan_id = ?", userId, plan.Id).Count(&count).Error; err != nil {
			return err
		}
		if count >= int64(plan.MaxPurchasePerUser) {
			return errors.New("已达到该套餐购买上限")
		}
	}
	return nil
}

// Called inside the payment transaction, so quota, duration and order settlement
// commit together. The user lock also serializes separate orders renewing an
// expired subscription, including payments from different gateways.
func fulfillSubscriptionPurchaseTx(tx *gorm.DB, userId int, plan *SubscriptionPlan, source string, renewalSubscriptionId int) (*UserSubscription, error) {
	if tx == nil || userId <= 0 || plan == nil || plan.Id <= 0 || renewalSubscriptionId < 0 {
		return nil, errors.New("invalid subscription purchase")
	}
	var user User
	if err := lockForUpdate(tx).Select("id").Where("id = ?", userId).First(&user).Error; err != nil {
		return nil, err
	}
	if renewalSubscriptionId == 0 {
		return CreateUserSubscriptionFromPlanTx(tx, userId, plan, source)
	}
	var sub UserSubscription
	if err := lockForUpdate(tx).
		Where("id = ? AND user_id = ? AND plan_id = ? AND status IN ?", renewalSubscriptionId, userId, plan.Id, []string{"active", "expired"}).
		First(&sub).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errors.New("订阅不存在或不可续费")
		}
		return nil, err
	}
	now := getDBTimestampTx(tx)
	if sub.Status != "active" || sub.EndTime <= now {
		// Another paid renewal may already have opened the next subscription.
		var active UserSubscription
		result := lockForUpdate(tx).
			Where("user_id = ? AND plan_id = ? AND status = ? AND end_time > ?", userId, plan.Id, "active", now).
			Order("end_time desc, id desc").Limit(1).Find(&active)
		if result.Error != nil {
			return nil, result.Error
		}
		if result.RowsAffected == 0 {
			// Keep the old counters for late settlements and history.
			renewed, err := createUserSubscriptionFromPlanTx(tx, userId, plan, source)
			if err != nil {
				return nil, err
			}
			// Expiry maintenance may not yet have reverted the previous upgrade.
			if renewed.PrevUserGroup == "" && renewed.UpgradeGroup != "" && renewed.UpgradeGroup == sub.UpgradeGroup && sub.PrevUserGroup != "" {
				renewed.PrevUserGroup = sub.PrevUserGroup
				if err := tx.Model(renewed).Update("prev_user_group", renewed.PrevUserGroup).Error; err != nil {
					return nil, err
				}
			}
			return renewed, nil
		}
		sub = active
	}
	endTime, err := calcPlanEndTime(time.Unix(sub.EndTime, 0), plan)
	if err != nil {
		return nil, err
	}
	if endTime <= sub.EndTime {
		return nil, errors.New("续费时长无效")
	}
	sub.EndTime = endTime
	// A non-resetting quota pack grants another pack's quota; periodic quotas
	// keep the current allowance and all used counters unchanged.
	if NormalizeResetPeriod(plan.QuotaResetPeriod) == SubscriptionResetNever {
		if sub.AmountTotal < 0 || plan.TotalAmount < 0 || sub.AmountTotal > math.MaxInt64-plan.TotalAmount {
			return nil, errors.New("续费额度超出范围")
		}
		if sub.AmountTotal == 0 || plan.TotalAmount == 0 {
			sub.AmountTotal = 0
		} else {
			sub.AmountTotal += plan.TotalAmount
		}
	}
	// Resets beyond the previous expiry were suppressed. Restore them from the
	// original cycle anchor without resetting usage at payment time.
	if sub.NextResetTime == 0 {
		base := sub.LastResetTime
		if base <= 0 {
			base = sub.StartTime
		}
		sub.NextResetTime = calcNextResetTime(time.Unix(base, 0), plan, sub.EndTime)
	}
	if err := tx.Save(&sub).Error; err != nil {
		return nil, err
	}
	windows, err := findSubscriptionQuotaWindowsForUpdateTx(tx, &sub)
	if err != nil {
		return nil, err
	}
	for i := range windows {
		window := &windows[i]
		if window.NextResetTime != 0 {
			continue
		}
		_, nextReset, err := calcSubscriptionQuotaWindow(sub.StartTime, window.WindowStart, sub.EndTime, window.PeriodUnit, window.PeriodValue)
		if err != nil {
			return nil, err
		}
		if err := tx.Model(window).Update("next_reset_time", nextReset).Error; err != nil {
			return nil, err
		}
	}
	return &sub, nil
}
