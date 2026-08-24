package model

import (
	"fmt"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func quotaWindowConfigJSON(t *testing.T, configs []SubscriptionQuotaWindowConfig) string {
	t.Helper()
	raw, err := common.Marshal(configs)
	require.NoError(t, err)
	normalized, err := NormalizeAndSerializeSubscriptionQuotaWindows(string(raw))
	require.NoError(t, err)
	return normalized
}

func getSubscriptionQuotaWindows(t *testing.T, subscriptionId int) []UserSubscriptionQuotaWindow {
	t.Helper()
	var windows []UserSubscriptionQuotaWindow
	require.NoError(t, DB.Where("user_subscription_id = ?", subscriptionId).Order("id asc").Find(&windows).Error)
	return windows
}

func TestNormalizeSubscriptionQuotaWindowsSupportsFlexiblePeriods(t *testing.T) {
	raw := quotaWindowConfigJSON(t, []SubscriptionQuotaWindowConfig{
		{Name: "5 hours", PeriodUnit: SubscriptionQuotaPeriodHour, PeriodValue: 5, AmountTotal: 100},
		{Name: "Monthly", PeriodUnit: SubscriptionQuotaPeriodMonth, PeriodValue: 1, AmountTotal: 1000},
	})

	configs, err := parseSubscriptionQuotaWindowConfigs(raw)
	require.NoError(t, err)
	require.Len(t, configs, 2)
	assert.Equal(t, "window_1", configs[0].Key)
	assert.Equal(t, SubscriptionQuotaPeriodHour, configs[0].PeriodUnit)
	assert.Equal(t, "window_2", configs[1].Key)
	assert.Equal(t, SubscriptionQuotaPeriodMonth, configs[1].PeriodUnit)
}

func TestNormalizeSubscriptionQuotaWindowsRejectsInvalidConfigs(t *testing.T) {
	tests := []struct {
		name    string
		configs []SubscriptionQuotaWindowConfig
	}{
		{
			name: "too many windows",
			configs: []SubscriptionQuotaWindowConfig{
				{Name: "1", PeriodUnit: SubscriptionQuotaPeriodHour, PeriodValue: 1, AmountTotal: 1},
				{Name: "2", PeriodUnit: SubscriptionQuotaPeriodDay, PeriodValue: 1, AmountTotal: 1},
				{Name: "3", PeriodUnit: SubscriptionQuotaPeriodMonth, PeriodValue: 1, AmountTotal: 1},
			},
		},
		{
			name: "duplicate keys",
			configs: []SubscriptionQuotaWindowConfig{
				{Key: "same", Name: "1", PeriodUnit: SubscriptionQuotaPeriodHour, PeriodValue: 1, AmountTotal: 1},
				{Key: "same", Name: "2", PeriodUnit: SubscriptionQuotaPeriodWeek, PeriodValue: 1, AmountTotal: 1},
			},
		},
		{
			name: "zero quota",
			configs: []SubscriptionQuotaWindowConfig{
				{Name: "zero", PeriodUnit: SubscriptionQuotaPeriodHour, PeriodValue: 1, AmountTotal: 0},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			raw, err := common.Marshal(tt.configs)
			require.NoError(t, err)
			_, err = NormalizeAndSerializeSubscriptionQuotaWindows(string(raw))
			require.Error(t, err)
		})
	}
}

func TestSubscriptionQuotaMonthWindowAnchorsToOpeningDay(t *testing.T) {
	start := time.Date(2026, time.January, 31, 10, 30, 0, 0, time.Local)
	now := time.Date(2026, time.March, 15, 12, 0, 0, 0, time.Local)

	windowStart, nextReset, err := calcSubscriptionQuotaWindow(
		start.Unix(), now.Unix(), 0, SubscriptionQuotaPeriodMonth, 1,
	)

	require.NoError(t, err)
	assert.Equal(t, time.Date(2026, time.February, 28, 10, 30, 0, 0, time.Local).Unix(), windowStart)
	assert.Equal(t, time.Date(2026, time.March, 31, 10, 30, 0, 0, time.Local).Unix(), nextReset)
}

func TestNewSubscriptionSnapshotsQuotaWindowsWithoutBackfillingLegacyRows(t *testing.T) {
	truncateTables(t)

	plan := &SubscriptionPlan{
		Title:         "Flexible",
		DurationUnit:  SubscriptionDurationMonth,
		DurationValue: 1,
		TotalAmount:   10_000,
		QuotaWindows: quotaWindowConfigJSON(t, []SubscriptionQuotaWindowConfig{
			{Key: "five_hour", Name: "5 hours", PeriodUnit: SubscriptionQuotaPeriodHour, PeriodValue: 5, AmountTotal: 1000},
			{Key: "monthly", Name: "Monthly", PeriodUnit: SubscriptionQuotaPeriodMonth, PeriodValue: 1, AmountTotal: 5000},
		}),
	}
	require.NoError(t, DB.Create(plan).Error)

	legacy := &UserSubscription{UserId: 701, PlanId: plan.Id, AmountTotal: plan.TotalAmount, StartTime: GetDBTimestamp(), EndTime: GetDBTimestamp() + 86400, Status: "active"}
	require.NoError(t, DB.Create(legacy).Error)
	assert.Empty(t, getSubscriptionQuotaWindows(t, legacy.Id))

	sub, err := CreateUserSubscriptionFromPlanTx(DB, 702, plan, "test")
	require.NoError(t, err)
	windows := getSubscriptionQuotaWindows(t, sub.Id)
	require.Len(t, windows, 2)
	assert.Equal(t, "five_hour", windows[0].WindowKey)
	assert.Equal(t, sub.StartTime, windows[0].WindowStart)
	assert.Equal(t, sub.StartTime+5*3600, windows[0].NextResetTime)
	assert.Equal(t, "monthly", windows[1].WindowKey)
}

func TestPlanWindowUpdatesOnlyAffectNewSubscriptions(t *testing.T) {
	truncateTables(t)

	plan := &SubscriptionPlan{
		Title:         "Snapshot",
		DurationUnit:  SubscriptionDurationMonth,
		DurationValue: 1,
		TotalAmount:   10_000,
		QuotaWindows: quotaWindowConfigJSON(t, []SubscriptionQuotaWindowConfig{
			{Key: "rolling", Name: "Weekly", PeriodUnit: SubscriptionQuotaPeriodWeek, PeriodValue: 1, AmountTotal: 1000},
		}),
	}
	require.NoError(t, DB.Create(plan).Error)
	first, err := CreateUserSubscriptionFromPlanTx(DB, 711, plan, "test")
	require.NoError(t, err)

	plan.QuotaWindows = quotaWindowConfigJSON(t, []SubscriptionQuotaWindowConfig{
		{Key: "rolling", Name: "Monthly", PeriodUnit: SubscriptionQuotaPeriodMonth, PeriodValue: 1, AmountTotal: 5000},
	})
	require.NoError(t, DB.Model(plan).Update("quota_windows", plan.QuotaWindows).Error)
	second, err := CreateUserSubscriptionFromPlanTx(DB, 712, plan, "test")
	require.NoError(t, err)

	firstWindow := getSubscriptionQuotaWindows(t, first.Id)[0]
	assert.Equal(t, "Weekly", firstWindow.Name)
	assert.Equal(t, SubscriptionQuotaPeriodWeek, firstWindow.PeriodUnit)
	assert.EqualValues(t, 1000, firstWindow.AmountTotal)

	secondWindow := getSubscriptionQuotaWindows(t, second.Id)[0]
	assert.Equal(t, "Monthly", secondWindow.Name)
	assert.Equal(t, SubscriptionQuotaPeriodMonth, secondWindow.PeriodUnit)
	assert.EqualValues(t, 5000, secondWindow.AmountTotal)
}

func TestPreConsumeUpdatesEveryWindowAtomicallyAndEnforcesSmallestLimit(t *testing.T) {
	truncateTables(t)

	plan := &SubscriptionPlan{
		Title:         "Dual",
		DurationUnit:  SubscriptionDurationMonth,
		DurationValue: 1,
		TotalAmount:   10_000,
		QuotaWindows: quotaWindowConfigJSON(t, []SubscriptionQuotaWindowConfig{
			{Key: "five_hour", Name: "5 hours", PeriodUnit: SubscriptionQuotaPeriodHour, PeriodValue: 5, AmountTotal: 100},
			{Key: "seven_day", Name: "7 days", PeriodUnit: SubscriptionQuotaPeriodDay, PeriodValue: 7, AmountTotal: 500},
		}),
	}
	require.NoError(t, DB.Create(plan).Error)
	sub, err := CreateUserSubscriptionFromPlanTx(DB, 801, plan, "test")
	require.NoError(t, err)

	result, err := PreConsumeUserSubscription("dual-window-1", 801, "test", 0, 80)
	require.NoError(t, err)
	assert.EqualValues(t, 80, result.AmountUsedAfter)
	for _, window := range getSubscriptionQuotaWindows(t, sub.Id) {
		assert.EqualValues(t, 80, window.AmountUsed)
	}

	_, err = PreConsumeUserSubscription("dual-window-2", 801, "test", 0, 30)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "subscription quota insufficient")

	var stored UserSubscription
	require.NoError(t, DB.First(&stored, sub.Id).Error)
	assert.EqualValues(t, 80, stored.AmountUsed)
	for _, window := range getSubscriptionQuotaWindows(t, sub.Id) {
		assert.EqualValues(t, 80, window.AmountUsed)
	}
}

