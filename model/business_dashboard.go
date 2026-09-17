package model

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

var ErrInvalidBusinessPeriod = errors.New("invalid business reporting period")

type BusinessMoney struct {
	Provider string  `json:"provider"`
	Amount   float64 `json:"amount"`
}

type BusinessPlanDay struct {
	PlanId      int   `json:"plan_id"`
	Activations int64 `json:"activations"`
	Renewals    int64 `json:"renewals"`
}

type BusinessDay struct {
	Plans               []BusinessPlanDay `json:"plans"`
	WalletRevenue       float64           `json:"wallet_revenue"`
	SubscriptionRevenue float64           `json:"subscription_revenue"`
	Date                string            `json:"date"`
	NewUsers            int64             `json:"new_users"`
	TopUpOrders         int64             `json:"topup_orders"`
	Subscriptions       int64             `json:"subscriptions"`
	Renewals            int64             `json:"renewals"`
}

type BusinessUser struct {
	Id          int    `json:"id"`
	Username    string `json:"username"`
	CreatedAt   int64  `json:"created_at"`
	TopUpOrders int64  `json:"topup_orders"`
}

type BusinessTopUp struct {
	Id           int     `json:"id"`
	UserId       int     `json:"user_id"`
	Username     string  `json:"username"`
	Money        float64 `json:"money"`
	Provider     string  `json:"provider"`
	CompleteTime int64   `json:"complete_time"`
}

type BusinessPlan struct {
	PlanId         int      `json:"plan_id"`
	Title          string   `json:"title"`
	Activations    int64    `json:"activations"`
	Renewals       int64    `json:"renewals"`
	PreviousOrders int64    `json:"previous_orders"`
	RenewalDue     int64    `json:"renewal_due"`
	Renewed        int64    `json:"renewed"`
	RenewalRate    *float64 `json:"renewal_rate"`
}

type BusinessDashboard struct {
	Sales                   *BusinessSales              `json:"sales"`
	PreviousSales           *BusinessSales              `json:"previous_sales"`
	Activity                *BusinessActivity           `json:"activity"`
	SubscriptionHealth      *BusinessSubscriptionHealth `json:"subscription_health"`
	PreviousStartTimestamp  int64                       `json:"previous_start_timestamp"`
	PreviousEndTimestamp    int64                       `json:"previous_end_timestamp"`
	StartTimestamp          int64                       `json:"start_timestamp"`
	EndTimestamp            int64                       `json:"end_timestamp"`
	NewUsers                int64                       `json:"new_users"`
	TopUpOrders             int64                       `json:"topup_orders"`
	TopUpUsers              int64                       `json:"topup_users"`
	TopUpAmounts            []BusinessMoney             `json:"topup_amounts"`
	NewUserTopUpUsers       int64                       `json:"new_user_topup_users"`
	NewUserTopUpRate        float64                     `json:"new_user_topup_rate"`
	NewUserTopUpAmounts     []BusinessMoney             `json:"new_user_topup_amounts"`
	SubscriptionActivations int64                       `json:"subscription_activations"`
	SubscriptionRenewals    int64                       `json:"subscription_renewals"`
	AdminGrants             int64                       `json:"admin_grants"`
	Daily                   []BusinessDay               `json:"daily"`
	RecentUsers             []BusinessUser              `json:"recent_users"`
	RecentTopUps            []BusinessTopUp             `json:"recent_topups"`
	Plans                   []BusinessPlan              `json:"plans"`
}

// Historical top-ups did not always persist payment_provider. Keep unknown
// providers separate: their recorded amounts cannot safely be converted to CNY.
const businessProviderSQL = `CASE
 WHEN COALESCE(t.payment_provider, '') <> '' THEN t.payment_provider
 WHEN t.payment_method IN ('alipay', 'wxpay', 'qqpay', 'bank') THEN 'epay'
 ELSE COALESCE(NULLIF(t.payment_method, ''), 'unknown') END`

// Wallet top-ups only. Subscription checkouts mirror their order in top_ups;
// excluding that mirror avoids both misclassifying subscribers and double counts.
func businessTopUps(db *gorm.DB, start, end int64) *gorm.DB {
	return db.Table("top_ups AS t").Where("t.status = ? AND t.money > 0 AND t.complete_time >= ? AND t.complete_time < ?", common.TopUpStatusSuccess, start, end).
		Where("COALESCE(t.payment_provider, '') <> ? AND COALESCE(t.payment_method, '') <> ?", PaymentProviderBalance, PaymentMethodBalance).
		Where("NOT EXISTS (?)", db.Model(&SubscriptionOrder{}).Select("1").Where("subscription_orders.trade_no = t.trade_no"))
}

