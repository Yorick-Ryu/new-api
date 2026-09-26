package model

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func seedSubscriptionRenewal(t *testing.T) (User, *SubscriptionPlan, *UserSubscription) {
	t.Helper()
	truncateTables(t)
	user := User{Username: "renewal-user", Quota: 10000000, Group: "default", Status: common.UserStatusEnabled}
	require.NoError(t, DB.Create(&user).Error)
	plan := &SubscriptionPlan{Title: "Renewable", AllowRenewal: common.GetPointer(true), PriceAmount: 2, DurationUnit: SubscriptionDurationDay, DurationValue: 30, Enabled: true, MaxPurchasePerUser: 1, TotalAmount: 1000, QuotaResetPeriod: SubscriptionResetDaily, UpgradeGroup: "pro", QuotaWindows: `[{"key":"hourly","name":"Hourly","period_unit":"hour","period_value":1,"amount_total":100}]`}
	require.NoError(t, DB.Create(plan).Error)
	InvalidateSubscriptionPlanCache(plan.Id)
	t.Cleanup(func() { InvalidateSubscriptionPlanCache(plan.Id) })
	sub, err := CreateUserSubscriptionFromPlanTx(DB, user.Id, plan, "order")
	require.NoError(t, err)
	require.NoError(t, DB.Model(sub).Update("amount_used", 350).Error)
	require.NoError(t, DB.Model(&UserSubscriptionQuotaWindow{}).Where("user_subscription_id = ?", sub.Id).Update("amount_used", 40).Error)
	return user, plan, sub
}

func TestAdminManualRenewalExtendsWithoutChargingOrCreatingSalesOrder(t *testing.T) {
	user, plan, sub := seedSubscriptionRenewal(t)
	require.NoError(t, DB.Model(plan).Update("allow_renewal", false).Error)
	beforeQuota := getUserQuotaForPaymentGuardTest(t, user.Id)
	renewed, err := AdminRenewUserSubscription(user.Id, sub.Id, 1)
	require.NoError(t, err)
	assert.Equal(t, sub.Id, renewed.Id)
	assert.Equal(t, time.Unix(sub.EndTime, 0).AddDate(0, 1, 0).Unix(), renewed.EndTime)
	assert.EqualValues(t, 350, renewed.AmountUsed)
	assert.Equal(t, beforeQuota, getUserQuotaForPaymentGuardTest(t, user.Id))
	var orders int64
	require.NoError(t, DB.Model(&SubscriptionOrder{}).Where("user_id = ?", user.Id).Count(&orders).Error)
	assert.Zero(t, orders)

	other := User{Username: "other-renewal-user", AffCode: "other-renewal", Group: "default", Status: common.UserStatusEnabled}
	require.NoError(t, DB.Create(&other).Error)
	_, err = AdminRenewUserSubscription(other.Id, sub.Id, 1)
	require.Error(t, err)
	assert.Equal(t, renewed.EndTime, getSubscriptionResetSub(t, sub.Id).EndTime)
}

func TestAdminManualRenewalOfExpiredSubscriptionStartsNewPeriod(t *testing.T) {
	user, _, sub := seedSubscriptionRenewal(t)
	require.NoError(t, DB.Model(sub).Updates(map[string]any{"end_time": GetDBTimestamp() - 1, "status": "expired"}).Error)
	renewed, err := AdminRenewUserSubscription(user.Id, sub.Id, 1)
	require.NoError(t, err)
	assert.NotEqual(t, sub.Id, renewed.Id)
	assert.Equal(t, "admin", renewed.Source)
	assert.Zero(t, renewed.AmountUsed)
	assert.Equal(t, time.Unix(renewed.StartTime, 0).AddDate(0, 1, 0).Unix(), renewed.EndTime)
	assert.EqualValues(t, 350, getSubscriptionResetSub(t, sub.Id).AmountUsed)
	require.NoError(t, DB.Model(sub).Update("status", "cancelled").Error)
	_, err = AdminRenewUserSubscription(user.Id, sub.Id, 1)
	require.ErrorContains(t, err, "不可续费")
}

