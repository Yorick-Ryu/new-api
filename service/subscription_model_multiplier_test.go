package service

import (
	"net/http/httptest"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func subscriptionMultiplierFixture(t *testing.T, raw string, windowQuota int64) (*gin.Context, *relaycommon.RelayInfo, *model.SubscriptionPlan, *model.UserSubscription) {
	t.Helper()
	truncate(t)
	t.Setenv("LOG_SQL_DSN", "")
	require.NoError(t, model.InitLogDB())
	plan := &model.SubscriptionPlan{
		Title: "Plus", DurationUnit: model.SubscriptionDurationMonth, DurationValue: 1,
		TotalAmount: 1000, ModelMultipliers: raw,
	}
	windows, err := common.Marshal([]model.SubscriptionQuotaWindowConfig{
		{Key: "five_hour", Name: "5 hours", PeriodUnit: "hour", PeriodValue: 5, AmountTotal: windowQuota},
	})
	require.NoError(t, err)
	plan.QuotaWindows = string(windows)
	require.NoError(t, model.DB.Create(plan).Error)
	model.InvalidateSubscriptionPlanCache(plan.Id)
	t.Cleanup(func() {
		model.InvalidateSubscriptionPlanCache(plan.Id)
		model.DB.Exec("DELETE FROM subscription_pre_consume_records")
		model.DB.Delete(plan)
	})
	seedUser(t, 1, 1000)
	seedToken(t, 1, 1, "test-subscription-multiplier", 1000)
	sub, err := model.CreateUserSubscriptionFromPlanTx(model.DB, 1, plan, "test")
	require.NoError(t, err)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := &relaycommon.RelayInfo{
		UserId: 1, TokenId: 1, TokenKey: "test-subscription-multiplier", ForcePreConsume: true,
		OriginModelName: "gpt-6-astra", RequestId: t.Name(),
	}
	info.UserSetting.BillingPreference = "subscription_only"
	return ctx, info, plan, sub
}

func assertSubscriptionConsumption(t *testing.T, subID int, expected int64) {
	t.Helper()
	var sub model.UserSubscription
	require.NoError(t, model.DB.First(&sub, subID).Error)
	assert.Equal(t, expected, sub.AmountUsed)
	var windows []model.UserSubscriptionQuotaWindow
	require.NoError(t, model.DB.Where("user_subscription_id = ?", subID).Find(&windows).Error)
	require.Len(t, windows, 1)
	assert.Equal(t, expected, windows[0].AmountUsed)
}

func TestSubscriptionMultiplierSnapshotsAndSettlesAllWindows(t *testing.T) {
	ctx, info, plan, sub := subscriptionMultiplierFixture(t, `{"gpt-6-astra":2}`, 500)
	session, apiErr := NewBillingSession(ctx, info, 100)
	require.Nil(t, apiErr)
	assertSubscriptionConsumption(t, sub.Id, 200)
	require.NoError(t, session.Reserve(150))
	assertSubscriptionConsumption(t, sub.Id, 300)
	assert.EqualValues(t, 300, info.SubscriptionPreConsumed)

	require.NoError(t, model.DB.Model(plan).Update("model_multipliers", `{"gpt-6-astra":3}`).Error)
	model.InvalidateSubscriptionPlanCache(plan.Id)
	require.NoError(t, session.Settle(125))
	require.NoError(t, session.Settle(125))
	session.Refund(ctx) // A completed request must not refund its reservation.
	assert.False(t, session.NeedsRefund())
	assertSubscriptionConsumption(t, sub.Id, 250)
	assert.Equal(t, 1000, getUserQuota(t, 1))
	var token model.Token
	require.NoError(t, model.DB.First(&token, 1).Error)
	assert.Equal(t, 875, token.RemainQuota)
	other := map[string]interface{}{}
	appendBillingInfo(info, other)
	assert.Equal(t, 2.0, other["subscription_model_multiplier"])
	assert.EqualValues(t, 250, other["subscription_consumed"])
	assert.EqualValues(t, -50, other["subscription_post_delta"])

	info2 := *info
	info2.RequestId += "-next"
	next, apiErr := NewBillingSession(ctx, &info2, 10)
	require.Nil(t, apiErr)
	assert.Equal(t, 3.0, info2.SubscriptionModelMultiplier)
	require.NoError(t, next.Settle(10))
	assertSubscriptionConsumption(t, sub.Id, 280)
}

func TestSubscriptionMultiplierWalletFallbackUsesNormalPrice(t *testing.T) {
	for _, allowOverflow := range []bool{true, false} {
		t.Run(map[bool]string{true: "allowed", false: "blocked"}[allowOverflow], func(t *testing.T) {
			ctx, info, plan, sub := subscriptionMultiplierFixture(t, `{"gpt-6-astra":2}`, 150)
			require.NoError(t, model.DB.Model(sub).Update("allow_wallet_overflow", allowOverflow).Error)
			model.InvalidateSubscriptionPlanCache(plan.Id)
			info.UserSetting.BillingPreference = "subscription_first"
			session, apiErr := NewBillingSession(ctx, info, 100)
			if !allowOverflow {
				require.NotNil(t, apiErr)
				assert.Equal(t, 1000, getUserQuota(t, 1))
			} else {
				require.Nil(t, apiErr)
				assert.Equal(t, BillingSourceWallet, info.BillingSource)
				assert.Zero(t, info.SubscriptionModelMultiplier)
				require.NoError(t, session.Settle(80))
				assert.Equal(t, 920, getUserQuota(t, 1))
			}
			assertSubscriptionConsumption(t, sub.Id, 0)
			var token model.Token
			require.NoError(t, model.DB.First(&token, 1).Error)
			if allowOverflow {
				assert.Equal(t, 920, token.RemainQuota)
			} else {
				assert.Equal(t, 1000, token.RemainQuota)
			}
		})
	}
}

func TestSubscriptionMultiplierReserveRollbackAndIdempotentRefund(t *testing.T) {
	ctx, info, _, sub := subscriptionMultiplierFixture(t, `{"gpt-6-astra":2}`, 900)
	require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", 1).Update("remain_quota", 150).Error)
	session, apiErr := NewBillingSession(ctx, info, 100)
	require.Nil(t, apiErr)
	require.Error(t, session.Reserve(200)) // Funding succeeds, token reservation fails.
	assertSubscriptionConsumption(t, sub.Id, 200)
	require.NoError(t, session.Reserve(125))
	assertSubscriptionConsumption(t, sub.Id, 250)
	require.NoError(t, session.funding.Refund())
	require.NoError(t, session.funding.Refund())
	assertSubscriptionConsumption(t, sub.Id, 0)
}

func TestSubscriptionMultiplierRoundsTotalsAndRefundsZeroUsage(t *testing.T) {
	for _, actual := range []int{0, 3} {
		t.Run(map[int]string{0: "zero", 3: "fractional"}[actual], func(t *testing.T) {
			ctx, info, _, sub := subscriptionMultiplierFixture(t, `{"gpt-6-astra":1.5}`, 500)
			session, apiErr := NewBillingSession(ctx, info, 1)
			require.Nil(t, apiErr)
			assertSubscriptionConsumption(t, sub.Id, 2)
			require.NoError(t, session.Reserve(2))
			assertSubscriptionConsumption(t, sub.Id, 3)
			require.NoError(t, session.Settle(actual))
			expected := int64(5)
			if actual == 0 {
				expected = 0
			}
			assertSubscriptionConsumption(t, sub.Id, expected)
		})
	}
}

func TestSubscriptionMultiplierUnlistedModelUsesNormalPrice(t *testing.T) {
	ctx, info, _, sub := subscriptionMultiplierFixture(t, `{"gpt-6-astra":2}`, 500)
	info.OriginModelName = "gpt-5.6-sol"
	session, apiErr := NewBillingSession(ctx, info, 100)
	require.Nil(t, apiErr)
	require.NoError(t, session.Settle(80))
	assertSubscriptionConsumption(t, sub.Id, 80)
	assert.Equal(t, 1.0, info.SubscriptionModelMultiplier)
}

func TestSubscriptionMultiplierAsyncTaskAdjustsRoundedTotals(t *testing.T) {
	ctx, info, _, sub := subscriptionMultiplierFixture(t, `{"gpt-6-astra":1.5}`, 500)
	session, apiErr := NewBillingSession(ctx, info, 1)
	require.Nil(t, apiErr)
	require.NoError(t, session.Settle(1))
	task := &model.Task{Quota: 1, PrivateData: model.TaskPrivateData{
		BillingSource: BillingSourceSubscription, SubscriptionId: sub.Id, SubscriptionModelMultiplier: 1.5,
	}}
	require.NoError(t, taskAdjustFunding(task, 1))
	assertSubscriptionConsumption(t, sub.Id, 3)
	task.Quota = 2
	require.NoError(t, taskAdjustFunding(task, -2))
	assertSubscriptionConsumption(t, sub.Id, 0)
}

func TestSubscriptionMultiplierLegacySettlementUsesRoundedTotal(t *testing.T) {
	ctx, info, _, sub := subscriptionMultiplierFixture(t, `{"gpt-6-astra":1.5}`, 500)
	_, apiErr := NewBillingSession(ctx, info, 1)
	require.Nil(t, apiErr)
	require.NoError(t, PostConsumeQuota(info, 1, 1, false))
	assertSubscriptionConsumption(t, sub.Id, 3)
	require.NoError(t, PostConsumeQuota(info, -2, 2, false))
	assertSubscriptionConsumption(t, sub.Id, 0)
}

func TestSubscriptionMultiplierSessionRefundRestoresTokenAndAllWindows(t *testing.T) {
	ctx, info, _, sub := subscriptionMultiplierFixture(t, `{"gpt-6-astra":2}`, 900)
	session, apiErr := NewBillingSession(ctx, info, 100)
	require.Nil(t, apiErr)
	require.NoError(t, session.Reserve(150))
	finished := make(chan struct{}, 1)
	const callback = "test:subscription_multiplier_refund_complete"
	require.NoError(t, model.DB.Callback().Update().After("gorm:commit_or_rollback_transaction").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Table == "tokens" && tx.Error == nil {
			finished <- struct{}{}
		}
	}))
	t.Cleanup(func() { model.DB.Callback().Update().Remove(callback) })
	session.Refund(ctx)
	session.Refund(ctx)
	select {
	case <-finished:
	case <-time.After(5 * time.Second):
		t.Fatal("refund did not complete")
	}
	assertSubscriptionConsumption(t, sub.Id, 0)
	var token model.Token
	require.NoError(t, model.DB.First(&token, 1).Error)
	assert.Equal(t, 1000, token.RemainQuota)
	assert.False(t, session.NeedsRefund())
}