// Calendar days in UTC+8, including the partial current day. All financial
// events use completion time, never checkout creation time. No user secrets or
// payment payloads are loaded by this read-only aggregate.
func GetBusinessDashboard(ctx context.Context, days, offset int, now time.Time) (*BusinessDashboard, error) {
	if (days != 1 && days != 3 && days != 7 && days != 30 && days != 90) || offset < 0 || offset > 1 || (offset == 1 && days != 1) {
		return nil, ErrInvalidBusinessPeriod
	}
	local := now.In(time.FixedZone("UTC+8", 8*3600))
	start := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, local.Location()).AddDate(0, 0, 1-days).Unix()
	end := now.Unix() + 1
	if offset == 1 {
		end = start
		start -= 86400
	}
	return getBusinessDashboard(ctx, start, end, int64(days)*86400, now)
}

// Custom windows are [start, end), with an immediately preceding comparison
// window of the same duration. Keep arbitrary queries bounded to 30 days.
func GetBusinessDashboardRange(ctx context.Context, start, end int64, now time.Time) (*BusinessDashboard, error) {
	if start <= 0 || end <= start || end > now.Unix()+1 || end-start > 30*86400 {
		return nil, ErrInvalidBusinessPeriod
	}
	return getBusinessDashboard(ctx, start, end, end-start, now)
}

