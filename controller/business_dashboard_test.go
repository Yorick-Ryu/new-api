package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBusinessDashboardRequiresAdminAndValidPeriod(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.TopUp{}, &model.SubscriptionOrder{}, &model.SubscriptionPlan{}, &model.UserSubscription{}, &model.Option{}))
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
