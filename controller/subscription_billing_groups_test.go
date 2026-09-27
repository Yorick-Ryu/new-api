package controller

import (
	"fmt"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSubscriptionBillingGroupsDatabase(t *testing.T) {
	dialect := os.Getenv("TEST_SUBSCRIPTION_DIALECT")
	if dialect == "" {
		dialect = "sqlite"
	}
	db, _ := newAuditTestDatabase(t, dialect, os.Getenv("TEST_"+strings.ToUpper(dialect)+"_DSN"))
	oldDB, oldLog := model.DB, model.LOG_DB
	oldMain, oldLogType := common.MainDatabaseType(), common.LogDatabaseType()
	oldRedis, oldBatch := common.RedisEnabled, common.BatchUpdateEnabled
	oldPayment := *operation_setting.GetPaymentSetting()
	model.DB, model.LOG_DB = db, db
	common.SetDatabaseTypes(common.DatabaseType(dialect), common.DatabaseType(dialect))
	common.RedisEnabled, common.BatchUpdateEnabled = false, false
	operation_setting.GetPaymentSetting().ComplianceConfirmed = true
	operation_setting.GetPaymentSetting().ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLog
		common.SetDatabaseTypes(oldMain, oldLogType)
		common.RedisEnabled, common.BatchUpdateEnabled = oldRedis, oldBatch
		*operation_setting.GetPaymentSetting() = oldPayment
	})
	var version string
	query := "SELECT version()"
	if dialect == "sqlite" {
		query = "SELECT sqlite_version()"
	}
	require.NoError(t, db.Raw(query).Scan(&version).Error)
	t.Logf("database: %s %s", dialect, version)
	tables := []any{&model.User{}, &model.Token{}, &model.SubscriptionPlan{}, &model.UserSubscription{}, &model.UserSubscriptionQuotaWindow{}, &model.SubscriptionPreConsumeRecord{}}
	// Fresh startup, then a populated released schema without the new column.
	require.NoError(t, db.AutoMigrate(tables...))
	require.NoError(t, db.AutoMigrate(tables...))
	legacy := model.SubscriptionPlan{Title: "Legacy", DurationUnit: "month", DurationValue: 1, PriceAmount: 12, TotalAmount: 1000}
	require.NoError(t, db.Create(&legacy).Error)
	require.NoError(t, db.Migrator().DropColumn(&model.SubscriptionPlan{}, "billing_groups"))
	require.NoError(t, db.AutoMigrate(tables...))
	require.NoError(t, db.AutoMigrate(tables...))
	require.NoError(t, db.First(&legacy, legacy.Id).Error)
	assert.Equal(t, "Legacy", legacy.Title)
	assert.Equal(t, 12.0, legacy.PriceAmount)
	assert.Nil(t, legacy.BillingGroups)
	allowed, err := legacy.AllowsBillingGroup("any-group")
	require.NoError(t, err)
	assert.True(t, allowed)

	t.Run("admin_save_validate_preserve_and_clear", func(t *testing.T) {
		update := func(raw *string) bool {
			plan := legacy
			plan.BillingGroups = raw
			body, err := common.Marshal(gin.H{"plan": plan})
			require.NoError(t, err)
			w := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(w)
			ctx.Params = gin.Params{{Key: "id", Value: fmt.Sprint(legacy.Id)}}
			ctx.Request = httptest.NewRequest("PUT", "/api/subscription/admin/plans/1", strings.NewReader(string(body)))
			ctx.Request.Header.Set("Content-Type", "application/json")
			AdminUpdateSubscriptionPlan(ctx)
			var result struct {
				Success bool `json:"success"`
			}
			require.NoError(t, common.Unmarshal(w.Body.Bytes(), &result))
			return result.Success
		}
		require.True(t, update(common.GetPointer(`["B","A","A"]`)))
		loaded, err := model.GetSubscriptionPlanById(legacy.Id)
		require.NoError(t, err)
		require.NotNil(t, loaded.BillingGroups)
		assert.JSONEq(t, `["A","B"]`, *loaded.BillingGroups)
		require.True(t, update(nil)) // Old clients must not erase restrictions.
		for _, raw := range []string{`null`, `{}`, `["auto"]`, `[""]`, `["A*"]`, `[1]`, `[" A"]`} {
			assert.False(t, update(&raw), raw)
		}
		loaded, err = model.GetSubscriptionPlanById(legacy.Id)
		require.NoError(t, err)
		assert.JSONEq(t, `["A","B"]`, *loaded.BillingGroups)
		require.True(t, update(common.GetPointer("")))
		loaded, err = model.GetSubscriptionPlanById(legacy.Id)
		require.NoError(t, err)
		allowed, err := loaded.AllowsBillingGroup("C")
		require.NoError(t, err)
		assert.True(t, allowed)
	})

	for i, tc := range []struct {
		name, group, preference, expected string
		wallet, subscriptionQuota         int
		overflow                          bool
		fail                              bool
	}{
		{"included", "A", "subscription_first", "subscription", 1000, 1000, false, false},
		{"excluded", "C", "subscription_first", "wallet", 1000, 1000, false, false},
		{"excluded_subscription_only", "C", "subscription_only", "wallet", 1000, 1000, false, false},
		{"excluded_empty_wallet", "C", "wallet_first", "", 0, 1000, true, true},
		{"included_exhausted_strict", "A", "subscription_first", "", 1000, 1, false, true},
		{"included_exhausted_overflow", "A", "subscription_first", "wallet", 1000, 1, true, false},
		{"wallet_only", "A", "wallet_only", "wallet", 1000, 1000, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			user := model.User{Username: fmt.Sprintf("group%d", i), AffCode: fmt.Sprintf("group%d", i), Quota: tc.wallet}
			require.NoError(t, db.Create(&user).Error)
			plan := model.SubscriptionPlan{Title: tc.name, DurationUnit: "month", DurationValue: 1, TotalAmount: int64(tc.subscriptionQuota), BillingGroups: common.GetPointer(`["A","B"]`), AllowWalletOverflow: &tc.overflow}
			require.NoError(t, db.Create(&plan).Error)
			model.InvalidateSubscriptionPlanCache(plan.Id)
			sub, err := model.CreateUserSubscriptionFromPlanTx(db, user.Id, &plan, "test")
			require.NoError(t, err)
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			info := &relaycommon.RelayInfo{UserId: user.Id, IsPlayground: true, ForcePreConsume: true, UsingGroup: tc.group, OriginModelName: "test", RequestId: fmt.Sprintf("groups-%d", i)}
			info.UserSetting.BillingPreference = tc.preference
			session, apiErr := service.NewBillingSession(ctx, info, 100)
			wantWallet, wantSub := tc.wallet, int64(0)
			if tc.fail {
				require.NotNil(t, apiErr)
			} else {
				require.Nil(t, apiErr)
				assert.Equal(t, tc.expected, info.BillingSource)
				require.NoError(t, session.Settle(80))
				require.NoError(t, session.Settle(80))
				if tc.expected == "wallet" {
					wantWallet -= 80
				} else {
					wantSub = 80
				}
			}
			require.NoError(t, db.First(&user, user.Id).Error)
			require.NoError(t, db.First(sub, sub.Id).Error)
			assert.Equal(t, wantWallet, user.Quota)
			assert.Equal(t, wantSub, sub.AmountUsed)
		})
	}

	t.Run("preferred_plan_cannot_cross_groups_or_block_other_plans_overflow", func(t *testing.T) {
		user := model.User{Username: "multi-plan", AffCode: "multiplan", Quota: 1000}
		require.NoError(t, db.Create(&user).Error)
		plans := []model.SubscriptionPlan{
			{Title: "A", DurationUnit: "month", DurationValue: 1, TotalAmount: 1000, BillingGroups: common.GetPointer(`["A"]`), AllowWalletOverflow: common.GetPointer(false)},
			{Title: "B", DurationUnit: "month", DurationValue: 2, TotalAmount: 100, BillingGroups: common.GetPointer(`["B"]`), AllowWalletOverflow: common.GetPointer(true)},
		}
		subs := make([]*model.UserSubscription, 2)
		for i := range plans {
			require.NoError(t, db.Create(&plans[i]).Error)
			model.InvalidateSubscriptionPlanCache(plans[i].Id)
			var err error
			subs[i], err = model.CreateUserSubscriptionFromPlanTx(db, user.Id, &plans[i], "test")
			require.NoError(t, err)
		}
		ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
		info := &relaycommon.RelayInfo{UserId: user.Id, IsPlayground: true, ForcePreConsume: true, UsingGroup: "B", OriginModelName: "test", RequestId: "multi-plan"}
		info.UserSetting.BillingPreference, info.UserSetting.PreferredSubscriptionId = "subscription_first", subs[0].Id
		session, apiErr := service.NewBillingSession(ctx, info, 100)
		require.Nil(t, apiErr)
		assert.Equal(t, subs[1].Id, info.SubscriptionId)
		require.NoError(t, session.Settle(100))
		_, err := model.PreConsumeUserSubscription(info.RequestId, user.Id, "test", "A", subs[0].Id, 100)
		require.ErrorIs(t, err, model.ErrNoEligibleSubscription)
		info.RequestId += "-overflow"
		session, apiErr = service.NewBillingSession(ctx, info, 100)
		require.Nil(t, apiErr)
		assert.Equal(t, "wallet", info.BillingSource)
		require.NoError(t, session.Settle(100))
		require.NoError(t, db.First(subs[0], subs[0].Id).Error)
		assert.Zero(t, subs[0].AmountUsed)
		// Changing the plan also restricts an already purchased subscription.
		require.NoError(t, db.Model(&plans[1]).Update("billing_groups", `["C"]`).Error)
		model.InvalidateSubscriptionPlanCache(plans[1].Id)
		eligible, err := model.GetSubscriptionBillingEligibility(user.Id, "B")
		require.NoError(t, err)
		assert.False(t, eligible.HasEligible)
	})
	t.Run("cross_group_retry_with_max_length_request_id", func(t *testing.T) {
		user := model.User{Username: "retry", AffCode: "retry", Quota: 1000}
		require.NoError(t, db.Create(&user).Error)
		plan := model.SubscriptionPlan{Title: "Retry", DurationUnit: "month", DurationValue: 1, TotalAmount: 1000, BillingGroups: common.GetPointer(`["A"]`)}
		require.NoError(t, db.Create(&plan).Error)
		model.InvalidateSubscriptionPlanCache(plan.Id)
		sub, err := model.CreateUserSubscriptionFromPlanTx(db, user.Id, &plan, "test")
		require.NoError(t, err)
		ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
		info := &relaycommon.RelayInfo{UserId: user.Id, IsPlayground: true, ForcePreConsume: true, UsingGroup: "A", OriginModelName: "test", RequestId: strings.Repeat("r", 64)}
		base := 100.0
		info.PriceData.QuotaBeforeGroup = &base
		info.PriceData.GroupRatioInfo.GroupRatio = 1
		require.Nil(t, service.PreConsumeBilling(ctx, 100, info))
		info.UsingGroup = "C"
		require.Nil(t, service.PrepareBillingForSelectedGroup(ctx, info))
		assert.Equal(t, service.BillingSourceWallet, info.BillingSource)
		info.UsingGroup = "A"
		require.Nil(t, service.PrepareBillingForSelectedGroup(ctx, info))
		assert.Equal(t, service.BillingSourceSubscription, info.BillingSource)
		require.NoError(t, info.Billing.Settle(80))
		require.NoError(t, db.First(&user, user.Id).Error)
		require.NoError(t, db.First(sub, sub.Id).Error)
		assert.Equal(t, 1000, user.Quota)
		assert.EqualValues(t, 80, sub.AmountUsed)
	})

}