func TestSubscriptionQuotaWindowCanBeResetIndependently(t *testing.T) {
	truncateTables(t)

	plan := &SubscriptionPlan{
		Title:         "Resettable",
		DurationUnit:  SubscriptionDurationMonth,
		DurationValue: 1,
		TotalAmount:   10_000,
		QuotaWindows: quotaWindowConfigJSON(t, []SubscriptionQuotaWindowConfig{
			{Key: "five_hour", Name: "5 hours", PeriodUnit: SubscriptionQuotaPeriodHour, PeriodValue: 5, AmountTotal: 1000},
			{Key: "monthly", Name: "Monthly", PeriodUnit: SubscriptionQuotaPeriodMonth, PeriodValue: 1, AmountTotal: 5000},
		}),
	}
	require.NoError(t, DB.Create(plan).Error)
	sub, err := CreateUserSubscriptionFromPlanTx(DB, 901, plan, "test")
	require.NoError(t, err)
	_, err = PreConsumeUserSubscription("reset-window-1", 901, "test", 0, 200)
	require.NoError(t, err)

	result, err := AdminResetUserSubscriptionsByPlanWindow(901, plan.Id, true, "monthly")
	require.NoError(t, err)
	assert.Equal(t, "monthly", result.ResetWindow)
	assert.False(t, result.AdvanceResetTime)

	var stored UserSubscription
	require.NoError(t, DB.First(&stored, sub.Id).Error)
	assert.EqualValues(t, 200, stored.AmountUsed)
	windows := getSubscriptionQuotaWindows(t, sub.Id)
	require.Len(t, windows, 2)
	assert.EqualValues(t, 200, windows[0].AmountUsed)
	assert.Zero(t, windows[1].AmountUsed)
}