func TestAdminRenewalMonthsBoundsAndPlanDurationPreserved(t *testing.T) {
	user, plan, sub := seedSubscriptionRenewal(t)
	for _, months := range []int{-1, 0, 13} {
		_, err := AdminRenewUserSubscription(user.Id, sub.Id, months)
		require.ErrorContains(t, err, "1 至 12")
		assert.Equal(t, sub.EndTime, getSubscriptionResetSub(t, sub.Id).EndTime)
	}
	renewed, err := AdminRenewUserSubscription(user.Id, sub.Id, 12)
	require.NoError(t, err)
	assert.Equal(t, time.Unix(sub.EndTime, 0).AddDate(0, 12, 0).Unix(), renewed.EndTime)
	assert.EqualValues(t, 350, renewed.AmountUsed)
	var unchanged SubscriptionPlan
	require.NoError(t, DB.First(&unchanged, plan.Id).Error)
	assert.Equal(t, SubscriptionDurationDay, unchanged.DurationUnit)
	assert.Equal(t, 30, unchanged.DurationValue)
}

func TestAdminManualRenewalDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(filepath.Join(t.TempDir(), "renewal.db"))
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN not configured")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			var version string
			versionSQL := "SELECT VERSION()"
			if dialect == "sqlite" {
				versionSQL = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(versionSQL).Scan(&version).Error)
			t.Logf("%s version: %s", dialect, version)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			previousDB, previousType := DB, common.MainDatabaseType()
			DB = db
			common.SetMainDatabaseType(common.DatabaseType(dialect))
			initCol()
			t.Cleanup(func() {
				DB = previousDB
				common.SetMainDatabaseType(previousType)
				initCol()
				_ = sqlDB.Close()
			})
			require.NoError(t, db.AutoMigrate(&User{}, &SubscriptionPlan{}, &UserSubscription{}, &UserSubscriptionQuotaWindow{}, &SubscriptionOrder{}))
			user := User{Username: "matrix-renewal", AffCode: "matrix-renewal", Quota: 1000, Group: "default", Status: common.UserStatusEnabled}
			require.NoError(t, db.Create(&user).Error)
			plan := &SubscriptionPlan{Title: "Matrix", DurationUnit: SubscriptionDurationDay, DurationValue: 1, TotalAmount: 100, Enabled: true}
			require.NoError(t, db.Create(plan).Error)
			sub, err := CreateUserSubscriptionFromPlanTx(db, user.Id, plan, "admin")
			require.NoError(t, err)
			renewed, err := AdminRenewUserSubscription(user.Id, sub.Id, 1)
			require.NoError(t, err)
			assert.Equal(t, time.Unix(sub.EndTime, 0).AddDate(0, 1, 0).Unix(), renewed.EndTime)
			var persisted UserSubscription
			require.NoError(t, db.First(&persisted, sub.Id).Error)
			assert.Equal(t, renewed.EndTime, persisted.EndTime)
			var orders int64
			require.NoError(t, db.Model(&SubscriptionOrder{}).Count(&orders).Error)
			assert.Zero(t, orders)
			require.NoError(t, db.Unscoped().Where("user_subscription_id = ?", sub.Id).Delete(&UserSubscriptionQuotaWindow{}).Error)
			require.NoError(t, db.Unscoped().Where("user_id = ?", user.Id).Delete(&UserSubscription{}).Error)
			require.NoError(t, db.Unscoped().Delete(plan).Error)
			require.NoError(t, db.Unscoped().Delete(&user).Error)
		})
	}
}

