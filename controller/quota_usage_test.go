package controller

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestQuotaUsageSnapshotAndAuthorization(t *testing.T) {
	oldDB, oldLogDB := model.DB, model.LOG_DB
	oldPath, oldMaster, oldRedis := common.SQLitePath, common.IsMasterNode, common.RedisEnabled
	oldMain, oldLog := common.MainDatabaseType(), common.LogDatabaseType()
	t.Setenv("SQL_DSN", "")
	t.Setenv("LOG_SQL_DSN", "")
	common.SQLitePath = filepath.Join(t.TempDir(), "quota.db")
	common.IsMasterNode = false
	common.RedisEnabled = false
	require.NoError(t, model.InitDB())
	db := model.DB
	t.Cleanup(func() {
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
		model.DB, model.LOG_DB = oldDB, oldLogDB
		common.SQLitePath, common.IsMasterNode, common.RedisEnabled = oldPath, oldMaster, oldRedis
		common.SetDatabaseTypes(oldMain, oldLog)
	})
	require.NoError(t, db.AutoMigrate(&model.Token{}, &model.User{}, &model.SubscriptionPlan{}, &model.UserSubscription{}, &model.UserSubscriptionQuotaWindow{}))
	now := common.GetTimestamp()
	user := model.User{Id: 81901, Username: "quota-owner", Status: common.UserStatusEnabled, Quota: 500000, AffCode: "quota-owner"}
	other := model.User{Id: 81902, Username: "quota-other", Status: common.UserStatusEnabled, Quota: 900000, AffCode: "quota-other"}
	require.NoError(t, db.Create(&user).Error)
	require.NoError(t, db.Create(&other).Error)
	token := model.Token{UserId: user.Id, Key: "quota_fixture_credential", Status: common.TokenStatusEnabled, ExpiredTime: -1, RemainQuota: 120000, UsedQuota: 30000}
	require.NoError(t, db.Create(&token).Error)
	plan := model.SubscriptionPlan{Title: "Local test plan", QuotaResetPeriod: "daily"}
	require.NoError(t, db.Create(&plan).Error)
	sub := model.UserSubscription{UserId: user.Id, PlanId: plan.Id, AmountTotal: 100000, AmountUsed: 25000, Status: "active", EndTime: now + 86400, NextResetTime: now - 1}
	require.NoError(t, db.Create(&sub).Error)
	window := model.UserSubscriptionQuotaWindow{UserSubscriptionId: sub.Id, WindowKey: "hour", Name: "Hourly", PeriodUnit: "hour", PeriodValue: 1, AmountTotal: 10000, AmountUsed: 12000, WindowStart: now - 3600, NextResetTime: now + 3600}
	require.NoError(t, db.Create(&window).Error)
	for _, extra := range []model.UserSubscription{
		{UserId: other.Id, PlanId: plan.Id, AmountTotal: 999, Status: "active", EndTime: now + 86400},
		{UserId: user.Id, PlanId: plan.Id, Status: "active", EndTime: now - 10},
		{UserId: user.Id, PlanId: plan.Id, Status: "cancelled", EndTime: now + 86400},
	} {
		require.NoError(t, db.Create(&extra).Error)
	}
	router := gin.New()
	require.NoError(t, router.SetTrustedProxies(nil))
	router.GET("/api/usage/quota", middleware.TokenAuthReadOnly(), GetQuotaUsage)
	request := func(auth string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/usage/quota?user_id=81902&token_id=999", nil)
		req.RemoteAddr = "127.0.0.1:12345"
		if auth != "" {
			req.Header.Set("Authorization", auth)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	auth := "Bearer sk-" + token.Key
	rec := request(auth)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"))
	var body struct {
		Success bool `json:"success"`
		Data    struct {
			Object string `json:"object"`
			Wallet struct {
				Remaining int `json:"remaining"`
			} `json:"wallet"`
			Token struct {
				Remaining *int `json:"remaining"`
				Unlimited bool `json:"unlimited"`
			} `json:"token"`
			Subscriptions []struct {
				ID      int                `json:"id"`
				Name    string             `json:"name"`
				Windows []quotaUsageWindow `json:"windows"`
			} `json:"subscriptions"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	require.True(t, body.Success)
	assert.Equal(t, "quota_snapshot", body.Data.Object)
	assert.Equal(t, 500000, body.Data.Wallet.Remaining)
	require.NotNil(t, body.Data.Token.Remaining)
	assert.Equal(t, 120000, *body.Data.Token.Remaining)
	require.Len(t, body.Data.Subscriptions, 1)
	assert.Equal(t, sub.Id, body.Data.Subscriptions[0].ID)
	assert.Equal(t, "Local test plan", body.Data.Subscriptions[0].Name)
	require.NotNil(t, body.Data.Subscriptions[0].Windows[0].Remaining)
	assert.EqualValues(t, 75000, *body.Data.Subscriptions[0].Windows[0].Remaining)
	assert.True(t, body.Data.Subscriptions[0].Windows[0].ResetPending)
	require.Len(t, body.Data.Subscriptions[0].Windows, 2)
	assert.EqualValues(t, 0, *body.Data.Subscriptions[0].Windows[1].Remaining)
	assert.Equal(t, 120.0, *body.Data.Subscriptions[0].Windows[1].UsedPercent)
	assert.Equal(t, 25.0, *body.Data.Subscriptions[0].Windows[0].UsedPercent)
	assert.EqualValues(t, 86400, *body.Data.Subscriptions[0].Windows[0].WindowDurationSeconds)
	assert.NotContains(t, rec.Body.String(), token.Key)
	for _, field := range []string{"password", "email", "user_id", "allow_ips", "stripe_price_id"} {
		assert.NotContains(t, rec.Body.String(), `"`+field+`"`)
	}
	var after model.UserSubscription
	require.NoError(t, db.First(&after, sub.Id).Error)
	assert.Equal(t, sub, after) // Due reset must not be performed by this GET.
	var tokenAfter model.Token
	require.NoError(t, db.First(&tokenAfter, token.Id).Error)
	assert.Equal(t, token, tokenAfter)
	cases := []struct {
		name    string
		updates map[string]any
		auth    string
		want    int
	}{
		{"missing", nil, "", http.StatusUnauthorized},
		{"invalid", nil, "Bearer unknown", http.StatusUnauthorized},
		{"disabled", map[string]any{"status": common.TokenStatusDisabled}, auth, http.StatusUnauthorized},
		{"expired", map[string]any{"status": common.TokenStatusEnabled, "expired_time": now - 1}, auth, http.StatusUnauthorized},
		{"ip restricted", map[string]any{"expired_time": -1, "allow_ips": "192.0.2.0/24"}, auth, http.StatusForbidden},
		{"exhausted", map[string]any{"status": common.TokenStatusExhausted, "allow_ips": "", "remain_quota": 0}, auth, http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.updates != nil {
				require.NoError(t, db.Model(&model.Token{}).Where("id = ?", token.Id).Updates(tc.updates).Error)
			}
			assert.Equal(t, tc.want, request(tc.auth).Code)
		})
	}
	require.NoError(t, db.Model(&model.Token{}).Where("id = ?", token.Id).Update("unlimited_quota", true).Error)
	require.NoError(t, db.Model(&model.UserSubscription{}).Where("id = ?", sub.Id).Update("amount_total", 0).Error)
	rec = request(auth)
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Nil(t, body.Data.Token.Remaining)
	assert.True(t, body.Data.Token.Unlimited)
	assert.Nil(t, body.Data.Subscriptions[0].Windows[0].Remaining)
	require.NoError(t, db.Model(&model.UserSubscription{}).Where("id = ?", sub.Id).Update("status", "cancelled").Error)
	require.NoError(t, json.Unmarshal(request(auth).Body.Bytes(), &body))
	assert.Empty(t, body.Data.Subscriptions)
	// Production Plus/Ultra limits, with fictional usage and independent windows.
	for _, fixture := range []struct {
		name                            string
		total, used, weekly, weeklyUsed int64
	}{
		{"Plus 月卡", 15000000, 3000000, 120000000, 30000000},
		{"Ultra 月卡", 75000000, 15000000, 600000000, 120000000},
	} {
		plan := model.SubscriptionPlan{Title: fixture.name, QuotaResetPeriod: "custom", QuotaResetCustomSeconds: 18000}
		require.NoError(t, db.Create(&plan).Error)
		sub := model.UserSubscription{UserId: user.Id, PlanId: plan.Id, AmountTotal: fixture.total, AmountUsed: fixture.used, Status: "active", EndTime: now + 2592000, NextResetTime: now + 3600}
		require.NoError(t, db.Create(&sub).Error)
		w := model.UserSubscriptionQuotaWindow{UserSubscriptionId: sub.Id, WindowKey: "weekly", Name: "周额度", PeriodUnit: "week", PeriodValue: 1, AmountTotal: fixture.weekly, AmountUsed: fixture.weeklyUsed, WindowStart: now - 86400, NextResetTime: now + 518400}
		require.NoError(t, db.Create(&w).Error)
	}
	rec = request(auth)
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	require.Len(t, body.Data.Subscriptions, 2)
	for _, sub := range body.Data.Subscriptions {
		require.Len(t, sub.Windows, 2)
		primary, weekly := sub.Windows[0], sub.Windows[1]
		assert.Equal(t, "primary", primary.Key)
		assert.Equal(t, "weekly", weekly.Key)
		assert.EqualValues(t, 18000, *primary.WindowDurationSeconds)
		assert.EqualValues(t, 604800, *weekly.WindowDurationSeconds)
		assert.InDelta(t, 20, *primary.UsedPercent, 0.00001)
		if sub.Name == "Plus 月卡" {
			assert.EqualValues(t, 12000000, *primary.Remaining)
			assert.EqualValues(t, 90000000, *weekly.Remaining)
		} else {
			assert.Equal(t, "Ultra 月卡", sub.Name)
			assert.EqualValues(t, 60000000, *primary.Remaining)
			assert.EqualValues(t, 480000000, *weekly.Remaining)
		}
	}
	assert.NotContains(t, rec.Body.String(), `"quota_windows"`)
	assert.NotContains(t, rec.Body.String(), `"next_reset_at"`)
	require.NoError(t, db.Model(&model.User{}).Where("id = ?", user.Id).Update("status", common.UserStatusDisabled).Error)
	assert.Equal(t, http.StatusForbidden, request(auth).Code)
	require.NoError(t, db.Delete(&model.Token{}, token.Id).Error)
	assert.Equal(t, http.StatusUnauthorized, request(auth).Code)
}

func TestQuotaUsageWindowCalendarAndUnlimited(t *testing.T) {
	monthly := newQuotaUsageWindow("primary", "主额度", "month", 1, 100, 0, 0, 1000)
	assert.Nil(t, monthly.WindowDurationSeconds)
	assert.Equal(t, "month", monthly.PeriodUnit)
	assert.Nil(t, monthly.ResetsAt)
	assert.False(t, monthly.ResetPending)
	unlimited := newQuotaUsageWindow("primary", "主额度", "never", 0, 0, 500, 0, 1000)
	assert.True(t, unlimited.Unlimited)
	assert.Nil(t, unlimited.Remaining)
	assert.Nil(t, unlimited.UsedPercent)
	assert.Nil(t, unlimited.WindowDurationSeconds)
}
