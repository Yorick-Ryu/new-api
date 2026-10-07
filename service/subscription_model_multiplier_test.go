package service

import (
	"errors"
	"fmt"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
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
	other := model.NewLogOther()
	appendBillingInfo(info, other)
	assert.Equal(t, 2.0, other.Snapshot()["subscription_group_ratio"])
	assert.EqualValues(t, 250, other.Snapshot()["subscription_consumed"])
	assert.EqualValues(t, -50, other.Snapshot()["subscription_post_delta"])

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
			other := model.NewLogOther()
			appendBillingInfo(info, other)
			assert.Equal(t, tc.group, other.Snapshot()["subscription_original_group_ratio"])
			assert.Equal(t, tc.override, other.Snapshot()["subscription_group_ratio"])
			privateData, err := common.Marshal(model.TaskPrivateData{
				BillingSource: BillingSourceSubscription, SubscriptionId: sub.Id,
				SubscriptionGroupRatio:         info.SubscriptionGroupRatio,
				SubscriptionOriginalGroupRatio: info.SubscriptionOriginalGroupRatio,
			})
			require.NoError(t, err)
			var task model.Task
			require.NoError(t, common.Unmarshal(privateData, &task.PrivateData))
			taskOther := taskBillingOther(&task)
			assert.Equal(t, tc.group, taskOther.Snapshot()["subscription_original_group_ratio"])
			assert.Equal(t, tc.override, taskOther.Snapshot()["subscription_group_ratio"])
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

func TestSubscriptionBillingGroupsRebindAcrossRetries(t *testing.T) {
	for _, tiered := range []bool{false, true} {
		t.Run(fmt.Sprint(tiered), func(t *testing.T) {
			ctx, info, plan, sub := subscriptionMultiplierFixture(t, `{"gpt-6-astra":2}`, 900)
			previousGroups := ratio_setting.GroupRatio2JSONString()
			require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"A":1,"C":3}`))
			t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(previousGroups)) })
			require.NoError(t, model.DB.Model(plan).Update("billing_groups", `["A"]`).Error)
			model.InvalidateSubscriptionPlanCache(plan.Id)
			info.UsingGroup = "A"
			info.UserSetting.BillingPreference = "subscription_first"
			base := 100.0
			info.PriceData.QuotaBeforeGroup = &base
			if tiered {
				info.TieredBillingSnapshot = makeRelayInfo(flatExpr, 1, 100, 0).TieredBillingSnapshot
			}
			require.Nil(t, PreConsumeBilling(ctx, 100, info))
			assertSubscriptionConsumption(t, sub.Id, 200)
			original := info.Billing
			info.UsingGroup = "C"
			require.Nil(t, PrepareTieredBillingForSelectedGroup(ctx, info))
			assert.Equal(t, BillingSourceWallet, info.BillingSource)
			assertSubscriptionConsumption(t, sub.Id, 0)
			assert.False(t, original.NeedsRefund())
			assert.Equal(t, 700, getUserQuota(t, 1))
			assert.Equal(t, 3.0, info.PriceData.GroupRatioInfo.GroupRatio)
			assert.Zero(t, info.SubscriptionGroupRatio)
			assert.Zero(t, info.SubscriptionPlanId)
			info.UsingGroup = "A"
			require.Nil(t, PrepareTieredBillingForSelectedGroup(ctx, info))
			assert.Equal(t, BillingSourceSubscription, info.BillingSource)
			assert.Equal(t, 1000, getUserQuota(t, 1))
			assertSubscriptionConsumption(t, sub.Id, 200)
			require.Nil(t, PrepareTieredBillingForSelectedGroup(ctx, info)) // Same group: no second reservation.
			assertSubscriptionConsumption(t, sub.Id, 200)
			require.NoError(t, info.Billing.Settle(150))
			assertSubscriptionConsumption(t, sub.Id, 150)
			var token model.Token
			require.NoError(t, model.DB.First(&token, 1).Error)
			assert.Equal(t, 850, token.RemainQuota)
			require.NoError(t, model.RefundSubscriptionPreConsume(info.RequestId)) // Old attempt is already refunded.
			assertSubscriptionConsumption(t, sub.Id, 150)
		})
	}
}

func TestSubscriptionBillingGroupsRetryCannotSpendExcludedPlanWithEmptyWallet(t *testing.T) {
	ctx, info, plan, sub := subscriptionMultiplierFixture(t, `{}`, 900)
	require.NoError(t, model.DB.Model(plan).Update("billing_groups", `["A"]`).Error)
	model.InvalidateSubscriptionPlanCache(plan.Id)
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", 1).Update("quota", 0).Error)
	info.UsingGroup = "A"
	base := 100.0
	info.PriceData.QuotaBeforeGroup = &base
	require.Nil(t, PreConsumeBilling(ctx, 100, info))
	info.UsingGroup = "C"
	require.NotNil(t, PrepareTieredBillingForSelectedGroup(ctx, info))
	assert.Nil(t, info.Billing)
	assertSubscriptionConsumption(t, sub.Id, 0)
	var token model.Token
	require.NoError(t, model.DB.First(&token, 1).Error)
	assert.Equal(t, 1000, token.RemainQuota)
	assert.Equal(t, 0, getUserQuota(t, 1))
}

func TestSubscriptionBillingGroupsFreeGroupRetryReselectsFunding(t *testing.T) {
	ctx, info, plan, sub := subscriptionMultiplierFixture(t, `{}`, 900)
	previousGroups := ratio_setting.GroupRatio2JSONString()
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"A":1,"free":0}`))
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(previousGroups)) })
	require.NoError(t, model.DB.Model(plan).Update("billing_groups", `["A"]`).Error)
	model.InvalidateSubscriptionPlanCache(plan.Id)
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", 1).Update("quota", 0).Error)
	info.UserSetting.BillingPreference = "subscription_first"
	info.UsingGroup = "free"
	info.PriceData.FreeModel = true
	info.PriceData.GroupRatioInfo.GroupRatio = 0
	base := 100.0
	info.PriceData.QuotaBeforeGroup = &base
	require.Nil(t, PrepareTieredBillingForSelectedGroup(ctx, info))
	for range 2 {
		info.UsingGroup = "A"
		require.Nil(t, PrepareTieredBillingForSelectedGroup(ctx, info))
		assert.Equal(t, BillingSourceSubscription, info.BillingSource)
		assertSubscriptionConsumption(t, sub.Id, 100)
		info.UsingGroup = "free"
		require.Nil(t, PrepareTieredBillingForSelectedGroup(ctx, info))
		assert.Equal(t, BillingSourceWallet, info.BillingSource)
		assertSubscriptionConsumption(t, sub.Id, 0)
	}
	require.NoError(t, info.Billing.Settle(0))
	assert.Equal(t, 0, getUserQuota(t, 1))
}

