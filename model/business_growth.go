package model

import (
	"context"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const BusinessRenewalTrackingKey = "BusinessRenewalTrackingStartedAt"

// The marker is immutable: historical renewals did not retain their original
// expiry, so the dashboard must not pretend the old denominator is complete.
func InitializeBusinessRenewalTracking() error {
	return DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&Option{Key: BusinessRenewalTrackingKey, Value: strconv.FormatInt(time.Now().Unix(), 10)}).Error
}

type BusinessSales struct {
	SubscriptionRevenue float64 `json:"subscription_revenue"`
	RevenuePayingUsers  int64   `json:"revenue_paying_users"`
	Revenue             float64 `json:"revenue"`
	UnverifiedOrders    int64   `json:"unverified_orders"`
	PayingUsers         int64   `json:"paying_users"`
	FirstPayingUsers    int64   `json:"first_paying_users"`
	NewUsers            int64   `json:"new_users"`
}

type BusinessActivity struct {
	Users         int64 `json:"users"`
	PreviousUsers int64 `json:"previous_users"`
	LastDayUsers  int64 `json:"last_day_users"`
	SevenDayUsers int64 `json:"seven_day_users"`
}

type BusinessSubscriptionHealth struct {
	Active         int64    `json:"active"`
	Expiring       int64    `json:"expiring"`
	Due            int64    `json:"due"`
	Renewed        int64    `json:"renewed"`
	RenewalRate    *float64 `json:"renewal_rate"`
	TrackingSince  int64    `json:"tracking_since"`
	PartialHistory bool     `json:"partial_history"`
	plans          map[int]businessPlanRenewal
}

type businessPlanRenewal struct {
	PlanId      int
	Due         int64
	Renewed     int64
	RenewalRate *float64
}

// Union the two payment ledgers, excluding subscription mirrors and internal
// wallet transfers. A positive external payment establishes a payer even when
// its gateway did not persist a verifiable cash amount/currency.
func businessPayments(db *gorm.DB, start, end int64) *gorm.DB {
	wallet := businessTopUps(db, start, end).Select("t.user_id, t.complete_time, t.money, " + businessProviderSQL + " AS provider, 'wallet' AS payment_kind")
	subscriptions := db.Table("subscription_orders AS t").
		Where("t.status = ? AND t.money > 0 AND t.complete_time >= ? AND t.complete_time < ?", common.TopUpStatusSuccess, start, end).
		Where("COALESCE(t.payment_provider, '') <> ? AND COALESCE(t.payment_method, '') <> ?", PaymentProviderBalance, PaymentMethodBalance).
		Select("t.user_id, t.complete_time, t.money, " + businessProviderSQL + " AS provider, 'subscription' AS payment_kind")
	return db.Table("(? UNION ALL ?) AS payments", wallet, subscriptions)
}

func getBusinessSales(db *gorm.DB, start, end int64) (*BusinessSales, error) {
	result := &BusinessSales{}
	// Epay records actual CNY. Stripe wallet Money can represent credited units;
	// other gateways can have product-specific currencies, so do not invent cash.
	if err := businessPayments(db, start, end).Select(
		"COALESCE(SUM(CASE WHEN provider = 'epay' THEN money ELSE 0 END), 0) AS revenue, " +
			"COALESCE(SUM(CASE WHEN provider = 'epay' AND payment_kind = 'subscription' THEN money ELSE 0 END), 0) AS subscription_revenue, " +
			"COUNT(DISTINCT CASE WHEN provider = 'epay' THEN user_id END) AS revenue_paying_users, " +
			"COALESCE(SUM(CASE WHEN provider <> 'epay' THEN 1 ELSE 0 END), 0) AS unverified_orders, COUNT(DISTINCT user_id) AS paying_users",
	).Scan(result).Error; err != nil {
		return nil, err
	}
	if err := db.Unscoped().Model(&User{}).Where("created_at >= ? AND created_at < ?", start, end).Count(&result.NewUsers).Error; err != nil {
		return nil, err
	}
	candidates := businessPayments(db, start, end).Select("DISTINCT user_id")
	firstPayments := businessPayments(db, 1, end).Where("user_id IN (?)", candidates).Select("user_id").Group("user_id").Having("MIN(complete_time) >= ?", start)
	if err := db.Table("(?) AS first_payments", firstPayments).Count(&result.FirstPayingUsers).Error; err != nil {
		return nil, err
	}
	return result, nil
}

