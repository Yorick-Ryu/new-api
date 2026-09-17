package model

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupBusinessDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "business.db")), &gorm.Config{})
	require.NoError(t, err)
	oldDB, oldLogDB := DB, LOG_DB
	DB, LOG_DB = db, nil
	t.Cleanup(func() { DB, LOG_DB = oldDB, oldLogDB; sqlDB, _ := db.DB(); _ = sqlDB.Close() })
	require.NoError(t, db.AutoMigrate(&User{}, &TopUp{}, &SubscriptionOrder{}, &SubscriptionPlan{}, &UserSubscription{}, &Option{}))
	return db
}

func TestBusinessSalesCashAndFirstPayersAcrossLedgers(t *testing.T) {
	db := setupBusinessDatabase(t)
	require.NoError(t, db.Create(&[]SubscriptionOrder{
		{UserId: 1, TradeNo: "prior-sub", Money: 20, PaymentProvider: "epay", Status: common.TopUpStatusSuccess, CompleteTime: 50},
		{UserId: 2, TradeNo: "sub", Money: 30, PaymentProvider: "epay", Status: common.TopUpStatusSuccess, CompleteTime: 110},
		{UserId: 3, TradeNo: "balance", Money: 80, PaymentProvider: "balance", Status: common.TopUpStatusSuccess, CompleteTime: 110},
		{UserId: 4, TradeNo: "pending", Money: 80, PaymentProvider: "epay", Status: common.TopUpStatusPending, CompleteTime: 110},
		{UserId: 5, TradeNo: "free", Money: 0, PaymentProvider: "epay", Status: common.TopUpStatusSuccess, CompleteTime: 110},
		{UserId: 6, TradeNo: "stripe-sub", Money: 10, PaymentProvider: "stripe", Status: common.TopUpStatusSuccess, CompleteTime: 110},
	}).Error)
	require.NoError(t, db.Create(&[]TopUp{
		{UserId: 1, TradeNo: "wallet", Money: 10, PaymentProvider: "epay", Status: common.TopUpStatusSuccess, CompleteTime: 100},
		{UserId: 1, TradeNo: "wallet-repeat", Money: 5, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, CompleteTime: 150},
		{UserId: 2, TradeNo: "sub", Money: 30, PaymentProvider: "epay", Status: common.TopUpStatusSuccess, CompleteTime: 110},
		{UserId: 7, TradeNo: "prior-wallet", Money: 10, PaymentProvider: "epay", Status: common.TopUpStatusSuccess, CompleteTime: 99},
		{UserId: 7, TradeNo: "now-wallet", Money: 7, PaymentProvider: "epay", Status: common.TopUpStatusSuccess, CompleteTime: 199},
		{UserId: 8, TradeNo: "future", Money: 100, PaymentProvider: "epay", Status: common.TopUpStatusSuccess, CompleteTime: 200},
	}).Error)
	sales, err := getBusinessSales(db, 100, 200)
	require.NoError(t, err)
	assert.Equal(t, 52.0, sales.Revenue)
	assert.Equal(t, 30.0, sales.SubscriptionRevenue)
	assert.EqualValues(t, 3, sales.RevenuePayingUsers)
	assert.EqualValues(t, 1, sales.UnverifiedOrders)
	assert.EqualValues(t, 4, sales.PayingUsers)
	assert.EqualValues(t, 2, sales.FirstPayingUsers)
}