func TestPlanWindowResetSkipsLegacySubscriptionsWithoutBackfill(t *testing.T) {
	truncateTables(t)

	plan := &SubscriptionPlan{
		Title:         "Mixed generations",
		DurationUnit:  SubscriptionDurationMonth,
		DurationValue: 1,
		TotalAmount:   10_000,
		QuotaWindows: quotaWindowConfigJSON(t, []SubscriptionQuotaWindowConfig{
			{Key: "weekly", Name: "Weekly", PeriodUnit: SubscriptionQuotaPeriodWeek, PeriodValue: 1, AmountTotal: 1000},
		}),
	}
	require.NoError(t, DB.Create(plan).Error)
	now := GetDBTimestamp()
	legacy := &UserSubscription{
		UserId: 921, PlanId: plan.Id, AmountTotal: plan.TotalAmount,
		StartTime: now, EndTime: now + 86400, Status: "active",
	}
	require.NoError(t, DB.Create(legacy).Error)
	current, err := CreateUserSubscriptionFromPlanTx(DB, 922, plan, "test")
	require.NoError(t, err)
	require.NoError(t, DB.Model(&UserSubscriptionQuotaWindow{}).
		Where("user_subscription_id = ?", current.Id).
		Update("amount_used", 300).Error)

	result, err := AdminResetPlanSubscriptionsWindow(plan.Id, true, "weekly")
	require.NoError(t, err)
	assert.Equal(t, 2, result.MatchedCount)
	assert.Equal(t, 1, result.ResetCount)
	assert.False(t, result.AdvanceResetTime)
	assert.Empty(t, getSubscriptionQuotaWindows(t, legacy.Id))
	assert.Zero(t, getSubscriptionQuotaWindows(t, current.Id)[0].AmountUsed)
}