func TestSubscriptionRenewalBalancePreservesUsageAndBypassesOnlyRenewalLimit(t *testing.T) {
	user, plan, sub := seedSubscriptionRenewal(t)
	require.ErrorContains(t, ValidateSubscriptionPurchase(user.Id, plan, 0), "购买上限")
	require.NoError(t, ValidateSubscriptionPurchase(user.Id, plan, sub.Id))
	require.ErrorContains(t, PurchaseSubscriptionWithBalance(user.Id, plan.Id, 0, "203.0.113.10"), "购买上限")
	require.NoError(t, PurchaseSubscriptionWithBalance(user.Id, plan.Id, sub.Id, "203.0.113.10"))
	updated := getSubscriptionResetSub(t, sub.Id)
	assert.Equal(t, sub.EndTime+30*86400, updated.EndTime)
	assert.Equal(t, sub.StartTime, updated.StartTime)
	assert.EqualValues(t, 350, updated.AmountUsed)
	assert.Equal(t, sub.AmountTotal, updated.AmountTotal)
	assert.Equal(t, sub.LastResetTime, updated.LastResetTime)
	assert.Equal(t, sub.NextResetTime, updated.NextResetTime)
	assert.Equal(t, "default", updated.PrevUserGroup)
	assert.EqualValues(t, 1, countUserSubscriptionsForPaymentGuardTest(t, user.Id))
	var window UserSubscriptionQuotaWindow
	require.NoError(t, DB.Where("user_subscription_id = ?", sub.Id).First(&window).Error)
	assert.EqualValues(t, 40, window.AmountUsed)
	assert.Equal(t, sub.StartTime+3600, window.NextResetTime)
	var order SubscriptionOrder
	require.NoError(t, DB.Where("user_id = ?", user.Id).First(&order).Error)
	assert.Equal(t, sub.Id, order.RenewalSubscriptionId)
	assert.Equal(t, sub.Id, order.RenewalSourceId)
	assert.Equal(t, sub.EndTime, order.RenewalDueTime)
	assert.Equal(t, common.TopUpStatusSuccess, order.Status)
	assert.Equal(t, PaymentProviderBalance, order.PaymentProvider)
	cost, err := calcSubscriptionBalanceQuota(plan.PriceAmount)
	require.NoError(t, err)
	assert.Equal(t, user.Quota-cost, getUserQuotaForPaymentGuardTest(t, user.Id))
}

func TestSubscriptionRenewalExpiredOpensFreshCountersAndPreservesOldHistory(t *testing.T) {
	for _, status := range []string{"active", "expired"} {
		t.Run(status, func(t *testing.T) {
			user, plan, sub := seedSubscriptionRenewal(t)
			require.NoError(t, DB.Model(sub).Updates(map[string]interface{}{"end_time": GetDBTimestamp() - 1, "status": status}).Error)
			before := GetDBTimestamp()
			require.NoError(t, PurchaseSubscriptionWithBalance(user.Id, plan.Id, sub.Id, "203.0.113.10"))
			after := GetDBTimestamp()
			var renewed UserSubscription
			require.NoError(t, DB.Where("user_id = ? AND id <> ?", user.Id, sub.Id).First(&renewed).Error)
			assert.GreaterOrEqual(t, renewed.StartTime, before)
			assert.LessOrEqual(t, renewed.StartTime, after)
			assert.Equal(t, renewed.StartTime+30*86400, renewed.EndTime)
			assert.Zero(t, renewed.AmountUsed)
			assert.Equal(t, "default", renewed.PrevUserGroup)
			assert.EqualValues(t, 350, getSubscriptionResetSub(t, sub.Id).AmountUsed)
			var window UserSubscriptionQuotaWindow
			require.NoError(t, DB.Where("user_subscription_id = ?", renewed.Id).First(&window).Error)
			assert.Zero(t, window.AmountUsed)
			var firstOrder SubscriptionOrder
			require.NoError(t, DB.Where("user_id = ?", user.Id).First(&firstOrder).Error)
			assert.Equal(t, sub.Id, firstOrder.RenewalSourceId)
			assert.Equal(t, getSubscriptionResetSub(t, sub.Id).EndTime, firstOrder.RenewalDueTime)
			// A second pending renewal of the old record extends the new period.
			require.NoError(t, PurchaseSubscriptionWithBalance(user.Id, plan.Id, sub.Id, "203.0.113.10"))
			assert.EqualValues(t, 2, countUserSubscriptionsForPaymentGuardTest(t, user.Id))
			assert.Equal(t, renewed.EndTime+30*86400, getSubscriptionResetSub(t, renewed.Id).EndTime)
			var secondOrder SubscriptionOrder
			require.NoError(t, DB.Where("user_id = ?", user.Id).Last(&secondOrder).Error)
			assert.Equal(t, renewed.Id, secondOrder.RenewalSourceId)
			assert.Equal(t, renewed.EndTime, secondOrder.RenewalDueTime)
		})
	}
}