func TestBusinessDashboardShortPeriodsAndComparablePreviousWindows(t *testing.T) {
	db := setupBusinessDatabase(t)
	now := time.Date(2026, 9, 17, 4, 0, 0, 0, time.UTC)
	midnight := time.Date(2026, 9, 17, 0, 0, 0, 0, time.FixedZone("UTC+8", 28800)).Unix()
	require.NoError(t, db.Create(&[]User{
		{Username: "before", AffCode: "a", CreatedAt: midnight - 1},
		{Username: "today", AffCode: "b", CreatedAt: midnight},
		{Username: "now", AffCode: "c", CreatedAt: now.Unix()},
		{Username: "after", AffCode: "d", CreatedAt: now.Unix() + 1},
	}).Error)
	for _, tc := range []struct {
		name              string
		days, offset      int
		start, end, count int64
	}{
		{"today", 1, 0, midnight, now.Unix() + 1, 2},
		{"yesterday", 1, 1, midnight - 86400, midnight, 1},
		{"three days", 3, 0, midnight - 2*86400, now.Unix() + 1, 3},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data, err := GetBusinessDashboard(context.Background(), tc.days, tc.offset, now)
			require.NoError(t, err)
			assert.Equal(t, tc.start, data.StartTimestamp)
			assert.Equal(t, tc.end, data.EndTimestamp)
			assert.Equal(t, tc.count, data.NewUsers)
			assert.Equal(t, tc.start-int64(tc.days)*86400, data.PreviousStartTimestamp)
			assert.Equal(t, tc.end-int64(tc.days)*86400, data.PreviousEndTimestamp)
			assert.Len(t, data.Daily, tc.days)
		})
	}
	for _, args := range [][2]int{{3, 1}, {1, 2}, {1, -1}, {2, 0}} {
		_, err := GetBusinessDashboard(context.Background(), args[0], args[1], now)
		assert.Error(t, err)
	}
}

func TestBusinessActivityUsesSeparateConsumeLogsAndDeduplicatesUsers(t *testing.T) {
	setupBusinessDatabase(t)
	logDB, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "logs.db")), &gorm.Config{})
	require.NoError(t, err)
	LOG_DB = logDB
	t.Cleanup(func() { sqlDB, _ := logDB.DB(); _ = sqlDB.Close() })
	require.NoError(t, logDB.AutoMigrate(&Log{}))
	start := time.Date(2026, 9, 17, 0, 0, 0, 0, time.FixedZone("UTC+8", 28800)).Unix()
	require.NoError(t, logDB.Create(&[]Log{
		{UserId: 1, Type: LogTypeConsume, CreatedAt: start},
		{UserId: 1, Type: LogTypeConsume, CreatedAt: start + 1},
		{UserId: 2, Type: LogTypeConsume, CreatedAt: start - 86400},
		{UserId: 3, Type: LogTypeConsume, CreatedAt: start - 86400 + 43200},
		{UserId: 4, Type: LogTypeError, CreatedAt: start + 1},
		{UserId: 0, Type: LogTypeConsume, CreatedAt: start + 1},
		{UserId: 5, Type: LogTypeConsume, CreatedAt: start + 43200},
	}).Error)
	activity, err := getBusinessActivity(context.Background(), start, start+43200, start-86400, start-43200)
	require.NoError(t, err)
	assert.Equal(t, &BusinessActivity{Users: 1, PreviousUsers: 1, LastDayUsers: 1, SevenDayUsers: 3}, activity)
	require.NoError(t, logDB.Migrator().DropTable(&Log{}))
	data, err := GetBusinessDashboard(context.Background(), 1, 0, time.Unix(start+43200, 0))
	require.NoError(t, err)
	assert.Nil(t, data.Activity)
}

func TestBusinessRenewalCohortIncludesEarlyLateAndUnrenewedExpiries(t *testing.T) {
	db := setupBusinessDatabase(t)
	require.NoError(t, db.Create(&Option{Key: BusinessRenewalTrackingKey, Value: "50"}).Error)
	require.NoError(t, InitializeBusinessRenewalTracking())
	var marker Option
	require.NoError(t, db.Where(&Option{Key: BusinessRenewalTrackingKey}).First(&marker).Error)
	assert.Equal(t, "50", marker.Value)
	require.NoError(t, db.Create(&[]UserSubscription{
		{Id: 1, Source: "order", Status: "active", StartTime: 1, EndTime: 400},
		{Id: 2, Source: "balance", Status: "expired", StartTime: 1, EndTime: 150},
		{Id: 3, Source: "order", Status: "expired", StartTime: 1, EndTime: 180},
		{Id: 4, Source: "order", Status: "active", StartTime: 1, EndTime: 500},
		{Id: 5, Source: "admin", Status: "expired", StartTime: 1, EndTime: 170},
		{Id: 6, Source: "order", Status: "active", StartTime: 1, EndTime: 200 + 8*86400},
	}).Error)
	require.NoError(t, db.Create(&[]SubscriptionOrder{
		{TradeNo: "early", Status: common.TopUpStatusSuccess, RenewalSourceId: 1, RenewalDueTime: 120, CompleteTime: 90},
		{TradeNo: "ontime", Status: common.TopUpStatusSuccess, RenewalSourceId: 2, RenewalDueTime: 150, CompleteTime: 190},
		{TradeNo: "duplicate", Status: common.TopUpStatusSuccess, RenewalSourceId: 2, RenewalDueTime: 150, CompleteTime: 195},
		{TradeNo: "late", Status: common.TopUpStatusSuccess, RenewalSourceId: 4, RenewalDueTime: 160, CompleteTime: 210},
	}).Error)
	health, err := getBusinessSubscriptionHealth(db, 100, 200, 200)
	require.NoError(t, err)
	assert.EqualValues(t, 3, health.Active)
	assert.EqualValues(t, 2, health.Expiring)
	assert.EqualValues(t, 4, health.Due)
	assert.EqualValues(t, 2, health.Renewed)
	require.NotNil(t, health.RenewalRate)
	assert.Equal(t, 50.0, *health.RenewalRate)
	assert.False(t, health.PartialHistory)
	empty, err := getBusinessSubscriptionHealth(db, 1, 40, 200)
	require.NoError(t, err)
	assert.Nil(t, empty.RenewalRate)
	assert.True(t, empty.PartialHistory)
}

