package service

import (
	"fmt"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/relaykit/dto"
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
	info.PriceData.GroupRatioInfo.GroupRatio = 1
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
	require.NoError(t, session.Reserve(300))
	assertSubscriptionConsumption(t, sub.Id, 300)
	assert.EqualValues(t, 300, info.SubscriptionPreConsumed)

	require.NoError(t, model.DB.Model(plan).Update("model_multipliers", `{"gpt-6-astra":3}`).Error)
	model.InvalidateSubscriptionPlanCache(plan.Id)
	require.NoError(t, session.Settle(250))
	require.NoError(t, session.Settle(250))
	session.Refund(ctx) // A completed request must not refund its reservation.
	assert.False(t, session.NeedsRefund())
	assertSubscriptionConsumption(t, sub.Id, 250)
	assert.Equal(t, 1000, getUserQuota(t, 1))
	var token model.Token
	require.NoError(t, model.DB.First(&token, 1).Error)
	assert.Equal(t, 750, token.RemainQuota)
	other := map[string]interface{}{}
	appendBillingInfo(info, other)
	assert.Equal(t, 2.0, other["subscription_group_ratio"])
	assert.EqualValues(t, 250, other["subscription_consumed"])
	assert.EqualValues(t, -50, other["subscription_post_delta"])

	info2 := *info
	info2.RequestId += "-next"
	info2.PriceData.GroupRatioInfo.GroupRatio = 1
	next, apiErr := NewBillingSession(ctx, &info2, 10)
	require.Nil(t, apiErr)
	assert.Equal(t, 3.0, info2.SubscriptionGroupRatio)
	require.NoError(t, next.Settle(30))
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
	require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", 1).Update("remain_quota", 275).Error)
	session, apiErr := NewBillingSession(ctx, info, 100)
	require.Nil(t, apiErr)
	require.Error(t, session.Reserve(400)) // Funding succeeds, token reservation fails.
	assertSubscriptionConsumption(t, sub.Id, 200)
	require.NoError(t, session.Reserve(250))
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
			assertSubscriptionConsumption(t, sub.Id, 1)
			require.NoError(t, session.Reserve(3))
			assertSubscriptionConsumption(t, sub.Id, 3)
			require.NoError(t, session.Settle(actual))
			expected := int64(3)
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

func TestLegacySubscriptionMultiplierAsyncTaskAdjustsRoundedTotals(t *testing.T) {
	_, _, _, sub := subscriptionMultiplierFixture(t, `{}`, 500)
	require.NoError(t, model.PostConsumeUserSubscriptionDelta(sub.Id, 2))
	task := &model.Task{Quota: 1, PrivateData: model.TaskPrivateData{
		BillingSource: BillingSourceSubscription, SubscriptionId: sub.Id, SubscriptionModelMultiplier: 1.5,
	}}
	require.NoError(t, taskAdjustFunding(task, 1))
	assertSubscriptionConsumption(t, sub.Id, 3)
	task.Quota = 2
	require.NoError(t, taskAdjustFunding(task, -2))
	assertSubscriptionConsumption(t, sub.Id, 0)
}

func TestLegacySubscriptionMultiplierSettlementUsesRoundedTotal(t *testing.T) {
	_, info, _, sub := subscriptionMultiplierFixture(t, `{}`, 500)
	info.BillingSource = BillingSourceSubscription
	info.SubscriptionId = sub.Id
	info.SubscriptionModelMultiplier = 1.5
	require.NoError(t, model.PostConsumeUserSubscriptionDelta(sub.Id, 2))
	require.NoError(t, PostConsumeQuota(info, 1, 1, false))
	assertSubscriptionConsumption(t, sub.Id, 3)
	require.NoError(t, PostConsumeQuota(info, -2, 2, false))
	assertSubscriptionConsumption(t, sub.Id, 0)
}

func TestSubscriptionMultiplierSessionRefundRestoresTokenAndAllWindows(t *testing.T) {
	ctx, info, _, sub := subscriptionMultiplierFixture(t, `{"gpt-6-astra":2}`, 900)
	session, apiErr := NewBillingSession(ctx, info, 100)
	require.Nil(t, apiErr)
	require.NoError(t, session.Reserve(300))
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

func TestSubscriptionGroupRatioOverridesInsteadOfMultiplying(t *testing.T) {
	for _, tc := range []struct {
		name            string
		group, override float64
		want            int
	}{
		{"one_to_two", 1, 2, 200}, {"two_to_one", 2, 1, 100}, {"three_to_half", 3, 0.5, 50},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw, err := common.Marshal(map[string]float64{"gpt-6-astra": tc.override})
			require.NoError(t, err)
			ctx, info, _, sub := subscriptionMultiplierFixture(t, string(raw), 900)
			info.PriceData.ModelRatio = 1
			info.PriceData.GroupRatioInfo.GroupRatio = tc.group
			session, apiErr := NewBillingSession(ctx, info, int(100*tc.group))
			require.Nil(t, apiErr)
			assert.Equal(t, tc.override, info.PriceData.GroupRatioInfo.GroupRatio)
			assert.Equal(t, 1.0, info.PriceData.ModelRatio)
			summary := calculateTextQuotaSummary(ctx, info, &dto.Usage{PromptTokens: 100})
			assert.Equal(t, tc.want, summary.Quota)
			require.NoError(t, session.Settle(summary.Quota))
			assertSubscriptionConsumption(t, sub.Id, int64(tc.want))
			other := map[string]interface{}{}
			appendBillingInfo(info, other)
			assert.Equal(t, tc.group, other["subscription_original_group_ratio"])
			assert.Equal(t, tc.override, other["subscription_group_ratio"])
			privateData, err := common.Marshal(model.TaskPrivateData{
				BillingSource: BillingSourceSubscription, SubscriptionId: sub.Id,
				SubscriptionGroupRatio:         info.SubscriptionGroupRatio,
				SubscriptionOriginalGroupRatio: info.SubscriptionOriginalGroupRatio,
			})
			require.NoError(t, err)
			var task model.Task
			require.NoError(t, common.Unmarshal(privateData, &task.PrivateData))
			taskOther := taskBillingOther(&task)
			assert.Equal(t, tc.group, taskOther["subscription_original_group_ratio"])
			assert.Equal(t, tc.override, taskOther["subscription_group_ratio"])
		})
	}
}