func TestSubscriptionRenewalCallbacksAreIdempotentAcrossGateways(t *testing.T) {
	for _, provider := range []string{PaymentProviderStripe, PaymentProviderCreem, PaymentProviderEpay, PaymentProviderWaffoPancake} {
		t.Run(provider, func(t *testing.T) {
			user, plan, sub := seedSubscriptionRenewal(t)
			order := &SubscriptionOrder{UserId: user.Id, PlanId: plan.Id, RenewalSubscriptionId: sub.Id, Money: plan.PriceAmount, TradeNo: "renew-" + provider, PaymentProvider: provider, PaymentMethod: provider, Status: common.TopUpStatusPending}
			require.NoError(t, order.Insert())
			require.ErrorIs(t, CompleteSubscriptionOrder(order.TradeNo, "", "wrong-provider", "", "203.0.113.10"), ErrPaymentMethodMismatch)
			var failedLogs int64
			require.NoError(t, LOG_DB.Model(&Log{}).Where("user_id = ? AND type = ?", user.Id, LogTypeTopup).Count(&failedLogs).Error)
			assert.Zero(t, failedLogs)
			require.NoError(t, CompleteSubscriptionOrder(order.TradeNo, "", provider, "", "203.0.113.10"))
			require.NoError(t, CompleteSubscriptionOrder(order.TradeNo, "", provider, "", "203.0.113.11"))
			assert.Equal(t, sub.EndTime+30*86400, getSubscriptionResetSub(t, sub.Id).EndTime)
			assert.EqualValues(t, 1, countUserSubscriptionsForPaymentGuardTest(t, user.Id))
			assert.Equal(t, user.Quota, getUserQuotaForPaymentGuardTest(t, user.Id))
			var count int64
			require.NoError(t, DB.Model(&TopUp{}).Where("trade_no = ?", order.TradeNo).Count(&count).Error)
			assert.EqualValues(t, 1, count)
			completed := GetSubscriptionOrderByTradeNo(order.TradeNo)
			assert.Equal(t, common.TopUpStatusSuccess, completed.Status)
			assert.Equal(t, sub.Id, completed.RenewalSourceId)
			assert.Equal(t, sub.EndTime, completed.RenewalDueTime)
			var logs []*Log
			require.NoError(t, LOG_DB.Where("user_id = ? AND type = ?", user.Id, LogTypeTopup).Find(&logs).Error)
			require.Len(t, logs, 1)
			assert.Equal(t, "203.0.113.10", logs[0].Ip)
			var details struct {
				AdminInfo map[string]string `json:"admin_info"`
			}
			require.NoError(t, common.UnmarshalJsonStr(logs[0].Other, &details))
			assert.Equal(t, map[string]string{
				"server_ip": common.GetIp(), "node_name": common.NodeName, "version": common.Version,
				"caller_ip": "203.0.113.10", "payment_method": provider, "callback_payment_method": provider,
			}, details.AdminInfo)
			formatUserLogs(logs, 0)
			userDetails, err := common.StrToMap(logs[0].Other)
			require.NoError(t, err)
			assert.NotContains(t, userDetails, "admin_info")
		})
	}
}

