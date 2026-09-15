package controller

import (
	"fmt"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/auto_ban"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAutoBanEndpointsEnforceAdministratorPermission(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.AutoBanEvent{}, &model.Token{}))
	router := gin.New()
	group := router.Group("/api/auto-ban", middleware.AdminAuth())
	group.GET("/", GetAutoBanSettings)
	group.PUT("/", UpdateAutoBanSettings)
	group.POST("/test", TestAutoBanRules)
	group.GET("/events", GetAutoBanEvents)
	payload, err := common.Marshal(auto_ban.Defaults())
	require.NoError(t, err)
	for _, role := range []int{common.RoleCommonUser, common.RoleAdminUser, common.RoleRootUser} {
		key := fmt.Sprintf("auto-ban-test-pat-%d", role)
		user := model.User{Username: fmt.Sprintf("auto-ban-role-%d", role), AffCode: fmt.Sprintf("abr%d", role), Role: role, Status: common.UserStatusEnabled, AuthVersion: 1}
		user.SetAccessToken(key)
		require.NoError(t, db.Create(&user).Error)
		for _, route := range []struct{ method, path, body string }{{"GET", "/api/auto-ban/", ""}, {"GET", "/api/auto-ban/events", ""}, {"PUT", "/api/auto-ban/", string(payload)}, {"POST", "/api/auto-ban/test", `{"settings":{"version":"default","mode":"off","rules":[]},"http_status":400,"body":"ordinary error"}`}} {
			req := httptest.NewRequest(route.method, route.path, strings.NewReader(route.body))
			req.Header.Set("Authorization", "Bearer "+key)
			req.Header.Set("New-Api-User", fmt.Sprint(user.Id))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			if role == common.RoleCommonUser {
				assert.Equal(t, http.StatusForbidden, rec.Code, route.path)
			} else if route.method == "PUT" && role == common.RoleRootUser {
				assert.Equal(t, http.StatusConflict, rec.Code)
			} else {
				assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
			}
		}
	}
	req := httptest.NewRequest("GET", "/api/auto-ban/", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestAutoBanAllUserKeysDeniedAndManualEnableRestoresAccess(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Token{}, &model.AutoBanEvent{}))
	t.Setenv("LOG_SQL_DSN", "")
	require.NoError(t, model.InitLogDB())
	user := model.User{Username: "auto-ban-key-owner", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1, Quota: 1000}
	require.NoError(t, db.Create(&user).Error)
	router := gin.New()
	router.GET("/relay", middleware.TokenAuth(), func(c *gin.Context) { c.Status(http.StatusOK) })
	keys := []string{"autobantestkeyone", "autobantestkeytwo"}
	for _, key := range keys {
		require.NoError(t, db.Create(&model.Token{UserId: user.Id, Key: key, Status: common.TokenStatusEnabled, ExpiredTime: -1, UnlimitedQuota: true, CreatedTime: time.Now().Unix()}).Error)
	}
	request := func(key string) int {
		r := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/relay", nil)
		req.Header.Set("Authorization", "Bearer sk-"+key)
		router.ServeHTTP(r, req)
		return r.Code
	}
	for _, key := range keys {
		assert.Equal(t, http.StatusOK, request(key))
	}
	event := model.AutoBanEvent{EventKey: "ban-all-keys", UserID: user.Id, Mode: "ban"}
	require.NoError(t, model.ApplyAutoBanEvent(&event))
	for _, key := range keys {
		assert.Equal(t, http.StatusForbidden, request(key))
	}
	events, err := model.ListAutoBanEvents(0, 30)
	require.NoError(t, err)
	require.Len(t, events, 1)
	require.NotNil(t, events[0].UserStatus)
	assert.Equal(t, common.UserStatusDisabled, *events[0].UserStatus)

	recorder := performManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"enable"}`, user.Id))
	require.Equal(t, http.StatusOK, recorder.Code)
	require.Contains(t, recorder.Body.String(), `"success":true`)
	for _, key := range keys {
		assert.Equal(t, http.StatusOK, request(key))
	}
	events, err = model.ListAutoBanEvents(0, 30)
	require.NoError(t, err)
	require.Len(t, events, 1)
	require.NotNil(t, events[0].UserStatus)
	assert.Equal(t, common.UserStatusEnabled, *events[0].UserStatus)
	assert.Equal(t, "banned", events[0].Action, "enabling the account preserves the historical ban")
}

func TestAutoBanRecordsPreserveHistoryForDeletedAccounts(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.AutoBanEvent{}))
	user := model.User{Username: "deleted-ban-owner", Role: common.RoleCommonUser, Status: common.UserStatusDisabled}
	require.NoError(t, db.Create(&user).Error)
	require.NoError(t, db.Create(&model.AutoBanEvent{EventKey: "deleted-owner-event", UserID: user.Id, Action: "banned"}).Error)
	require.NoError(t, db.Delete(&user).Error)

	events, err := model.ListAutoBanEvents(0, 30)
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, user.Id, events[0].UserID)
	assert.Equal(t, "banned", events[0].Action)
	assert.Nil(t, events[0].UserStatus, "deleted accounts cannot be enabled from a historical record")
}

func TestAutoBanPreviewReportsEachRulesOwnConditionsWithoutMutation(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Option{}, &model.AutoBanEvent{}))
	settings := auto_ban.Defaults()
	settings.Mode = "ban"
	saved, err := model.SaveAutoBanSettings(settings)
	require.NoError(t, err)
	draft := saved
	draft.Rules = []auto_ban.Rule{
		{ID: "a", Name: "Rule A", Reason: "First reason", Enabled: true, MatchGroups: []auto_ban.MatchGroup{
			{ID: "message", Conditions: []auto_ban.Condition{{Field: "message", Operator: "contains", Value: "other failure"}}},
			{ID: "code", Conditions: []auto_ban.Condition{{Field: "code", Operator: "equals", Value: "custom_policy"}}},
		}},
		{ID: "b", Name: "Rule B", Reason: "Second reason", Enabled: true, MatchGroups: []auto_ban.MatchGroup{{ID: "code", Conditions: []auto_ban.Condition{{Field: "code", Operator: "equals", Value: "different_policy"}}}}},
	}
	payload, err := common.Marshal(map[string]interface{}{"settings": draft, "http_status": 200, "body": `{"type":"error","error":{"code":"custom_policy"}}`})
	require.NoError(t, err)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/auto-ban/test", strings.NewReader(string(payload)))
	TestAutoBanRules(c)
	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool
		Data    struct {
			Rules []struct {
				Name    string
				Matched bool
				Groups  []struct {
					Matched    bool
					Conditions []bool
				}
			}
		}
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
	require.Len(t, response.Data.Rules, 2)
	assert.Equal(t, "Rule A", response.Data.Rules[0].Name)
	assert.True(t, response.Data.Rules[0].Matched)
	assert.False(t, response.Data.Rules[1].Matched)
	require.Len(t, response.Data.Rules[0].Groups, 2)
	assert.Equal(t, []bool{false}, response.Data.Rules[0].Groups[0].Conditions)
	assert.Equal(t, []bool{true}, response.Data.Rules[0].Groups[1].Conditions)
	live, err := model.GetAutoBanSettings()
	require.NoError(t, err)
	assert.Equal(t, saved, live)
	var count int64
	require.NoError(t, db.Model(&model.AutoBanEvent{}).Count(&count).Error)
	assert.Zero(t, count)
}