func TestSubscriptionGroupOverrideKeepsWalletAndOtherModelsAtOriginalGroup(t *testing.T) {
	for _, pref := range []string{"wallet_only", "wallet_first", "subscription_first"} {
		t.Run(pref, func(t *testing.T) {
			ctx, info, _, sub := subscriptionMultiplierFixture(t, `{"gpt-6-astra":2}`, 150)
			require.NoError(t, model.DB.Model(sub).Update("allow_wallet_overflow", true).Error)
			info.UserSetting.BillingPreference = pref
			info.PriceData.GroupRatioInfo.GroupRatio = 3
			session, apiErr := NewBillingSession(ctx, info, 300)
			require.Nil(t, apiErr)
			assert.Equal(t, BillingSourceWallet, info.BillingSource)
			assert.Zero(t, info.SubscriptionGroupRatio)
			assert.Equal(t, 3.0, info.PriceData.GroupRatioInfo.GroupRatio)
			require.NoError(t, session.Settle(240))
			assert.Equal(t, 760, getUserQuota(t, 1))
			assertSubscriptionConsumption(t, sub.Id, 0)
		})
	}
	t.Run("unlisted_model", func(t *testing.T) {
		ctx, info, _, sub := subscriptionMultiplierFixture(t, `{"gpt-6-astra":2}`, 900)
		info.OriginModelName = "gpt-5.6-sol"
		info.PriceData.GroupRatioInfo.GroupRatio = 3
		session, apiErr := NewBillingSession(ctx, info, 300)
		require.Nil(t, apiErr)
		assert.Equal(t, 3.0, info.PriceData.GroupRatioInfo.GroupRatio)
		assert.Zero(t, info.SubscriptionGroupRatio)
		require.NoError(t, session.Settle(240))
		assertSubscriptionConsumption(t, sub.Id, 240)
	})
}