func TestSubscriptionRenewalRejectsInvalidTargetsWithoutCharging(t *testing.T) {
	for _, scenario := range []string{"foreign-user", "different-plan", "cancelled", "missing", "negative"} {
		t.Run(scenario, func(t *testing.T) {
			user, plan, sub := seedSubscriptionRenewal(t)
			id := sub.Id
			switch scenario {
			case "foreign-user":
				require.NoError(t, DB.Model(sub).Update("user_id", user.Id+1).Error)
			case "different-plan":
				require.NoError(t, DB.Model(sub).Update("plan_id", plan.Id+1).Error)
			case "cancelled":
				require.NoError(t, DB.Model(sub).Update("status", "cancelled").Error)
			case "missing":
				id = sub.Id + 999
			case "negative":
				id = -1
			}
			require.Error(t, ValidateSubscriptionPurchase(user.Id, plan, id))
			require.Error(t, PurchaseSubscriptionWithBalance(user.Id, plan.Id, id, "203.0.113.10"))
			assert.Equal(t, user.Quota, getUserQuotaForPaymentGuardTest(t, user.Id))
			assert.Equal(t, sub.EndTime, getSubscriptionResetSub(t, sub.Id).EndTime)
			var count int64
			require.NoError(t, DB.Model(&SubscriptionOrder{}).Count(&count).Error)
			assert.Zero(t, count)
		})
	}
}

func TestSubscriptionRenewalRestoresSuppressedResetTimesWithoutResettingUsage(t *testing.T) {
	user, plan, sub := seedSubscriptionRenewal(t)
	require.NoError(t, DB.Model(plan).Updates(map[string]interface{}{"quota_reset_period": SubscriptionResetCustom, "quota_reset_custom_seconds": 3600}).Error)
	InvalidateSubscriptionPlanCache(plan.Id)
	now := GetDBTimestamp()
	start := now - 1800
	require.NoError(t, DB.Model(sub).Updates(map[string]interface{}{"start_time": start, "end_time": now + 1200, "last_reset_time": start, "next_reset_time": 0}).Error)
	require.NoError(t, DB.Model(&UserSubscriptionQuotaWindow{}).Where("user_subscription_id = ?", sub.Id).Updates(map[string]interface{}{"window_start": start, "next_reset_time": 0}).Error)
	require.NoError(t, PurchaseSubscriptionWithBalance(user.Id, plan.Id, sub.Id, "203.0.113.10"))
	updated := getSubscriptionResetSub(t, sub.Id)
	assert.EqualValues(t, 350, updated.AmountUsed)
	assert.Equal(t, start, updated.LastResetTime)
	assert.Greater(t, updated.NextResetTime, now+1200)
	var window UserSubscriptionQuotaWindow
	require.NoError(t, DB.Where("user_subscription_id = ?", sub.Id).First(&window).Error)
	assert.EqualValues(t, 40, window.AmountUsed)
	assert.Equal(t, start, window.WindowStart)
	assert.Equal(t, start+3600, window.NextResetTime)
}

func TestSubscriptionRenewalNonResettingQuotaAddsPackAndRejectsOverflow(t *testing.T) {
	for _, tc := range []struct {
		name  string
		total int64
		want  int64
		fails bool
	}{
		{"finite", 1000, 2000, false}, {"unlimited", 0, 0, false}, {"overflow", math.MaxInt64, 0, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			user, plan, sub := seedSubscriptionRenewal(t)
			require.NoError(t, DB.Model(plan).Update("quota_reset_period", SubscriptionResetNever).Error)
			InvalidateSubscriptionPlanCache(plan.Id)
			require.NoError(t, DB.Model(sub).Update("amount_total", tc.total).Error)
			err := PurchaseSubscriptionWithBalance(user.Id, plan.Id, sub.Id, "203.0.113.10")
			if tc.fails {
				require.ErrorContains(t, err, "超出范围")
				assert.Equal(t, user.Quota, getUserQuotaForPaymentGuardTest(t, user.Id))
				assert.Equal(t, sub.EndTime, getSubscriptionResetSub(t, sub.Id).EndTime)
				return
			}
			require.NoError(t, err)
			updated := getSubscriptionResetSub(t, sub.Id)
			assert.Equal(t, tc.want, updated.AmountTotal)
			assert.EqualValues(t, 350, updated.AmountUsed)
		})
	}
}

