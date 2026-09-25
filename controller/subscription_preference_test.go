package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSubscriptionPreference(t *testing.T) {
	dialect := os.Getenv("TEST_SUBSCRIPTION_DIALECT")
	if dialect == "" {
		dialect = "sqlite"
	}
	db, _ := newAuditTestDatabase(t, dialect, os.Getenv("TEST_"+strings.ToUpper(dialect)+"_DSN"))
	oldDB, oldLog := model.DB, model.LOG_DB
	oldMain, oldLogType := common.MainDatabaseType(), common.LogDatabaseType()
	oldRedis := common.RedisEnabled
	model.DB, model.LOG_DB = db, db
	common.SetDatabaseTypes(common.DatabaseType(dialect), common.DatabaseType(dialect))
	common.RedisEnabled = false
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLog
		common.SetDatabaseTypes(oldMain, oldLogType)
		common.RedisEnabled = oldRedis
	})
	var version string
	query := "SELECT version()"
	if dialect == "sqlite" {
		query = "SELECT sqlite_version()"
	}
	require.NoError(t, db.Raw(query).Scan(&version).Error)
	t.Logf("database: %s %s", dialect, version)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.SubscriptionPlan{}, &model.UserSubscription{}, &model.UserSubscriptionQuotaWindow{}, &model.SubscriptionPreConsumeRecord{}))
	user := model.User{Username: "preference-user", Quota: 10000}
	user.SetSetting(dto.UserSetting{BillingPreference: "subscription_only", Language: "en", RecordIpLog: true})
	require.NoError(t, db.Create(&user).Error)
	plan := model.SubscriptionPlan{Title: "Preference", DurationUnit: model.SubscriptionDurationDay, DurationValue: 30, TotalAmount: 1000, QuotaResetPeriod: model.SubscriptionResetNever}
	require.NoError(t, db.Create(&plan).Error)
	model.InvalidateSubscriptionPlanCache(plan.Id)
	t.Cleanup(func() { model.InvalidateSubscriptionPlanCache(plan.Id) })
	now := model.GetDBTimestamp()
	subs := []model.UserSubscription{
		{UserId: user.Id, PlanId: plan.Id, Status: "active", StartTime: now - 100, EndTime: now + 86400, AmountTotal: 1000},
		{UserId: user.Id, PlanId: plan.Id, Status: "active", StartTime: now - 100, EndTime: now + 86400, AmountTotal: 1000},
		{UserId: user.Id, PlanId: plan.Id, Status: "active", StartTime: now - 100, EndTime: now + 172800, AmountTotal: 1000},
		{UserId: user.Id + 1, PlanId: plan.Id, Status: "active", StartTime: now - 100, EndTime: now + 86400, AmountTotal: 1000},
	}
	for i := range subs {
		require.NoError(t, db.Create(&subs[i]).Error)
	}
	request := func(body string) bool {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("id", user.Id)
		c.Request = httptest.NewRequest(http.MethodPut, "/api/subscription/self/preference", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		UpdateSubscriptionPreference(c)
		require.Equal(t, http.StatusOK, w.Code)
		var response struct {
			Success bool `json:"success"`
		}
		require.NoError(t, common.Unmarshal(w.Body.Bytes(), &response))
		return response.Success
	}
	t.Run("save_clear_and_preserve_other_settings", func(t *testing.T) {
		require.True(t, request(fmt.Sprintf(`{"preferred_subscription_id":%d}`, subs[2].Id)))
		setting, err := model.GetUserSetting(user.Id, true)
		require.NoError(t, err)
		assert.Equal(t, subs[2].Id, setting.PreferredSubscriptionId)
		assert.Equal(t, "subscription_only", setting.BillingPreference)
		assert.Equal(t, "en", setting.Language)
		assert.True(t, setting.RecordIpLog)
		require.True(t, request(`{"billing_preference":"wallet_first"}`))
		setting, err = model.GetUserSetting(user.Id, true)
		require.NoError(t, err)
		assert.Equal(t, subs[2].Id, setting.PreferredSubscriptionId)
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("id", user.Id)
		c.Request = httptest.NewRequest(http.MethodGet, "/api/subscription/self", nil)
		GetSubscriptionSelf(c)
		var response struct {
			Data struct {
				Preferred int `json:"preferred_subscription_id"`
			} `json:"data"`
		}
		require.NoError(t, common.Unmarshal(w.Body.Bytes(), &response))
		assert.Equal(t, subs[2].Id, response.Data.Preferred)
		require.True(t, request(`{"preferred_subscription_id":0}`))
		setting, err = model.GetUserSetting(user.Id, true)
		require.NoError(t, err)
		assert.Zero(t, setting.PreferredSubscriptionId)
		assert.Equal(t, "wallet_first", setting.BillingPreference)
	})
	t.Run("notification_settings_preserve_billing_preferences", func(t *testing.T) {
		require.NoError(t, i18n.Init())
		require.True(t, request(fmt.Sprintf(`{"preferred_subscription_id":%d,"billing_preference":"subscription_only"}`, subs[2].Id)))
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("id", user.Id)
		c.Request = httptest.NewRequest(http.MethodPut, "/api/user/setting", strings.NewReader(`{"notify_type":"email","quota_warning_threshold":0.1}`))
		c.Request.Header.Set("Content-Type", "application/json")
		UpdateUserSetting(c)
		var response struct {
			Success bool `json:"success"`
		}
		require.NoError(t, common.Unmarshal(w.Body.Bytes(), &response))
		require.True(t, response.Success, w.Body.String())
		setting, err := model.GetUserSetting(user.Id, true)
		require.NoError(t, err)
		assert.Equal(t, subs[2].Id, setting.PreferredSubscriptionId)
		assert.Equal(t, "subscription_only", setting.BillingPreference)
	})
	t.Run("reject_invalid_or_unowned_targets_without_changing_preference", func(t *testing.T) {
		require.True(t, request(fmt.Sprintf(`{"preferred_subscription_id":%d}`, subs[0].Id)))
		for _, body := range []string{`{"preferred_subscription_id":-1}`, `{"preferred_subscription_id":999999}`, fmt.Sprintf(`{"preferred_subscription_id":%d}`, subs[3].Id), `{"preferred_subscription_id":"1"}`, `{"preferred_subscription_id":1.5}`} {
			assert.False(t, request(body))
		}
		for _, status := range []string{"expired", "cancelled"} {
			require.NoError(t, db.Model(&subs[2]).Update("status", status).Error)
			assert.False(t, request(fmt.Sprintf(`{"preferred_subscription_id":%d}`, subs[2].Id)))
		}
		require.NoError(t, db.Model(&subs[2]).Updates(map[string]any{"status": "active", "end_time": now - 1}).Error)
		assert.False(t, request(fmt.Sprintf(`{"preferred_subscription_id":%d}`, subs[2].Id)))
		require.NoError(t, db.Model(&subs[2]).Update("end_time", now+172800).Error)
		setting, err := model.GetUserSetting(user.Id, true)
		require.NoError(t, err)
		assert.Equal(t, subs[0].Id, setting.PreferredSubscriptionId)
	})
	for _, tc := range []struct {
		name                string
		preferred, expected int
		used                int64
		status              string
		expired, window     bool
	}{
		{name: "default_expiry_and_id_order", expected: 0},
		{name: "preferred_later_expiry", preferred: 2, expected: 2},
		{name: "insufficient_preferred_quota", preferred: 2, expected: 0, used: 990},
		{name: "preferred_window_exhausted", preferred: 2, expected: 0, window: true},
		{name: "expired_preference", preferred: 2, expected: 0, expired: true},
		{name: "cancelled_preference", preferred: 2, expected: 0, status: "cancelled"},
		{name: "foreign_preference_ignored", preferred: 3, expected: 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			require.NoError(t, db.Model(&model.UserSubscription{}).Where("user_id = ?", user.Id).Updates(map[string]any{"amount_used": 0, "status": "active"}).Error)
			end := now + 172800
			if tc.expired {
				end = now - 1
			}
			status := "active"
			if tc.status != "" {
				status = tc.status
			}
			require.NoError(t, db.Model(&subs[2]).Updates(map[string]any{"amount_used": tc.used, "status": status, "end_time": end}).Error)
			require.NoError(t, db.Where("user_subscription_id = ?", subs[2].Id).Delete(&model.UserSubscriptionQuotaWindow{}).Error)
			if tc.window {
				require.NoError(t, db.Create(&model.UserSubscriptionQuotaWindow{UserSubscriptionId: subs[2].Id, WindowKey: "daily", Name: "Daily", PeriodUnit: "day", PeriodValue: 1, AmountTotal: 10, AmountUsed: 10, WindowStart: now, NextResetTime: now + 86400}).Error)
			}
			preferred := 0
			if tc.preferred > 0 {
				preferred = subs[tc.preferred].Id
			}
			info := &relaycommon.RelayInfo{UserId: user.Id, RequestId: "priority-" + tc.name, OriginModelName: "test", IsPlayground: true, UserSetting: dto.UserSetting{BillingPreference: "subscription_only", PreferredSubscriptionId: preferred}}
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			session, apiErr := service.NewBillingSession(c, info, 100)
			require.Nil(t, apiErr)
			assert.Equal(t, subs[tc.expected].Id, info.SubscriptionId)
			// Changing preference after reservation never moves a retry or settlement.
			replay, err := model.PreConsumeUserSubscription(info.RequestId, user.Id, "test", subs[1].Id, 100)
			require.NoError(t, err)
			assert.Equal(t, subs[tc.expected].Id, replay.UserSubscriptionId)
			require.NoError(t, session.Settle(60))
			var selected model.UserSubscription
			require.NoError(t, db.First(&selected, subs[tc.expected].Id).Error)
			assert.EqualValues(t, 60, selected.AmountUsed)
		})
	}
	t.Run("refund_stays_on_reserved_subscription", func(t *testing.T) {
		require.NoError(t, db.Model(&model.UserSubscription{}).Where("user_id = ?", user.Id).Update("amount_used", 0).Error)
		result, err := model.PreConsumeUserSubscription("priority-refund", user.Id, "test", subs[1].Id, 100)
		require.NoError(t, err)
		require.Equal(t, subs[1].Id, result.UserSubscriptionId)
		require.NoError(t, model.RefundSubscriptionPreConsume("priority-refund"))
		require.NoError(t, model.RefundSubscriptionPreConsume("priority-refund"))
		var selected model.UserSubscription
		require.NoError(t, db.First(&selected, subs[1].Id).Error)
		assert.Zero(t, selected.AmountUsed)
	})
}