func getBusinessDashboard(ctx context.Context, start, end, comparisonShift int64, now time.Time) (*BusinessDashboard, error) {
	local := time.Unix(start, 0).In(time.FixedZone("UTC+8", 8*3600))
	// Custom windows may start mid-day; chart buckets still follow Beijing dates.
	bucketStart := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, local.Location()).Unix()
	days := int((end-1-bucketStart)/86400) + 1
	result := &BusinessDashboard{StartTimestamp: start, EndTimestamp: end,
		TopUpAmounts: []BusinessMoney{}, NewUserTopUpAmounts: []BusinessMoney{},
		Daily: make([]BusinessDay, days), RecentUsers: []BusinessUser{}, RecentTopUps: []BusinessTopUp{}, Plans: []BusinessPlan{}}
	for i := range result.Daily {
		result.Daily[i].Date = time.Unix(bucketStart+int64(i)*86400, 0).In(local.Location()).Format("2006-01-02")
	}
	db := DB.WithContext(ctx)
	result.PreviousStartTimestamp = start - comparisonShift
	result.PreviousEndTimestamp = end - comparisonShift
	var err error
	result.Sales, err = getBusinessSales(db, start, end)
	if err != nil {
		return nil, err
	}
	result.PreviousSales, err = getBusinessSales(db, result.PreviousStartTimestamp, result.PreviousEndTimestamp)
	if err != nil {
		return nil, err
	}
	result.SubscriptionHealth, err = getBusinessSubscriptionHealth(db, start, end, now.Unix())
	if err != nil {
		return nil, err
	}
	result.Activity, err = getBusinessActivity(ctx, start, end, result.PreviousStartTimestamp, result.PreviousEndTimestamp)
	if err != nil {
		common.SysError("business activity unavailable: " + err.Error())
		result.Activity = nil
	}

	// Include soft-deleted registrations in historical cohorts, preserving the denominator.
	cohort := db.Unscoped().Model(&User{}).Where("created_at >= ? AND created_at < ?", start, end)
	if err := cohort.Count(&result.NewUsers).Error; err != nil {
		return nil, err
	}
	var topupStats struct {
		Orders int64
		Users  int64
	}
	if err := businessTopUps(db, start, end).Select("COUNT(*) AS orders, COUNT(DISTINCT t.user_id) AS users").Scan(&topupStats).Error; err != nil {
		return nil, err
	}
	result.TopUpOrders, result.TopUpUsers = topupStats.Orders, topupStats.Users
	if err := businessTopUps(db, start, end).Select(businessProviderSQL + " AS provider, SUM(t.money) AS amount").Group(businessProviderSQL).Order("provider").Scan(&result.TopUpAmounts).Error; err != nil {
		return nil, err
	}
	cohortIds := db.Unscoped().Model(&User{}).Select("id").Where("created_at >= ? AND created_at < ?", start, end)
	if err := businessTopUps(db, start, end).Where("t.user_id IN (?)", cohortIds).Distinct("t.user_id").Count(&result.NewUserTopUpUsers).Error; err != nil {
		return nil, err
	}
	if result.NewUsers > 0 {
		result.NewUserTopUpRate = float64(result.NewUserTopUpUsers) / float64(result.NewUsers) * 100
	}
	if err := businessTopUps(db, start, end).Where("t.user_id IN (?)", cohortIds).Select(businessProviderSQL + " AS provider, SUM(t.money) AS amount").Group(businessProviderSQL).Order("provider").Scan(&result.NewUserTopUpAmounts).Error; err != nil {
		return nil, err
	}
	if err := db.Table("subscription_orders AS o").Joins("LEFT JOIN subscription_plans AS p ON p.id = o.plan_id").
		Where("o.status = ? AND o.complete_time >= ? AND o.complete_time < ?", common.TopUpStatusSuccess, start, end).
		Select("o.plan_id, COALESCE(p.title, '') AS title, SUM(CASE WHEN COALESCE(o.renewal_subscription_id, 0) = 0 THEN 1 ELSE 0 END) AS activations, SUM(CASE WHEN o.renewal_subscription_id > 0 THEN 1 ELSE 0 END) AS renewals").
		Group("o.plan_id, p.title").Order("activations DESC, renewals DESC, o.plan_id").Scan(&result.Plans).Error; err != nil {
		return nil, err
	}
	for _, p := range result.Plans {
		result.SubscriptionActivations += p.Activations
		result.SubscriptionRenewals += p.Renewals
	}
	// Drive plan cards and chart series from the enabled catalog, keyed by ID.
	// Names are presentation only; renames never change attribution.
	countedPlans := make(map[int]BusinessPlan, len(result.Plans))
	for _, plan := range result.Plans {
		countedPlans[plan.PlanId] = plan
	}
	var previousPlans []BusinessPlan
	if err := db.Model(&SubscriptionOrder{}).
		Where("status = ? AND complete_time >= ? AND complete_time < ?", common.TopUpStatusSuccess, result.PreviousStartTimestamp, result.PreviousEndTimestamp).
		Select("plan_id, COUNT(*) AS previous_orders").Group("plan_id").Scan(&previousPlans).Error; err != nil {
		return nil, err
	}
	for _, plan := range previousPlans {
		counts := countedPlans[plan.PlanId]
		counts.PreviousOrders = plan.PreviousOrders
		countedPlans[plan.PlanId] = counts
	}
	result.Plans = []BusinessPlan{}
	if err := db.Model(&SubscriptionPlan{}).Where("enabled = ?", true).
		Select("id AS plan_id, title").Order("sort_order DESC, id ASC").Scan(&result.Plans).Error; err != nil {
		return nil, err
	}
	activePlanIndexes := make(map[int]int, len(result.Plans))
	for i := range result.Plans {
		plan := &result.Plans[i]
		counts := countedPlans[plan.PlanId]
		plan.Activations, plan.Renewals = counts.Activations, counts.Renewals
		plan.PreviousOrders = counts.PreviousOrders
		renewals := result.SubscriptionHealth.plans[plan.PlanId]
		plan.RenewalDue, plan.Renewed = renewals.Due, renewals.Renewed
		plan.RenewalRate = renewals.RenewalRate
		activePlanIndexes[plan.PlanId] = i
	}
	for i := range result.Daily {
		result.Daily[i].Plans = make([]BusinessPlanDay, len(result.Plans))
		for j, plan := range result.Plans {
			result.Daily[i].Plans[j].PlanId = plan.PlanId
		}
	}
	if err := db.Model(&UserSubscription{}).Where("source = ? AND created_at >= ? AND created_at < ?", "admin", start, end).Count(&result.AdminGrants).Error; err != nil {
		return nil, err
	}
	paidCounts := businessTopUps(db, start, end).Select("t.user_id, COUNT(*) AS orders").Group("t.user_id")
	if err := db.Table("users AS u").Joins("LEFT JOIN (?) AS paid ON paid.user_id = u.id", paidCounts).
		Where("u.created_at >= ? AND u.created_at < ?", start, end).
		Select("u.id, u.username, u.created_at, COALESCE(paid.orders, 0) AS top_up_orders").Order("u.created_at DESC, u.id DESC").Limit(8).Scan(&result.RecentUsers).Error; err != nil {
		return nil, err
	}
	if err := businessTopUps(db, start, end).Joins("LEFT JOIN users AS u ON u.id = t.user_id").
		Select("t.id, t.user_id, COALESCE(u.username, '') AS username, t.money, " + businessProviderSQL + " AS provider, t.complete_time").Order("t.complete_time DESC, t.id DESC").Limit(8).Scan(&result.RecentTopUps).Error; err != nil {
		return nil, err
	}
	// Integer buckets avoid database-specific date functions; MySQL uses DIV.
	division := "/"
	if db.Dialector.Name() == "mysql" {
		division = "DIV"
	}
	for _, series := range []struct {
		query  *gorm.DB
		column string
		kind   int
	}{
		{db.Unscoped().Model(&User{}).Where("created_at >= ? AND created_at < ?", start, end), "created_at", 0},
		{businessTopUps(db, start, end), "t.complete_time", 1},
	} {
		var rows []struct {
			Bucket int
			Total  int64
		}
		bucket := fmt.Sprintf("(%s - %d) %s 86400", series.column, bucketStart, division)
		if err := series.query.Select(bucket + " AS bucket, COUNT(*) AS total").Group(bucket).Scan(&rows).Error; err != nil {
			return nil, err
		}
		for _, row := range rows {
			if row.Bucket < 0 || row.Bucket >= days {
				continue
			}
			switch series.kind {
			case 0:
				result.Daily[row.Bucket].NewUsers = row.Total
			case 1:
				result.Daily[row.Bucket].TopUpOrders = row.Total
			}
		}
	}
	var subscriptionDays []struct {
		Bucket      int
		PlanId      int
		Activations int64
		Renewals    int64
	}
	subscriptionBucket := fmt.Sprintf("(complete_time - %d) %s 86400", bucketStart, division)
	if err := db.Model(&SubscriptionOrder{}).
		Where("status = ? AND complete_time >= ? AND complete_time < ?", common.TopUpStatusSuccess, start, end).
		Select(subscriptionBucket + " AS bucket, plan_id, SUM(CASE WHEN COALESCE(renewal_subscription_id, 0) = 0 THEN 1 ELSE 0 END) AS activations, SUM(CASE WHEN renewal_subscription_id > 0 THEN 1 ELSE 0 END) AS renewals").
		Group(subscriptionBucket + ", plan_id").Scan(&subscriptionDays).Error; err != nil {
		return nil, err
	}
	for _, row := range subscriptionDays {
		if row.Bucket < 0 || row.Bucket >= days {
			continue
		}
		day := &result.Daily[row.Bucket]
		day.Subscriptions += row.Activations
		day.Renewals += row.Renewals
		if index, exists := activePlanIndexes[row.PlanId]; exists {
			day.Plans[index].Activations = row.Activations
			day.Plans[index].Renewals = row.Renewals
		}
	}
	// The stacked revenue series uses the same external-payment ledger and
	// currency as total revenue, excluding wallet transfers and payment mirrors.
	var revenueDays []struct {
		Bucket              int
		WalletRevenue       float64
		SubscriptionRevenue float64
	}
	revenueBucket := fmt.Sprintf("(complete_time - %d) %s 86400", bucketStart, division)
	if err := businessPayments(db, start, end).Where("provider = ?", PaymentProviderEpay).
		Select(revenueBucket + " AS bucket, SUM(CASE WHEN payment_kind = 'wallet' THEN money ELSE 0 END) AS wallet_revenue, SUM(CASE WHEN payment_kind = 'subscription' THEN money ELSE 0 END) AS subscription_revenue").
		Group(revenueBucket).Scan(&revenueDays).Error; err != nil {
		return nil, err
	}
	for _, day := range revenueDays {
		if day.Bucket >= 0 && day.Bucket < days {
			result.Daily[day.Bucket].WalletRevenue = day.WalletRevenue
			result.Daily[day.Bucket].SubscriptionRevenue = day.SubscriptionRevenue
		}
	}
	return result, nil
}
