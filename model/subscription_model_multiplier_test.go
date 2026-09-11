package model

import (
	"math"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
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

func TestSubscriptionSelectionChecksEachPlansGroupOverride(t *testing.T) {
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
	result, err := PreConsumeUserSubscription(t.Name(), 701, "gpt-6-astra", 0, 300, func(ratio float64) (int64, error) { return int64(100 * ratio), nil })
	require.NoError(t, err)
	assert.Equal(t, sub2.Id, result.UserSubscriptionId)
	assert.EqualValues(t, 150, result.PreConsumed)
	assert.Equal(t, 1.5, result.GroupRatio)
	require.NoError(t, DB.First(sub1, sub1.Id).Error)
	assert.Zero(t, sub1.AmountUsed)

	require.NoError(t, DB.Model(second).Update("model_multipliers", `{"gpt-6-astra":3}`).Error)
	InvalidateSubscriptionPlanCache(second.Id)
	replayed, err := PreConsumeUserSubscription(t.Name(), 701, "gpt-6-astra", 0, 300, func(ratio float64) (int64, error) { return int64(100 * ratio), nil })
	require.NoError(t, err)
	assert.Equal(t, 1.5, replayed.GroupRatio)
	assert.EqualValues(t, 150, replayed.PreConsumed)
	require.NoError(t, RefundSubscriptionPreConsume(t.Name()))
	require.NoError(t, RefundSubscriptionPreConsume(t.Name()))
	require.NoError(t, DB.First(sub2, sub2.Id).Error)
	assert.Zero(t, sub2.AmountUsed)
}

func TestSubscriptionModelMultiplierSQLiteStartupMigration(t *testing.T) {
	for _, existing := range []bool{false, true} {
		t.Run(map[bool]string{false: "new_database", true: "existing_database"}[existing], func(t *testing.T) {
			db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
			require.NoError(t, err)
			original := DB
			DB = db
			t.Cleanup(func() { DB = original; sqlDB, _ := db.DB(); sqlDB.Close() })
			if existing {
				require.NoError(t, db.Exec("CREATE TABLE subscription_plans (id integer PRIMARY KEY, title varchar(128) NOT NULL, price_amount decimal(10,6) NOT NULL)").Error)
				require.NoError(t, db.Exec("INSERT INTO subscription_plans (id,title,price_amount) VALUES (1, 'Plus', 99)").Error)
			}
			require.NoError(t, ensureSubscriptionPlanTableSQLite())
			require.NoError(t, ensureSubscriptionPlanTableSQLite())
			if !existing {
				require.NoError(t, db.Create(&SubscriptionPlan{Id: 1, Title: "Plus", PriceAmount: 99}).Error)
			}
			require.NoError(t, db.Model(&SubscriptionPlan{}).Where("id = ?", 1).Update("model_multipliers", `{"gpt-6-astra":2}`).Error)
			var plan SubscriptionPlan
			require.NoError(t, db.First(&plan, 1).Error)
			assert.Equal(t, "Plus", plan.Title)
			assert.Equal(t, float64(99), plan.PriceAmount)
			assert.JSONEq(t, `{"gpt-6-astra":2}`, plan.ModelMultipliers)
		})
	}
}
