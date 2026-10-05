package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBusinessDashboardRequiresAdminAndValidPeriod(t *testing.T) {
	businessDashboardCache.Purge()
	t.Cleanup(businessDashboardCache.Purge)
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.TopUp{}, &model.SubscriptionOrder{}, &model.SubscriptionPlan{}, &model.UserSubscription{}, &model.Option{}, &model.Log{}))
	require.NoError(t, model.EnsureLegacyAccessTokenRetireAt(time.Now().Unix()))
	userToken, adminToken := "business-test-user", "business-test-admin"
	users := []model.User{
		{Username: "business-user", AffCode: "business-u", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AccessToken: &userToken},
		{Username: "business-admin", AffCode: "business-a", Role: common.RoleAdminUser, Status: common.UserStatusEnabled, AccessToken: &adminToken},
	}
	require.NoError(t, db.Create(&users).Error)
	engine := gin.New()
	engine.GET("/api/data/business", middleware.AdminAuth(), GetBusinessDashboard)
	for _, tc := range []struct {
		name, token, query string
		status             int
	}{
		{"anonymous", "", "7", http.StatusUnauthorized},
		{"regular user", userToken, "7", http.StatusForbidden},
		{"admin", adminToken, "7", http.StatusOK},
		{"invalid period", adminToken, "365", http.StatusBadRequest},
		{"invalid number", adminToken, "oops", http.StatusBadRequest},
		{"today", adminToken, "1", http.StatusOK},
		{"yesterday", adminToken, "1&offset=1", http.StatusOK},
		{"three days", adminToken, "3", http.StatusOK},
		{"invalid offset", adminToken, "7&offset=1", http.StatusBadRequest},
		{"anonymous after cache warmup", "", "7", http.StatusUnauthorized},
		{"regular user after cache warmup", userToken, "7", http.StatusForbidden},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/api/data/business?days="+tc.query, nil)
			if tc.token != "" {
				request.Header.Set("Authorization", "Bearer "+tc.token)
			}
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			require.Equal(t, tc.status, recorder.Code)
			if tc.status == http.StatusOK {
				assert.Contains(t, recorder.Body.String(), `"new_users"`)
				assert.Equal(t, "no-store", recorder.Header().Get("Cache-Control"))
			} else {
				assert.NotContains(t, recorder.Body.String(), `"new_users"`)
			}
		})
	}
}

func TestBusinessDashboardCustomPeriodValidation(t *testing.T) {
	businessDashboardCache.Purge()
	t.Cleanup(businessDashboardCache.Purge)
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.TopUp{}, &model.SubscriptionOrder{}, &model.SubscriptionPlan{}, &model.UserSubscription{}, &model.Option{}))
	engine := gin.New()
	engine.GET("/business", GetBusinessDashboard)
	for _, tc := range []struct {
		name, query string
		status      int
	}{
		{"custom period", "start_timestamp=1700000000&end_timestamp=1700003600", http.StatusOK},
		{"30 days", "start_timestamp=1700000000&end_timestamp=1702592000", http.StatusOK},
		{"missing end", "start_timestamp=1700000000", http.StatusBadRequest},
		{"missing start", "end_timestamp=1700003600", http.StatusBadRequest},
		{"empty range", "start_timestamp=&end_timestamp=", http.StatusBadRequest},
		{"malformed timestamp", "start_timestamp=oops&end_timestamp=1700003600", http.StatusBadRequest},
		{"reversed", "start_timestamp=1700003600&end_timestamp=1700000000", http.StatusBadRequest},
		{"over 30 days", "start_timestamp=1700000000&end_timestamp=1702592001", http.StatusBadRequest},
		{"future", "start_timestamp=4102444800&end_timestamp=4102448400", http.StatusBadRequest},
		{"overflow", "start_timestamp=-9223372036854775808&end_timestamp=9223372036854775807", http.StatusBadRequest},
		{"mixed days", "days=1&start_timestamp=1700000000&end_timestamp=1700003600", http.StatusBadRequest},
		{"mixed offset", "offset=0&start_timestamp=1700000000&end_timestamp=1700003600", http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/business?"+tc.query, nil))
			require.Equal(t, tc.status, recorder.Code)
			assert.Equal(t, "no-store", recorder.Header().Get("Cache-Control"))
			if tc.status == http.StatusOK {
				assert.Contains(t, recorder.Body.String(), `"start_timestamp":1700000000`)
			} else {
				assert.NotContains(t, recorder.Body.String(), `"new_users"`)
			}
		})
	}
}

func TestBusinessDashboardCacheFreshnessAndLogRecovery(t *testing.T) {
	businessDashboardCache.Purge()
	t.Cleanup(businessDashboardCache.Purge)
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.TopUp{}, &model.SubscriptionOrder{}, &model.SubscriptionPlan{}, &model.UserSubscription{}, &model.Option{}, &model.Log{}))
	engine := gin.New()
	engine.GET("/business", GetBusinessDashboard)
	request := func(query string) model.BusinessDashboard {
		t.Helper()
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/business?"+query, nil))
		require.Equal(t, http.StatusOK, recorder.Code)
		assert.Equal(t, "no-store", recorder.Header().Get("Cache-Control"))
		var body struct {
			Data model.BusinessDashboard `json:"data"`
		}
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &body))
		return body.Data
	}
	const period = "start_timestamp=1700000000&end_timestamp=1700003600"
	first := request(period)
	require.NotNil(t, first.Activity)
	assert.Zero(t, first.NewUsers)
	require.NoError(t, db.Create(&model.User{Username: "cache-new-user", AffCode: "cache-user", CreatedAt: 1700000001}).Error)
	assert.Zero(t, request(period).NewUsers, "repeat requests reuse the successful snapshot")
	assert.EqualValues(t, 1, request("start_timestamp=1700000001&end_timestamp=1700003600").NewUsers, "custom ranges must not share snapshots")
	for _, key := range businessDashboardCache.Keys() {
		entry, found, err := businessDashboardCache.Get(key)
		require.NoError(t, err)
		require.True(t, found)
		entry.ExpiresAt = time.Now().Add(-time.Second)
		businessDashboardCache.Set(key, entry)
	}
	assert.EqualValues(t, 1, request(period).NewUsers, "expired snapshots must be recomputed")
	businessDashboardCache.Purge()
	require.NoError(t, db.Migrator().DropTable(&model.Log{}))
	assert.Nil(t, request(period).Activity)
	require.NoError(t, db.AutoMigrate(&model.Log{}))
	require.NoError(t, db.Create(&model.Log{Type: model.LogTypeConsume, UserId: 1, CreatedAt: 1700000001}).Error)
	recovered := request(period)
	require.NotNil(t, recovered.Activity, "a transient log-store failure must not be cached")
	assert.EqualValues(t, 1, recovered.Activity.Users)
}