func TestBusinessDashboardShowsOfferedPlansWithZeroOrders(t *testing.T) {
	db := setupBusinessDatabase(t)
	require.NoError(t, db.Create(&[]SubscriptionPlan{
		{Id: 1, Title: "Plus", Enabled: true},
		{Id: 2, Title: "Ultra", Enabled: true},
		{Id: 3, Title: "Retired", Enabled: true},
	}).Error)
	require.NoError(t, db.Model(&SubscriptionPlan{}).Where("id = ?", 3).Update("enabled", false).Error)
	data, err := GetBusinessDashboard(context.Background(), 1, 1, time.Now())
	require.NoError(t, err)
	assert.Equal(t, []BusinessPlan{{PlanId: 1, Title: "Plus"}, {PlanId: 2, Title: "Ultra"}}, data.Plans)
	assert.Zero(t, data.SubscriptionActivations)
}

func TestBusinessDashboardRenewalRatesBelongToEachPlan(t *testing.T) {
	db := setupBusinessDatabase(t)
	now := time.Date(2026, 9, 17, 4, 0, 0, 0, time.UTC)
	start := time.Date(2026, 9, 17, 0, 0, 0, 0, time.FixedZone("UTC+8", 28800)).Unix()
	require.NoError(t, db.Create(&Option{Key: BusinessRenewalTrackingKey, Value: "1"}).Error)
	require.NoError(t, db.Create(&[]SubscriptionPlan{
		{Id: 41, Title: "Starter"}, {Id: 99, Title: "Team"}, {Id: 105, Title: "No expiries"},
	}).Error)
	require.NoError(t, db.Create(&[]UserSubscription{
		{Id: 1, PlanId: 41, Source: "order", EndTime: start + 86400},
		{Id: 2, PlanId: 41, Source: "balance", EndTime: start + 100},
		{Id: 3, PlanId: 99, Source: "order", EndTime: start + 86400},
		{Id: 4, PlanId: 99, Source: "admin", EndTime: start + 100},
	}).Error)
	require.NoError(t, db.Create(&[]SubscriptionOrder{
		{TradeNo: "starter-early", PlanId: 41, Status: common.TopUpStatusSuccess, RenewalSubscriptionId: 1, RenewalSourceId: 1, RenewalDueTime: start + 100, CompleteTime: start - 1},
		{TradeNo: "starter-duplicate", PlanId: 41, Status: common.TopUpStatusSuccess, RenewalSubscriptionId: 1, RenewalSourceId: 1, RenewalDueTime: start + 100, CompleteTime: start + 1},
		{TradeNo: "team-late", PlanId: 99, Status: common.TopUpStatusSuccess, RenewalSubscriptionId: 3, RenewalSourceId: 3, RenewalDueTime: start + 100, CompleteTime: now.Unix() + 1},
	}).Error)
	data, err := GetBusinessDashboard(context.Background(), 1, 0, now)
	require.NoError(t, err)
	require.Len(t, data.Plans, 3)
	assert.EqualValues(t, 2, data.Plans[0].RenewalDue)
	assert.EqualValues(t, 1, data.Plans[0].Renewed)
	require.NotNil(t, data.Plans[0].RenewalRate)
	assert.Equal(t, 50.0, *data.Plans[0].RenewalRate)
	assert.EqualValues(t, 1, data.Plans[1].RenewalDue)
	assert.Zero(t, data.Plans[1].Renewed)
	require.NotNil(t, data.Plans[1].RenewalRate)
	assert.Zero(t, *data.Plans[1].RenewalRate)
	assert.Zero(t, data.Plans[2].RenewalDue)
	assert.Nil(t, data.Plans[2].RenewalRate)
	assert.EqualValues(t, 3, data.SubscriptionHealth.Due)
	assert.EqualValues(t, 1, data.SubscriptionHealth.Renewed)
}