func TestSubscriptionRenewalFailureRollsBackDurationAndOrder(t *testing.T) {
	user, plan, sub := seedSubscriptionRenewal(t)
	order := &SubscriptionOrder{UserId: user.Id, PlanId: plan.Id, RenewalSubscriptionId: sub.Id, Money: 2, TradeNo: "renew-rollback", PaymentProvider: PaymentProviderStripe, PaymentMethod: PaymentMethodStripe, Status: common.TopUpStatusPending}
	require.NoError(t, order.Insert())
	// A conflicting accounting record must roll the whole fulfillment back.
	require.NoError(t, DB.Create(&TopUp{TradeNo: order.TradeNo, PaymentMethod: PaymentMethodCreem}).Error)
	require.ErrorIs(t, CompleteSubscriptionOrder(order.TradeNo, "", PaymentProviderStripe, "", "203.0.113.10"), ErrPaymentMethodMismatch)
	assert.Equal(t, sub.EndTime, getSubscriptionResetSub(t, sub.Id).EndTime)
	assert.Equal(t, common.TopUpStatusPending, GetSubscriptionOrderByTradeNo(order.TradeNo).Status)
}

func TestSubscriptionRenewalSeparateOrdersAccumulateAfterExpiry(t *testing.T) {
	user, plan, sub := seedSubscriptionRenewal(t)
	require.NoError(t, DB.Model(sub).Update("end_time", GetDBTimestamp()-1).Error)
	for i := 0; i < 2; i++ {
		order := &SubscriptionOrder{UserId: user.Id, PlanId: plan.Id, RenewalSubscriptionId: sub.Id, Money: 2, TradeNo: fmt.Sprintf("renew-expired-%d", i), PaymentProvider: PaymentProviderStripe, PaymentMethod: PaymentMethodStripe, Status: common.TopUpStatusPending}
		require.NoError(t, order.Insert())
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func(i int) {
			<-start
			results <- CompleteSubscriptionOrder(fmt.Sprintf("renew-expired-%d", i), "", PaymentProviderStripe, "", "203.0.113.10")
		}(i)
	}
	close(start)
	for i := 0; i < 2; i++ {
		require.NoError(t, <-results)
	}
	var renewed UserSubscription
	require.NoError(t, DB.Where("user_id = ? AND id <> ?", user.Id, sub.Id).First(&renewed).Error)
	assert.Equal(t, renewed.StartTime+60*86400, renewed.EndTime)
	assert.EqualValues(t, 2, countUserSubscriptionsForPaymentGuardTest(t, user.Id))
}

