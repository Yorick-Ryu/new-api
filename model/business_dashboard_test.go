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

func TestBusinessDashboardAccountingAndCalendarBoundaries(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "business.db")), &gorm.Config{})
	require.NoError(t, err)
	previous := DB
	DB = db
	t.Cleanup(func() { DB = previous; sqlDB, _ := db.DB(); _ = sqlDB.Close() })
	require.NoError(t, db.AutoMigrate(&User{}, &TopUp{}, &SubscriptionOrder{}, &SubscriptionPlan{}, &UserSubscription{}, &Option{}))
	now := time.Date(2026, 9, 17, 4, 0, 0, 0, time.UTC)
	start := time.Date(2026, 9, 11, 0, 0, 0, 0, time.FixedZone("UTC+8", 28800)).Unix()
	users := []User{
		{Id: 1, Username: "new-paid", AffCode: "a", CreatedAt: start},
		{Id: 2, Username: "new-unpaid", AffCode: "b", CreatedAt: start + 86400},
		{Id: 3, Username: "old-paid", AffCode: "c", CreatedAt: start - 1},
		{Id: 4, Username: "new-deleted", AffCode: "d", CreatedAt: start + 5},
		{Id: 5, Username: "future", AffCode: "e", CreatedAt: now.Unix() + 1},
	}
	require.NoError(t, db.Create(&users).Error)
	require.NoError(t, db.Delete(&users[3]).Error)
	require.NoError(t, db.Create(&SubscriptionPlan{Id: 1, Title: "Monthly"}).Error)
	orders := []SubscriptionOrder{
		{Id: 1, UserId: 2, PlanId: 1, TradeNo: "subscription-mirror", Money: 100, Status: common.TopUpStatusSuccess, CompleteTime: start + 1},
		{Id: 2, UserId: 2, PlanId: 1, TradeNo: "balance", Money: 100, PaymentProvider: PaymentProviderBalance, Status: common.TopUpStatusSuccess, CompleteTime: start + 2},
		{Id: 3, UserId: 3, PlanId: 1, TradeNo: "renewal", RenewalSubscriptionId: 1, Money: 100, Status: common.TopUpStatusSuccess, CompleteTime: start + 3},
		{Id: 4, UserId: 2, PlanId: 1, TradeNo: "pending-subscription", Money: 100, Status: common.TopUpStatusPending, CompleteTime: start + 4},
	}
	require.NoError(t, db.Create(&orders).Error)
	topups := []TopUp{
		{UserId: 1, TradeNo: "paid-1", Money: 10.25, Status: common.TopUpStatusSuccess, PaymentProvider: PaymentProviderEpay, CompleteTime: start, CreateTime: start - 100},
		{UserId: 1, TradeNo: "paid-2", Money: 2.75, Status: common.TopUpStatusSuccess, PaymentMethod: "alipay", CompleteTime: start + 86399},
		{UserId: 3, TradeNo: "old-user", Money: 20, Status: common.TopUpStatusSuccess, PaymentProvider: PaymentProviderEpay, CompleteTime: start + 86400},
		{UserId: 4, TradeNo: "deleted-paid", Money: 7, Status: common.TopUpStatusSuccess, PaymentProvider: PaymentProviderStripe, CompleteTime: now.Unix()},
		{UserId: 2, TradeNo: "subscription-mirror", Money: 100, Status: common.TopUpStatusSuccess, CompleteTime: start + 1},
		{UserId: 2, TradeNo: "pending", Money: 100, Status: common.TopUpStatusPending, CompleteTime: start + 1},
		{UserId: 2, TradeNo: "zero", Money: 0, Status: common.TopUpStatusSuccess, CompleteTime: start + 1},
		{UserId: 2, TradeNo: "before", Money: 100, Status: common.TopUpStatusSuccess, CompleteTime: start - 1},
		{UserId: 2, TradeNo: "after", Money: 100, Status: common.TopUpStatusSuccess, CompleteTime: now.Unix() + 1},
		{UserId: 2, TradeNo: "balance-topup", Money: 100, PaymentProvider: PaymentProviderBalance, Status: common.TopUpStatusSuccess, CompleteTime: start + 1},
	}
	require.NoError(t, db.Create(&topups).Error)
	grant := UserSubscription{UserId: 2, PlanId: 1, Source: "admin"}
	require.NoError(t, db.Create(&grant).Error)
	require.NoError(t, db.Model(&grant).UpdateColumn("created_at", start+1).Error)
	result, err := GetBusinessDashboard(context.Background(), 7, 0, now)
	require.NoError(t, err)
	assert.EqualValues(t, 3, result.NewUsers)
	assert.EqualValues(t, 4, result.TopUpOrders)
	assert.EqualValues(t, 3, result.TopUpUsers)
	assert.EqualValues(t, 2, result.NewUserTopUpUsers)
	assert.InDelta(t, 66.666666, result.NewUserTopUpRate, 0.00001)
	assert.Equal(t, []BusinessMoney{{Provider: "epay", Amount: 33}, {Provider: "stripe", Amount: 7}}, result.TopUpAmounts)
	assert.Equal(t, []BusinessMoney{{Provider: "epay", Amount: 13}, {Provider: "stripe", Amount: 7}}, result.NewUserTopUpAmounts)
	assert.EqualValues(t, 2, result.SubscriptionActivations)
	assert.EqualValues(t, 1, result.SubscriptionRenewals)
	assert.EqualValues(t, 1, result.AdminGrants)
	require.Len(t, result.Daily, 7)
	assert.Equal(t, BusinessDay{Date: "2026-09-11", NewUsers: 2, TopUpOrders: 2, Subscriptions: 2, Renewals: 1, WalletRevenue: 13, Plans: []BusinessPlanDay{{PlanId: 1, Activations: 2, Renewals: 1}}}, result.Daily[0])
	assert.EqualValues(t, 1, result.Daily[1].TopUpOrders)
	assert.EqualValues(t, 1, result.Daily[6].TopUpOrders)
	require.Len(t, result.RecentUsers, 3)
	assert.Equal(t, "new-unpaid", result.RecentUsers[0].Username)
	assert.EqualValues(t, 0, result.RecentUsers[0].TopUpOrders)
	assert.EqualValues(t, 2, result.RecentUsers[2].TopUpOrders)
	require.Len(t, result.RecentTopUps, 4)
	assert.Equal(t, "new-deleted", result.RecentTopUps[0].Username)
	assert.Equal(t, []BusinessPlan{{PlanId: 1, Title: "Monthly", Activations: 2, Renewals: 1}}, result.Plans)
	empty, err := GetBusinessDashboard(context.Background(), 7, 0, now.AddDate(1, 0, 0))
	require.NoError(t, err)
	assert.Zero(t, empty.NewUserTopUpRate)
	assert.Empty(t, empty.RecentUsers)
	assert.NotNil(t, empty.TopUpAmounts)
	assert.Len(t, empty.Daily, 7)
	_, err = GetBusinessDashboard(context.Background(), 365, 0, now)
	assert.Error(t, err)
}

