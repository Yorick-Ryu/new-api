package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestServiceStatusSettingsHideAndOrderWithoutChangingPermissionsOrCache(t *testing.T) {
	input := perfmetrics.StatusResult{Groups: []perfmetrics.StatusGroup{
		{Group: "default", Models: []perfmetrics.StatusModel{{ModelName: "gpt-6"}, {ModelName: "gpt-5"}, {ModelName: "new-model"}}},
		{Group: "premium", Models: []perfmetrics.StatusModel{{ModelName: "gpt-6"}, {ModelName: "gpt-5"}}},
		{Group: "hidden", Models: []perfmetrics.StatusModel{{ModelName: "secret"}}},
	}}
	settings := model.ServiceStatusSettings{Groups: []model.ServiceStatusGroupSetting{
		{Group: "unauthorized", Models: []model.ServiceStatusModelSetting{{Model: "private"}}},
		{Group: "premium", Models: []model.ServiceStatusModelSetting{{Model: "gpt-5"}, {Model: "gpt-6"}}},
		{Group: "default", Models: []model.ServiceStatusModelSetting{{Model: "gpt-6", Hidden: true}, {Model: "gpt-5"}}},
		{Group: "hidden", Hidden: true},
	}}
	result := applyServiceStatusSettings(input, settings)
	require.Len(t, result.Groups, 2)
	assert.Equal(t, "premium", result.Groups[0].Group)
	assert.Equal(t, "gpt-5", result.Groups[0].Models[0].ModelName)
	assert.Equal(t, "gpt-6", result.Groups[0].Models[1].ModelName)
	assert.Equal(t, "default", result.Groups[1].Group)
	assert.Equal(t, "new-model", result.Groups[1].Models[1].ModelName)
	assert.Len(t, input.Groups, 3)
	assert.Len(t, input.Groups[0].Models, 3)
	assert.Equal(t, "gpt-6", input.Groups[1].Models[0].ModelName)
}

func TestServiceStatusSettingsRemoveGroupsWhenAllModelsHidden(t *testing.T) {
	input := perfmetrics.StatusResult{Groups: []perfmetrics.StatusGroup{{Group: "default", Models: []perfmetrics.StatusModel{{ModelName: "only"}}}}}
	result := applyServiceStatusSettings(input, model.ServiceStatusSettings{Groups: []model.ServiceStatusGroupSetting{{Group: "default", Models: []model.ServiceStatusModelSetting{{Model: "only", Hidden: true}}}}})
	assert.Empty(t, result.Groups)
	assert.NotNil(t, result.Groups)
}

func TestServiceStatusSettingsValidateAndPersistAtomically(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Option{}))
	common.OptionMapRWMutex.Lock()
	previous, existed := common.OptionMap[model.ServiceStatusSettingsOptionKey]
	wasNil := common.OptionMap == nil
	if wasNil {
		common.OptionMap = map[string]string{}
	}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		defer common.OptionMapRWMutex.Unlock()
		if existed {
			common.OptionMap[model.ServiceStatusSettingsOptionKey] = previous
		} else {
			delete(common.OptionMap, model.ServiceStatusSettingsOptionKey)
			if wasNil {
				common.OptionMap = nil
			}
		}
	})
	engine := gin.New()
	engine.PUT("/settings", UpdateServiceStatusSettings)
	valid := `{"groups":[{"group":"default","hidden":true,"models":[{"model":"gpt-6","hidden":false}]}]}`
	request := httptest.NewRequest(http.MethodPut, "/settings", strings.NewReader(valid))
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusOK, recorder.Code)
	assert.True(t, model.GetServiceStatusSettings().Groups[0].Hidden)
	for _, invalid := range []string{`null`, `{}`, `{"groups":null}`, `{"groups":[{"group":"x"},{"group":"x"}]}`, `{"groups":[{"group":"x","models":[{"model":"a"},{"model":"a"}]}]}`, `{"groups":[{"group":" x"}]}`} {
		recorder = httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodPut, "/settings", strings.NewReader(invalid)))
		assert.Equal(t, http.StatusBadRequest, recorder.Code, invalid)
		assert.True(t, model.GetServiceStatusSettings().Groups[0].Hidden)
	}
	var saved model.Option
	require.NoError(t, db.First(&saved, "key = ?", model.ServiceStatusSettingsOptionKey).Error)
	parsed, err := model.ParseServiceStatusSettings(saved.Value)
	require.NoError(t, err)
	assert.Equal(t, "default", parsed.Groups[0].Group)
}

func TestServiceStatusManagementRequiresAdministrator(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.PerfMetric{}))
	regularToken, adminToken := "status-test-user-pat", "status-test-admin-pat"
	users := []model.User{
		{Username: "status-viewer", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", AccessToken: &regularToken, AffCode: "status-viewer"},
		{Username: "status-admin", Role: common.RoleAdminUser, Status: common.UserStatusEnabled, Group: "default", AccessToken: &adminToken, AffCode: "status-admin"},
	}
	require.NoError(t, db.Create(&users).Error)
	engine := gin.New()
	engine.GET("/settings", middleware.AdminAuth(), GetServiceStatusSettings)
	engine.PUT("/settings", middleware.AdminAuth(), UpdateServiceStatusSettings)
	for _, method := range []string{http.MethodGet, http.MethodPut} {
		for _, tc := range []struct {
			token  string
			status int
		}{{"", http.StatusUnauthorized}, {regularToken, http.StatusForbidden}} {
			request := httptest.NewRequest(method, "/settings", strings.NewReader(`{"groups":[]}`))
			if tc.token != "" {
				request.Header.Set("Authorization", "Bearer "+tc.token)
			}
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			assert.Equal(t, tc.status, recorder.Code)
		}
	}
	request := httptest.NewRequest(http.MethodGet, "/settings", nil)
	request.Header.Set("Authorization", "Bearer "+adminToken)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), `"groups"`)
}