func TestBusinessDashboardDailyRevenueMatchesTotalWithoutInternalTransfers(t *testing.T) {
	db := setupBusinessDatabase(t)
	now := time.Date(2026, 9, 17, 4, 0, 0, 0, time.UTC)
	start := time.Date(2026, 9, 15, 0, 0, 0, 0, time.FixedZone("UTC+8", 28800)).Unix()
	require.NoError(t, db.Create(&[]SubscriptionOrder{
		{TradeNo: "subscription", UserId: 1, Money: 30.25, PaymentProvider: "epay", Status: common.TopUpStatusSuccess, CompleteTime: start + 86399},
		{TradeNo: "renewal", UserId: 1, Money: 40.5, RenewalSubscriptionId: 1, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, CompleteTime: start + 86400},
		{TradeNo: "internal", UserId: 1, Money: 500, PaymentProvider: "balance", Status: common.TopUpStatusSuccess, CompleteTime: start + 1},
		{TradeNo: "unknown-currency", UserId: 1, Money: 700, PaymentProvider: "stripe", Status: common.TopUpStatusSuccess, CompleteTime: start + 1},
		{TradeNo: "unpaid", UserId: 1, Money: 800, PaymentProvider: "epay", Status: common.TopUpStatusPending, CompleteTime: start + 1},
		{TradeNo: "outside", UserId: 1, Money: 900, PaymentProvider: "epay", Status: common.TopUpStatusSuccess, CompleteTime: now.Unix() + 1},
	}).Error)
	require.NoError(t, db.Create(&[]TopUp{
		{TradeNo: "wallet", UserId: 1, Money: 12.5, PaymentProvider: "epay", Status: common.TopUpStatusSuccess, CreateTime: start - 100, CompleteTime: start},
		{TradeNo: "subscription", UserId: 1, Money: 30.25, PaymentProvider: "epay", Status: common.TopUpStatusSuccess, CompleteTime: start + 86399},
		{TradeNo: "wallet-stripe", UserId: 1, Money: 500, PaymentProvider: "stripe", Status: common.TopUpStatusSuccess, CompleteTime: start + 1},
	}).Error)
	data, err := GetBusinessDashboard(context.Background(), 3, 0, now)
	require.NoError(t, err)
	require.Len(t, data.Daily, 3)
	assert.Equal(t, 12.5, data.Daily[0].WalletRevenue)
	assert.Equal(t, 30.25, data.Daily[0].SubscriptionRevenue)
	assert.Zero(t, data.Daily[1].WalletRevenue)
	assert.Equal(t, 40.5, data.Daily[1].SubscriptionRevenue)
	assert.Zero(t, data.Daily[2].WalletRevenue)
	assert.Zero(t, data.Daily[2].SubscriptionRevenue)
	assert.Equal(t, 83.25, data.Sales.Revenue)
	assert.Equal(t, 70.75, data.Sales.SubscriptionRevenue)
	assert.EqualValues(t, 1, data.Sales.RevenuePayingUsers)
	assert.Zero(t, data.PreviousSales.SubscriptionRevenue)
	assert.Zero(t, data.PreviousSales.RevenuePayingUsers)
	var sum float64
	for _, day := range data.Daily {
		sum += day.WalletRevenue + day.SubscriptionRevenue
	}
	assert.InDelta(t, data.Sales.Revenue, sum, 0.000001)
	yesterday, err := GetBusinessDashboard(context.Background(), 1, 1, now)
	require.NoError(t, err)
	assert.Zero(t, yesterday.Daily[0].WalletRevenue)
	assert.Equal(t, 40.5, yesterday.Daily[0].SubscriptionRevenue)
	assert.Equal(t, 40.5, yesterday.Sales.SubscriptionRevenue)
	assert.EqualValues(t, 1, yesterday.Sales.RevenuePayingUsers)
	empty, err := getBusinessSales(db, now.Unix()+2, now.Unix()+100)
	require.NoError(t, err)
	assert.Zero(t, empty.SubscriptionRevenue)
	assert.Zero(t, empty.RevenuePayingUsers)
}