func TestBusinessDashboardPlanPreviousOrdersUseComparableWindow(t *testing.T) {
	now := time.Date(2026, 9, 17, 12, 0, 0, 0, time.FixedZone("UTC+8", 28800))
	for _, tc := range []struct {
		name                       string
		days, offset               int
		previousStart, previousEnd time.Time
	}{
		{"three days", 3, 0, time.Date(2026, 9, 12, 0, 0, 0, 0, now.Location()), time.Date(2026, 9, 14, 12, 0, 1, 0, now.Location())},
		{"yesterday", 1, 1, time.Date(2026, 9, 15, 0, 0, 0, 0, now.Location()), time.Date(2026, 9, 16, 0, 0, 0, 0, now.Location())},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := setupBusinessDatabase(t)
			require.NoError(t, db.Create(&[]SubscriptionPlan{
				{Id: 41, Title: "Renamed plan"}, {Id: 99, Title: "Renamed plan"}, {Id: 105, Title: "No orders"},
			}).Error)
			start, end := tc.previousStart.Unix(), tc.previousEnd.Unix()
			require.NoError(t, db.Create(&[]SubscriptionOrder{
				{PlanId: 41, TradeNo: "before", Status: common.TopUpStatusSuccess, CompleteTime: start - 1},
				{PlanId: 41, TradeNo: "new", Status: common.TopUpStatusSuccess, CompleteTime: start},
				{PlanId: 41, TradeNo: "balance-renewal", RenewalSubscriptionId: 1, PaymentProvider: PaymentProviderBalance, Status: common.TopUpStatusSuccess, CompleteTime: end - 1},
				{PlanId: 41, TradeNo: "after", Status: common.TopUpStatusSuccess, CompleteTime: end},
				{PlanId: 41, TradeNo: "pending", Status: common.TopUpStatusPending, CompleteTime: start + 1},
				{PlanId: 99, TradeNo: "previous-only", Status: common.TopUpStatusSuccess, CompleteTime: start},
			}).Error)
			data, err := GetBusinessDashboard(context.Background(), tc.days, tc.offset, now)
			require.NoError(t, err)
			require.Len(t, data.Plans, 3)
			assert.Equal(t, 41, data.Plans[0].PlanId)
			assert.EqualValues(t, 2, data.Plans[0].PreviousOrders)
			assert.Equal(t, 99, data.Plans[1].PlanId)
			assert.EqualValues(t, 1, data.Plans[1].PreviousOrders)
			assert.Zero(t, data.Plans[1].Activations)
			assert.Zero(t, data.Plans[1].Renewals)
			assert.Equal(t, 105, data.Plans[2].PlanId)
			assert.Zero(t, data.Plans[2].PreviousOrders)
		})
	}
}