func TestResetDueSubscriptionsResetsAdditionalWindow(t *testing.T) {
	truncateTables(t)

	plan := &SubscriptionPlan{
		Title:         "Scheduled reset",
		DurationUnit:  SubscriptionDurationMonth,
		DurationValue: 1,
		TotalAmount:   10_000,
		QuotaWindows: quotaWindowConfigJSON(t, []SubscriptionQuotaWindowConfig{
			{Key: "five_hour", Name: "5 hours", PeriodUnit: SubscriptionQuotaPeriodHour, PeriodValue: 5, AmountTotal: 1000},
		}),
	}
	require.NoError(t, DB.Create(plan).Error)
	sub, err := CreateUserSubscriptionFromPlanTx(DB, 951, plan, "test")
	require.NoError(t, err)
	require.NoError(t, DB.Model(&UserSubscriptionQuotaWindow{}).
		Where("user_subscription_id = ?", sub.Id).
		Updates(map[string]interface{}{
			"amount_used":     400,
			"next_reset_time": GetDBTimestamp() - 1,
		}).Error)

	resetCount, err := ResetDueSubscriptions(10)
	require.NoError(t, err)
	assert.Equal(t, 1, resetCount)

	window := getSubscriptionQuotaWindows(t, sub.Id)[0]
	assert.Zero(t, window.AmountUsed)
	assert.Greater(t, window.NextResetTime, GetDBTimestamp())
}

func TestSubscriptionQuotaWindowSettlementAndRefundAdjustAllCounters(t *testing.T) {
	truncateTables(t)

	plan := &SubscriptionPlan{
		Title:         "Settlement",
		DurationUnit:  SubscriptionDurationMonth,
		DurationValue: 1,
		TotalAmount:   10_000,
		QuotaWindows: quotaWindowConfigJSON(t, []SubscriptionQuotaWindowConfig{
			{Key: "weekly", Name: "Weekly", PeriodUnit: SubscriptionQuotaPeriodWeek, PeriodValue: 1, AmountTotal: 1000},
		}),
	}
	require.NoError(t, DB.Create(plan).Error)
	sub, err := CreateUserSubscriptionFromPlanTx(DB, 1001, plan, "test")
	require.NoError(t, err)
	requestID := fmt.Sprintf("settlement-%d", time.Now().UnixNano())
	_, err = PreConsumeUserSubscription(requestID, 1001, "test", 0, 300)
	require.NoError(t, err)
	require.NoError(t, PostConsumeUserSubscriptionDelta(sub.Id, -100))

	var stored UserSubscription
	require.NoError(t, DB.First(&stored, sub.Id).Error)
	assert.EqualValues(t, 200, stored.AmountUsed)
	assert.EqualValues(t, 200, getSubscriptionQuotaWindows(t, sub.Id)[0].AmountUsed)

	require.NoError(t, RefundSubscriptionPreConsume(requestID))
	require.NoError(t, DB.First(&stored, sub.Id).Error)
	assert.Zero(t, stored.AmountUsed)
	assert.Zero(t, getSubscriptionQuotaWindows(t, sub.Id)[0].AmountUsed)
}