func TestBusinessDashboardSubscriptionsFollowEnabledCatalogAndStableIDs(t *testing.T) {
	db := setupBusinessDatabase(t)
	now := time.Date(2026, 9, 17, 4, 0, 0, 0, time.UTC)
	start := time.Date(2026, 9, 15, 0, 0, 0, 0, time.FixedZone("UTC+8", 28800)).Unix()
	require.NoError(t, db.Create(&[]SubscriptionPlan{
		{Id: 41, Title: "Starter"}, {Id: 99, Title: "Team"}, {Id: 105, Title: "Enterprise"},
	}).Error)
	require.NoError(t, db.Model(&SubscriptionPlan{}).Where("id = ?", 105).Update("enabled", false).Error)
	require.NoError(t, db.Create(&[]SubscriptionOrder{
		{TradeNo: "new-starter", PlanId: 41, Status: common.TopUpStatusSuccess, CompleteTime: start},
		{TradeNo: "new-team", PlanId: 99, PaymentProvider: "balance", Status: common.TopUpStatusSuccess, CompleteTime: start},
		{TradeNo: "renew-starter", PlanId: 41, RenewalSubscriptionId: 1, Status: common.TopUpStatusSuccess, CompleteTime: start},
		{TradeNo: "renew-team", PlanId: 99, RenewalSubscriptionId: 2, Status: common.TopUpStatusSuccess, CompleteTime: start + 86399},
		{TradeNo: "disabled-plan", PlanId: 105, Status: common.TopUpStatusSuccess, CompleteTime: start},
		{TradeNo: "unknown-plan", PlanId: 999, Status: common.TopUpStatusSuccess, CompleteTime: start},
		{TradeNo: "pending-team", PlanId: 99, Status: common.TopUpStatusPending, CompleteTime: start},
	}).Error)
	data, err := GetBusinessDashboard(context.Background(), 3, 0, now)
	require.NoError(t, err)
	assert.Equal(t, []BusinessPlan{{PlanId: 41, Title: "Starter", Activations: 1, Renewals: 1}, {PlanId: 99, Title: "Team", Activations: 1, Renewals: 1}}, data.Plans)
	assert.Equal(t, BusinessDay{Date: "2026-09-15", Subscriptions: 4, Renewals: 2, Plans: []BusinessPlanDay{{PlanId: 41, Activations: 1, Renewals: 1}, {PlanId: 99, Activations: 1, Renewals: 1}}}, data.Daily[0])
	assert.Equal(t, []BusinessPlanDay{{PlanId: 41}, {PlanId: 99}}, data.Daily[1].Plans)
	require.NoError(t, db.Model(&SubscriptionPlan{}).Where("id = ?", 41).Update("title", "Renamed Starter").Error)
	require.NoError(t, db.Model(&SubscriptionPlan{}).Where("id = ?", 99).Update("enabled", false).Error)
	require.NoError(t, db.Model(&SubscriptionPlan{}).Where("id = ?", 105).Update("enabled", true).Error)
	updated, err := GetBusinessDashboard(context.Background(), 3, 0, now)
	require.NoError(t, err)
	assert.Equal(t, []BusinessPlan{{PlanId: 41, Title: "Renamed Starter", Activations: 1, Renewals: 1}, {PlanId: 105, Title: "Enterprise", Activations: 1}}, updated.Plans)
	assert.Equal(t, []BusinessPlanDay{{PlanId: 41, Activations: 1, Renewals: 1}, {PlanId: 105, Activations: 1}}, updated.Daily[0].Plans)
	require.NoError(t, db.Model(&SubscriptionPlan{}).Where("id > ?", 0).Update("enabled", false).Error)
	empty, err := GetBusinessDashboard(context.Background(), 3, 0, now)
	require.NoError(t, err)
	assert.Empty(t, empty.Plans)
	assert.NotNil(t, empty.Plans)
	assert.Empty(t, empty.Daily[0].Plans)
	assert.NotNil(t, empty.Daily[0].Plans)
}