// Run the same settlement contract against real SQLite, MySQL and PostgreSQL.
func TestSubscriptionCappedSettlementDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			dsn := os.Getenv("TEST_" + strings.ToUpper(dialect) + "_DSN")
			if dialect != "sqlite" && dsn == "" {
				t.Skip("isolated TEST database DSN not configured")
			}
			previousDB, previousLogDB := model.DB, model.LOG_DB
			previousMain, previousLog := common.MainDatabaseType(), common.LogDatabaseType()
			previousPath, previousMaster := common.SQLitePath, common.IsMasterNode
			common.SQLitePath = filepath.Join(t.TempDir(), "capped-settlement.db")
			common.IsMasterNode = true
			t.Setenv("SQL_DSN", dsn)
			t.Setenv("LOG_SQL_DSN", "")
			t.Setenv("SQL_MAX_OPEN_CONNS", "8")
			require.NoError(t, model.InitDB())
			sqlDB, err := model.DB.DB()
			require.NoError(t, err)
			if dialect == "sqlite" {
				sqlDB.SetMaxOpenConns(1)
			}
			require.NoError(t, model.InitLogDB())
			t.Cleanup(func() {
				require.NoError(t, sqlDB.Close())
				model.DB, model.LOG_DB = previousDB, previousLogDB
				common.SQLitePath, common.IsMasterNode = previousPath, previousMaster
				common.SetDatabaseTypes(previousMain, previousLog)
				require.NoError(t, model.InitLogDB())
			})
			versionSQL := "SELECT VERSION()"
			if dialect == "sqlite" {
				versionSQL = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, model.DB.Raw(versionSQL).Scan(&version).Error)
			t.Logf("database: %s", version)
			runSubscriptionCappedSettlementCases(t)
		})
	}
}