func TestSubscriptionGroupOverrideReservesTokenAtEffectivePrice(t *testing.T) {
	for _, tokenQuota := range []int{100, 40} {
		t.Run(fmt.Sprint(tokenQuota), func(t *testing.T) {
			ctx, info, _, sub := subscriptionMultiplierFixture(t, `{"gpt-6-astra":0.5}`, 100)
			info.PriceData.GroupRatioInfo.GroupRatio = 3
			require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", 1).Update("remain_quota", tokenQuota).Error)
			_, apiErr := NewBillingSession(ctx, info, 300)
			var token model.Token
			require.NoError(t, model.DB.First(&token, 1).Error)
			if tokenQuota == 100 {
				require.Nil(t, apiErr)
				assertSubscriptionConsumption(t, sub.Id, 50)
				assert.Equal(t, 50, token.RemainQuota)
			} else {
				require.NotNil(t, apiErr)
				assertSubscriptionConsumption(t, sub.Id, 0)
				assert.Equal(t, 40, token.RemainQuota)
				assert.Equal(t, 3.0, info.PriceData.GroupRatioInfo.GroupRatio)
			}
		})
	}
}

func TestSubscriptionGroupOverrideTieredPriceKeepsSnapshotAcrossGroupRetry(t *testing.T) {
	ctx, info, _, sub := subscriptionMultiplierFixture(t, `{"gpt-6-astra":0.5}`, 900)
	info.PriceData.GroupRatioInfo.GroupRatio = 3
	info.TieredBillingSnapshot = makeRelayInfo(flatExpr, 3, 100, 0).TieredBillingSnapshot
	session, apiErr := NewBillingSession(ctx, info, 300)
	require.Nil(t, apiErr)
	info.Billing = session
	assertSubscriptionConsumption(t, sub.Id, 50)
	info.PriceData.GroupRatioInfo.GroupRatio = 4 // A retry changes the routing group.
	require.Nil(t, PrepareTieredBillingForSelectedGroup(ctx, info))
	assert.Equal(t, 0.5, info.TieredBillingSnapshot.GroupRatio)
	ok, quota, _ := TryTieredSettle(info, billingexpr.TokenParams{P: 100, C: 10})
	require.True(t, ok)
	assert.Equal(t, 75, quota) // (100 * $2 + 10 * $10) / 1M * 500K * 0.5
	require.NoError(t, session.Settle(quota))
	assertSubscriptionConsumption(t, sub.Id, 75)
}

func TestSubscriptionGroupOverrideUsesUnroundedEstimateAndSupportsFreeGroups(t *testing.T) {
	for _, group := range []float64{0, 3} {
		t.Run(fmt.Sprint(group), func(t *testing.T) {
			ctx, info, _, sub := subscriptionMultiplierFixture(t, `{"gpt-6-astra":2}`, 900)
			base := 1.75
			info.PriceData.QuotaBeforeGroup = &base
			info.PriceData.GroupRatioInfo.GroupRatio = group
			session, apiErr := NewBillingSession(ctx, info, int(base*group))
			require.Nil(t, apiErr)
			assert.Equal(t, 3, session.GetPreConsumedQuota())
			assertSubscriptionConsumption(t, sub.Id, 3)
		})
	}
}

func TestSubscriptionGroupOverridePerCallKeepsModelPriceAndOtherRatios(t *testing.T) {
	ctx, info, _, sub := subscriptionMultiplierFixture(t, `{"gpt-6-astra":0.5}`, 900)
	base := 100.0
	info.PriceData.QuotaBeforeGroup = &base
	info.PriceData.UsePrice = true
	info.PriceData.ModelPrice = 0.0002
	info.PriceData.GroupRatioInfo.GroupRatio = 3
	info.PriceData.AddOtherRatio("duration", 2)
	session, apiErr := NewBillingSession(ctx, info, 600)
	require.Nil(t, apiErr)
	assert.Equal(t, 0.0002, info.PriceData.ModelPrice)
	assert.Equal(t, 2.0, info.PriceData.OtherRatioMultiplier())
	assert.Equal(t, 100, info.PriceData.Quota)
	require.NoError(t, session.Settle(info.PriceData.Quota))
	assertSubscriptionConsumption(t, sub.Id, 100)
	// New async tasks already store the effective quota and must not multiply it again.
	task := &model.Task{Quota: 100, PrivateData: model.TaskPrivateData{
		BillingSource: BillingSourceSubscription, SubscriptionId: sub.Id,
		SubscriptionModelMultiplier: 1, SubscriptionGroupRatio: 0.5,
	}}
	require.NoError(t, taskAdjustFunding(task, -100))
	assertSubscriptionConsumption(t, sub.Id, 0)
}
