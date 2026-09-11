package model

import (
	"math"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSubscriptionModelMultiplierValidation(t *testing.T) {
	for _, raw := range []string{"", "{}", `{"gpt-6-astra":2,"gpt-5.6":0.5}`} {
		_, err := NormalizeSubscriptionModelMultipliers(raw)
		require.NoError(t, err)
	}
	for _, raw := range []string{"null", "[]", "invalid", `{"":2}`, `{"gpt-*":2}`, `{" gpt-6-astra":2}`, `{"gpt-6-astra":0}`, `{"gpt-6-astra":-2}`, `{"gpt-6-astra":1001}`, `{"gpt-6-astra":"2"}`, `{"gpt-6-astra":1e999}`} {
		_, err := NormalizeSubscriptionModelMultipliers(raw)
		assert.Error(t, err, raw)
	}
}

func TestSubscriptionQuotaMultiplierRejectsOverflowAndInvalidInputs(t *testing.T) {
	for _, test := range []struct {
		amount     int64
		multiplier float64
	}{
		{-1, 2}, {common.MaxQuota, 2}, {math.MaxInt64, 1},
		{1, math.NaN()}, {1, math.Inf(1)}, {1, 0}, {1, -1}, {1, 1001},
	} {
		_, err := SubscriptionQuotaWithMultiplier(test.amount, test.multiplier)
		assert.Error(t, err)
	}
	for _, test := range []struct {
		amount     int64
		multiplier float64
		expected   int64
	}{
		{100, 2, 200}, {1, 1.5, 2}, {2, 1.5, 3}, {0, 2, 0}, {1, 0.001, 1},
	} {
		amount, err := SubscriptionQuotaWithMultiplier(test.amount, test.multiplier)
		require.NoError(t, err)
		assert.Equal(t, test.expected, amount)
	}
}

func TestSubscriptionSelectionChecksEachPlansMultipliedQuota(t *testing.T) {
	truncateTables(t)
	first := &SubscriptionPlan{Title: "Plus", DurationUnit: SubscriptionDurationMonth, DurationValue: 1, TotalAmount: 150, ModelMultipliers: `{"gpt-6-astra":2}`}
	second := &SubscriptionPlan{Title: "Ultra", DurationUnit: SubscriptionDurationMonth, DurationValue: 2, TotalAmount: 500, ModelMultipliers: `{"gpt-6-astra":1.5}`}
	require.NoError(t, DB.Create(first).Error)
	require.NoError(t, DB.Create(second).Error)
	InvalidateSubscriptionPlanCache(first.Id)
	InvalidateSubscriptionPlanCache(second.Id)
	t.Cleanup(func() {
		InvalidateSubscriptionPlanCache(first.Id)
		InvalidateSubscriptionPlanCache(second.Id)
	})
	sub1, err := CreateUserSubscriptionFromPlanTx(DB, 701, first, "test")
	require.NoError(t, err)
	sub2, err := CreateUserSubscriptionFromPlanTx(DB, 701, second, "test")
	require.NoError(t, err)
	result, err := PreConsumeUserSubscription(t.Name(), 701, "gpt-6-astra", 0, 100)
	require.NoError(t, err)
	assert.Equal(t, sub2.Id, result.UserSubscriptionId)
	assert.EqualValues(t, 150, result.PreConsumed)
	assert.Equal(t, 1.5, result.ModelMultiplier)
	require.NoError(t, DB.First(sub1, sub1.Id).Error)
	assert.Zero(t, sub1.AmountUsed)

	require.NoError(t, DB.Model(second).Update("model_multipliers", `{"gpt-6-astra":3}`).Error)
	InvalidateSubscriptionPlanCache(second.Id)
	replayed, err := PreConsumeUserSubscription(t.Name(), 701, "gpt-6-astra", 0, 100)
	require.NoError(t, err)
	assert.Equal(t, 1.5, replayed.ModelMultiplier)
	assert.EqualValues(t, 150, replayed.PreConsumed)
	require.NoError(t, RefundSubscriptionPreConsume(t.Name()))
	require.NoError(t, RefundSubscriptionPreConsume(t.Name()))
	require.NoError(t, DB.First(sub2, sub2.Id).Error)
	assert.Zero(t, sub2.AmountUsed)
}