func runSubscriptionCappedSettlementCases(t *testing.T) {
	for _, tc := range []struct {
		name, pref, override                  string
		allow                                 bool
		primary, window, charged, uncollected int64
		actual                                int
	}{
		{"primary_cap", "subscription_first", "{}", true, 100, 900, 100, 50, 150},
		{"window_cap_astra", "subscription_first", `{"gpt-6-astra":2}`, true, 1000, 100, 100, 50, 150},
		{"plan_forbids_wallet", "subscription_first", "{}", false, 1000, 100, 100, 50, 150},
		{"subscription_only", "subscription_only", "{}", true, 1000, 100, 100, 50, 150},
		{"equal_reservation", "subscription_first", "{}", true, 1000, 100, 20, 0, 20},
		{"refund_unused", "subscription_first", "{}", true, 1000, 100, 5, 0, 5},
		{"zero_usage", "subscription_first", "{}", true, 1000, 100, 0, 0, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, info, _, sub := subscriptionMultiplierFixture(t, tc.override, tc.window)
			require.NoError(t, model.DB.Model(sub).Updates(map[string]any{"amount_total": tc.primary, "allow_wallet_overflow": tc.allow}).Error)
			info.RequestId = "capped-" + tc.name
			info.UserSetting.BillingPreference = tc.pref
			session, apiErr := NewBillingSession(ctx, info, 20)
			require.Nil(t, apiErr)
			require.Equal(t, BillingSourceSubscription, info.BillingSource)
			require.NoError(t, session.Settle(tc.actual))
			require.NoError(t, session.Settle(tc.actual))
			session.Refund(ctx)
			assert.False(t, session.NeedsRefund())
			assertSubscriptionConsumption(t, sub.Id, tc.charged)
			assert.Equal(t, 1000, getUserQuota(t, 1)) // Current request never falls back to the wallet.
			other := model.NewLogOther()
			appendBillingInfo(info, other)
			assert.EqualValues(t, 0, other.Snapshot()["wallet_quota_deducted"])
			assert.Equal(t, tc.charged, other.Snapshot()["subscription_consumed"])
			if tc.uncollected > 0 {
				assert.Equal(t, tc.uncollected, other.Snapshot()["subscription_uncollected_quota"])
			} else {
				assert.NotContains(t, other.Snapshot(), "subscription_uncollected_quota")
			}
			var token model.Token
			require.NoError(t, model.DB.First(&token, 1).Error)
			assert.Equal(t, 1000-tc.actual, token.RemainQuota)
			if tc.uncollected > 0 {
				// The next request follows existing preference/plan fallback, at wallet price.
				nextInfo := &relaycommon.RelayInfo{UserId: 1, TokenId: 1, TokenKey: info.TokenKey, ForcePreConsume: true, OriginModelName: info.OriginModelName, RequestId: info.RequestId + "-next"}
				nextInfo.UserSetting = info.UserSetting
				nextInfo.PriceData.GroupRatioInfo.GroupRatio = 1
				next, nextErr := NewBillingSession(ctx, nextInfo, 10)
				if tc.allow && tc.pref != "subscription_only" {
					require.Nil(t, nextErr)
					assert.Equal(t, BillingSourceWallet, nextInfo.BillingSource)
					require.NoError(t, next.Settle(10))
					assert.Equal(t, 990, getUserQuota(t, 1))
				} else {
					require.NotNil(t, nextErr)
					assert.Equal(t, 1000, getUserQuota(t, 1))
				}
			}
		})
	}
	t.Run("atomic_rollback_and_retry", func(t *testing.T) {
		ctx, info, _, sub := subscriptionMultiplierFixture(t, "{}", 100)
		info.RequestId = "capped-rollback"
		session, apiErr := NewBillingSession(ctx, info, 20)
		require.Nil(t, apiErr)
		const callback = "test:fail_capped_subscription_update"
		require.NoError(t, model.DB.Callback().Update().Before("gorm:update").Register(callback, func(tx *gorm.DB) {
			if tx.Statement.Table == "user_subscriptions" {
				tx.AddError(errors.New("injected subscription update failure"))
			}
		}))
		err := session.Settle(150)
		require.NoError(t, model.DB.Callback().Update().Remove(callback))
		require.ErrorContains(t, err, "injected subscription update failure")
		assertSubscriptionConsumption(t, sub.Id, 20)
		require.NoError(t, session.Settle(150))
		assertSubscriptionConsumption(t, sub.Id, 100)
	})
	t.Run("smallest_of_multiple_windows", func(t *testing.T) {
		ctx, info, _, sub := subscriptionMultiplierFixture(t, "{}", 100)
		info.RequestId = "capped-windows"
		require.NoError(t, model.DB.Create(&model.UserSubscriptionQuotaWindow{UserSubscriptionId: sub.Id, WindowKey: "week", Name: "Weekly", PeriodUnit: "week", PeriodValue: 1, AmountTotal: 60, WindowStart: sub.StartTime, NextResetTime: sub.StartTime + 7*86400}).Error)
		session, apiErr := NewBillingSession(ctx, info, 20)
		require.Nil(t, apiErr)
		require.NoError(t, session.Settle(150))
		require.NoError(t, model.DB.First(sub, sub.Id).Error)
		assert.EqualValues(t, 60, sub.AmountUsed)
		other := model.NewLogOther()
		appendBillingInfo(info, other)
		assert.EqualValues(t, 90, other.Snapshot()["subscription_uncollected_quota"])
		var windows []model.UserSubscriptionQuotaWindow
		require.NoError(t, model.DB.Where("user_subscription_id = ?", sub.Id).Find(&windows).Error)
		require.Len(t, windows, 2)
		for _, window := range windows {
			assert.EqualValues(t, 60, window.AmountUsed)
		}
	})
	t.Run("concurrent_requests_and_duplicate_settlement", func(t *testing.T) {
		ctx, info, _, sub := subscriptionMultiplierFixture(t, "{}", 100)
		info.RequestId = "capped-concurrent"
		info.IsPlayground = true
		first, apiErr := NewBillingSession(ctx, info, 20)
		require.Nil(t, apiErr)
		secondInfo := *info
		secondInfo.RequestId += "-second"
		second, apiErr := NewBillingSession(ctx, &secondInfo, 20)
		require.Nil(t, apiErr)
		start := make(chan struct{})
		errs := make(chan error, 4)
		var wg sync.WaitGroup
		for _, session := range []*BillingSession{first, first, second, second} {
			wg.Go(func() { <-start; errs <- session.Settle(100) })
		}
		close(start)
		wg.Wait()
		close(errs)
		for err := range errs {
			require.NoError(t, err)
		}
		assertSubscriptionConsumption(t, sub.Id, 100)
		firstLog, secondLog := model.NewLogOther(), model.NewLogOther()
		appendBillingInfo(info, firstLog)
		appendBillingInfo(&secondInfo, secondLog)
		assert.EqualValues(t, 100, firstLog.Snapshot()["subscription_consumed"].(int64)+secondLog.Snapshot()["subscription_consumed"].(int64))
		assert.EqualValues(t, 100, firstLog.Snapshot()["subscription_uncollected_quota"].(int64)+secondLog.Snapshot()["subscription_uncollected_quota"].(int64))
		assert.Equal(t, 1000, getUserQuota(t, 1))
	})
}