func getBusinessActivity(ctx context.Context, start, end, previousStart, previousEnd int64) (*BusinessActivity, error) {
	if LOG_DB == nil {
		return nil, nil
	}
	result := &BusinessActivity{}
	local := time.Unix(end-1, 0).In(time.FixedZone("UTC+8", 28800))
	lastDay := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, local.Location()).Unix()
	sevenDay := lastDay - 6*86400
	minimum := previousStart
	if sevenDay < minimum {
		minimum = sevenDay
	}
	err := LOG_DB.WithContext(ctx).Model(&Log{}).Where("type = ? AND user_id > 0 AND created_at >= ? AND created_at < ?", LogTypeConsume, minimum, end).
		Select("COUNT(DISTINCT CASE WHEN created_at >= ? THEN user_id END) AS users, COUNT(DISTINCT CASE WHEN created_at >= ? AND created_at < ? THEN user_id END) AS previous_users, COUNT(DISTINCT CASE WHEN created_at >= ? THEN user_id END) AS last_day_users, COUNT(DISTINCT CASE WHEN created_at >= ? THEN user_id END) AS seven_day_users", start, previousStart, previousEnd, lastDay, sevenDay).Scan(result).Error
	return result, err
}

func getBusinessSubscriptionHealth(db *gorm.DB, start, end, now int64) (*BusinessSubscriptionHealth, error) {
	result := &BusinessSubscriptionHealth{}
	if err := db.Model(&UserSubscription{}).Where("status = ? AND start_time <= ? AND end_time > ?", "active", now, now).Count(&result.Active).Error; err != nil {
		return nil, err
	}
	if err := db.Model(&UserSubscription{}).Where("status = ? AND start_time <= ? AND end_time > ? AND end_time <= ?", "active", now, now, now+7*86400).Count(&result.Expiring).Error; err != nil {
		return nil, err
	}
	var option Option
	if err := db.Where(&Option{Key: BusinessRenewalTrackingKey}).Find(&option).Error; err != nil {
		return nil, err
	}
	since, err := strconv.ParseInt(option.Value, 10, 64)
	if err != nil || since <= 0 {
		since = now
	}
	result.TrackingSince = since
	coveredStart := start
	if coveredStart < since {
		coveredStart = since
		result.PartialHistory = true
	}
	if coveredStart >= end {
		return result, nil
	}
	// Each (subscription, original due time) is a distinct expiry opportunity.
	// Include future-recorded late renewals in the denominator, but only count
	// renewal payments completed before the selected period's observation cutoff.
	pending := db.Model(&UserSubscription{}).Select("plan_id, id AS subscription_id, end_time AS due_time, 0 AS renewed").
		Where("source IN ? AND end_time >= ? AND end_time < ?", []string{"order", PaymentMethodBalance}, coveredStart, end)
	renewed := db.Model(&SubscriptionOrder{}).Select("plan_id, renewal_source_id AS subscription_id, renewal_due_time AS due_time, CASE WHEN complete_time < ? THEN 1 ELSE 0 END AS renewed", end).
		Where("status = ? AND renewal_source_id > 0 AND renewal_due_time >= ? AND renewal_due_time < ?", common.TopUpStatusSuccess, coveredStart, end)
	opportunities := db.Table("(? UNION ALL ?) AS opportunities", pending, renewed).Select("plan_id, subscription_id, due_time, MAX(renewed) AS renewed").Group("plan_id, subscription_id, due_time")
	var plans []businessPlanRenewal
	if err := db.Table("(?) AS due_periods", opportunities).Select("plan_id, COUNT(*) AS due, COALESCE(SUM(renewed), 0) AS renewed").Group("plan_id").Scan(&plans).Error; err != nil {
		return nil, err
	}
	result.plans = make(map[int]businessPlanRenewal, len(plans))
	for _, plan := range plans {
		if plan.Due > 0 {
			rate := float64(plan.Renewed) / float64(plan.Due) * 100
			plan.RenewalRate = &rate
		}
		result.plans[plan.PlanId] = plan
		result.Due += plan.Due
		result.Renewed += plan.Renewed
	}
	if result.Due > 0 {
		rate := float64(result.Renewed) / float64(result.Due) * 100
		result.RenewalRate = &rate
	}
	return result, nil
}