func TestSubscriptionRenewalPlanPolicyControlsNewPayments(t *testing.T) {
	for _, tc := range []struct {
		name        string
		allowed     *bool
		wantAllowed bool
	}{
		{"legacy plan", nil, false}, {"enabled", common.GetPointer(true), true}, {"disabled", common.GetPointer(false), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			user, plan, sub := seedSubscriptionRenewal(t)
			plan.AllowRenewal = tc.allowed
			require.NoError(t, DB.Model(plan).Update("allow_renewal", tc.allowed).Error)
			InvalidateSubscriptionPlanCache(plan.Id)
			checkoutErr := ValidateSubscriptionPurchase(user.Id, plan, sub.Id)
			paymentErr := PurchaseSubscriptionWithBalance(user.Id, plan.Id, sub.Id, "203.0.113.10")
			if tc.wantAllowed {
				require.NoError(t, checkoutErr)
				require.NoError(t, paymentErr)
				assert.Equal(t, sub.EndTime+30*86400, getSubscriptionResetSub(t, sub.Id).EndTime)
			} else {
				require.ErrorContains(t, checkoutErr, "不允许续费")
				require.ErrorContains(t, paymentErr, "不允许续费")
				assert.Equal(t, user.Quota, getUserQuotaForPaymentGuardTest(t, user.Id))
				assert.Equal(t, sub.EndTime, getSubscriptionResetSub(t, sub.Id).EndTime)
				var orderCount int64
				require.NoError(t, DB.Model(&SubscriptionOrder{}).Count(&orderCount).Error)
				assert.Zero(t, orderCount)
				// The renewal switch does not prohibit ordinary purchases.
				plan.MaxPurchasePerUser = 0
				require.NoError(t, ValidateSubscriptionPurchase(user.Id, plan, 0))
			}
		})
	}
}

func TestSubscriptionRenewalPendingOrderCompletesAfterRenewalIsDisabled(t *testing.T) {
	user, plan, sub := seedSubscriptionRenewal(t)
	require.NoError(t, ValidateSubscriptionPurchase(user.Id, plan, sub.Id))
	order := &SubscriptionOrder{UserId: user.Id, PlanId: plan.Id, RenewalSubscriptionId: sub.Id, Money: 2, TradeNo: "renewal-policy-pending", PaymentProvider: PaymentProviderEpay, PaymentMethod: "alipay", Status: common.TopUpStatusPending}
	require.NoError(t, order.Insert())
	require.NoError(t, DB.Model(plan).Update("allow_renewal", false).Error)
	InvalidateSubscriptionPlanCache(plan.Id)
	require.NoError(t, CompleteSubscriptionOrder(order.TradeNo, "", PaymentProviderEpay, "", "203.0.113.10"))
	assert.Equal(t, sub.EndTime+30*86400, getSubscriptionResetSub(t, sub.Id).EndTime)
	assert.Equal(t, common.TopUpStatusSuccess, GetSubscriptionOrderByTradeNo(order.TradeNo).Status)
}

func TestSubscriptionRenewalSQLiteMigrationDefaultsOffAndPreservesSettings(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	original := DB
	DB = db
	t.Cleanup(func() { DB = original; sqlDB, _ := db.DB(); _ = sqlDB.Close() })
	require.NoError(t, db.Exec("CREATE TABLE subscription_plans (id integer PRIMARY KEY, title varchar(128) NOT NULL, price_amount decimal(10,6) NOT NULL)").Error)
	require.NoError(t, db.Exec("INSERT INTO subscription_plans (id,title,price_amount) VALUES (1, 'Existing plan', 2)").Error)
	require.NoError(t, ensureSubscriptionPlanTableSQLite())
	var plan SubscriptionPlan
	require.NoError(t, db.First(&plan, 1).Error)
	assert.Nil(t, plan.AllowRenewal)
	plan.NormalizeDefaults()
	require.NotNil(t, plan.AllowRenewal)
	assert.False(t, *plan.AllowRenewal)
	for _, enabled := range []bool{false, true} {
		require.NoError(t, db.Model(&plan).Update("allow_renewal", enabled).Error)
		require.NoError(t, ensureSubscriptionPlanTableSQLite())
		require.NoError(t, db.First(&plan, 1).Error)
		plan.NormalizeDefaults()
		require.NotNil(t, plan.AllowRenewal)
		assert.Equal(t, enabled, *plan.AllowRenewal)
	}
	assert.Equal(t, "Existing plan", plan.Title)
	assert.Equal(t, float64(2), plan.PriceAmount)
}
