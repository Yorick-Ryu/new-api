package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCodexSetupCatalogRequiresConfigurationWithinPermittedGroup(t *testing.T) {
	withSelfUseModeEnabled(t)
	db := setupModelListControllerTestDB(t)
	groups := setting.UserUsableGroups2JSONString()
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default","antigravity":"Custom"}`))
	t.Cleanup(func() { require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(groups)) })
	common.OptionMapRWMutex.Lock()
	options := common.OptionMap
	common.OptionMap = map[string]string{
		service.CodexModelProfilesOptionKey:         `{"gemini-configured":{"priority":1000,"context_window":200000},"private-configured":{"priority":1001}}`,
		service.CodexOfficialModelProfilesOptionKey: `{"revision":"fixture","profiles":{"official-custom":{"priority":20}}}`,
	}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = options
		common.OptionMapRWMutex.Unlock()
		model.InvalidatePricingCache()
	})
	model.InvalidatePricingCache()
	require.NoError(t, db.Create(&model.User{Id: 1407, Username: "configured-codex-user", Group: "default", Status: common.UserStatusEnabled}).Error)
	require.NoError(t, db.Create(&[]model.Channel{
		{Id: 1, Type: constant.ChannelTypeGemini, Status: common.ChannelStatusEnabled},
		{Id: 2, Type: constant.ChannelTypeNewAPI, Status: common.ChannelStatusEnabled},
	}).Error)
	require.NoError(t, db.Create(&[]model.Ability{
		{Group: "default", Model: "gpt-6-astra", ChannelId: 2, Enabled: true},
		{Group: "antigravity", Model: "gemini-configured", ChannelId: 1, Enabled: true},
		{Group: "antigravity", Model: "gemini-unconfigured", ChannelId: 1, Enabled: true},
		{Group: "antigravity", Model: "responses-unconfigured", ChannelId: 2, Enabled: true},
		{Group: "antigravity", Model: "official-custom", ChannelId: 1, Enabled: true},
		{Group: "private", Model: "private-configured", ChannelId: 2, Enabled: true},
	}).Error)
	for _, tc := range []struct {
		group string
		want  []string
	}{
		{"default", []string{"gpt-6-astra"}},
		{"antigravity", []string{"official-custom", "gemini-configured"}},
		{"private", []string{}},
	} {
		t.Run(tc.group, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Request = httptest.NewRequest(http.MethodGet, "/api/user/models?client_version=codexbei&purpose=desktop_setup&group="+tc.group, nil)
			ctx.Set("id", 1407)
			GetUserModels(ctx)
			require.Equal(t, http.StatusOK, recorder.Code)
			var catalog struct {
				Models []struct {
					Slug string `json:"slug"`
				} `json:"models"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &catalog))
			got := make([]string, 0, len(catalog.Models))
			for _, entry := range catalog.Models {
				got = append(got, entry.Slug)
			}
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestCodexProfileDefaultsGroupsOnlyEnabledRoutes(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	groups := ratio_setting.GroupRatio2JSONString()
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"empty":1}`))
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(groups)) })
	common.OptionMapRWMutex.Lock()
	snapshot, hadSnapshot := common.OptionMap[service.CodexOfficialModelProfilesOptionKey]
	delete(common.OptionMap, service.CodexOfficialModelProfilesOptionKey)
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		defer common.OptionMapRWMutex.Unlock()
		if hadSnapshot {
			common.OptionMap[service.CodexOfficialModelProfilesOptionKey] = snapshot
		}
	})
	require.NoError(t, db.Create(&[]model.Channel{
		{Id: 1, Status: common.ChannelStatusEnabled, Models: "gemini-flash,gpt-official"},
		{Id: 2, Status: common.ChannelStatusEnabled, Models: "gemini-flash,disabled-ability"},
		{Id: 3, Status: common.ChannelStatusManuallyDisabled, Models: "disabled-channel"},
	}).Error)
	require.NoError(t, db.Create(&[]model.Ability{
		{Group: "antigravity", Model: "gemini-flash", ChannelId: 1, Enabled: true},
		{Group: "antigravity", Model: "gemini-flash", ChannelId: 2, Enabled: true},
		{Group: "default", Model: "gpt-official", ChannelId: 1, Enabled: true},
		{Group: "antigravity", Model: "disabled-ability", ChannelId: 2, Enabled: false},
		{Group: "antigravity", Model: "disabled-channel", ChannelId: 3, Enabled: true},
	}).Error)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/option/codex_model_profiles", nil)
	GetCodexModelProfileDefaults(ctx)
	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Groups   map[string][]string        `json:"group_models"`
			Models   []string                   `json:"models"`
			Profiles service.CodexModelProfiles `json:"profiles"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, recorder.Body.String())
	assert.Equal(t, map[string][]string{"antigravity": {"gemini-flash"}, "default": {"gpt-official"}, "empty": {}}, response.Data.Groups)
	assert.Contains(t, response.Data.Models, "gemini-flash")
	assert.Contains(t, response.Data.Models, "disabled-channel")
	assert.NotEmpty(t, response.Data.Profiles)
}

func TestCodexModelsUsesFilteredAvailabilityAndConditionalResponses(t *testing.T) {
	withSelfUseModeEnabled(t)
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.Create(&[]model.Ability{
		{Group: "default", Model: "gpt-6-astra", ChannelId: 1, Enabled: true},
		{Group: "default", Model: "gpt-5.6-sol", ChannelId: 1, Enabled: true},
		{Group: "default", Model: "gpt-5.6-luna", ChannelId: 1, Enabled: false},
		{Group: "other", Model: "gpt-5.6-terra", ChannelId: 2, Enabled: true},
	}).Error)

	request := func(path, group, etag string, limited bool) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodGet, path, nil)
		ctx.Request.Header.Set("If-None-Match", etag)
		common.SetContextKey(ctx, constant.ContextKeyUserGroup, "default")
		common.SetContextKey(ctx, constant.ContextKeyTokenGroup, group)
		common.SetContextKey(ctx, constant.ContextKeyTokenModelLimitEnabled, limited)
		common.SetContextKey(ctx, constant.ContextKeyTokenModelLimit, map[string]bool{"gpt-6-astra": true})
		ListModels(ctx, constant.ChannelTypeOpenAI)
		ctx.Writer.WriteHeaderNow()
		return recorder
	}
	first := request("/v1/models?client_version=0.153.2", "default", "", true)
	require.Equal(t, http.StatusOK, first.Code)
	var catalog struct {
		Models []struct {
			Slug string `json:"slug"`
		} `json:"models"`
	}
	require.NoError(t, common.Unmarshal(first.Body.Bytes(), &catalog))
	require.Len(t, catalog.Models, 1)
	assert.Equal(t, "gpt-6-astra", catalog.Models[0].Slug)
	etag := first.Header().Get("ETag")
	require.NotEmpty(t, etag)
	assert.Equal(t, "private, no-cache", first.Header().Get("Cache-Control"))
	unchanged := request("/v1/models?client_version=0.153.2", "default", `"different", W/`+etag, true)
	assert.Equal(t, http.StatusNotModified, unchanged.Code)
	assert.Empty(t, unchanged.Body.String())

	other := request("/v1/models?client_version=0.153.2", "other", etag, true)
	require.Equal(t, http.StatusOK, other.Code)
	assert.JSONEq(t, `{"models":[]}`, other.Body.String())
	assert.NotEqual(t, etag, other.Header().Get("ETag"))

	plain := request("/v1/models", "default", "", false)
	ids := decodeListModelsResponse(t, plain)
	assert.Len(t, ids, 2)
	assert.Contains(t, ids, "gpt-6-astra")
	assert.Contains(t, ids, "gpt-5.6-sol")
	assert.Empty(t, plain.Header().Get("ETag"))

	unlimited := request("/v1/models?client_version=0.153.2", "default", "", false)
	require.NoError(t, common.Unmarshal(unlimited.Body.Bytes(), &catalog))
	assert.Len(t, catalog.Models, 2)
	// A channel/ability change must be reflected without replacing any catalog.
	require.NoError(t, db.Model(&model.Ability{}).Where("model = ?", "gpt-6-astra").Update("enabled", false).Error)
	disabled := request("/v1/models?client_version=0.153.2", "default", etag, true)
	require.Equal(t, http.StatusOK, disabled.Code)
	assert.JSONEq(t, `{"models":[]}`, disabled.Body.String())
}

func TestCodexModelsDiscoversNewResponsesRouteWithColdPricingCache(t *testing.T) {
	withSelfUseModeEnabled(t)
	db := setupModelListControllerTestDB(t)
	model.InvalidatePricingCache()
	t.Cleanup(model.InvalidatePricingCache)
	require.NoError(t, db.Create(&model.Channel{
		Id: 901, Type: constant.ChannelTypeNewAPI, Status: common.ChannelStatusEnabled,
		Name: "catalog-responses-route", Group: "default", Models: "custom-responses-route",
	}).Error)
	require.NoError(t, db.Create(&model.Ability{
		Group: "default", Model: "custom-responses-route", ChannelId: 901, Enabled: true,
	}).Error)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/v1/models?client_version=0.153.2", nil)
	common.SetContextKey(ctx, constant.ContextKeyUserGroup, "default")
	ListModels(ctx, constant.ChannelTypeOpenAI)
	require.Equal(t, http.StatusOK, recorder.Code)
	var catalog struct {
		Models []struct {
			Slug string `json:"slug"`
		} `json:"models"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &catalog))
	require.Len(t, catalog.Models, 1)
	assert.Equal(t, "custom-responses-route", catalog.Models[0].Slug)
}

func TestDashboardCodexCatalogMatchesTokenCatalogOrderAndFiltering(t *testing.T) {
	withSelfUseModeEnabled(t)
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.Create(&model.User{Id: 1107, Username: "codexbei-catalog-user", Group: "default", Status: common.UserStatusEnabled}).Error)
	require.NoError(t, db.Create(&[]model.Ability{
		{Group: "default", Model: "gpt-5.6-sol", ChannelId: 1, Enabled: true},
		{Group: "default", Model: "gpt-6-astra", ChannelId: 1, Enabled: true},
		{Group: "default", Model: "gpt-5.6-terra", ChannelId: 1, Enabled: true},
		{Group: "default", Model: "gpt-image-2", ChannelId: 1, Enabled: true},
		{Group: "default", Model: "gpt-5.5-openai-compact", ChannelId: 1, Enabled: true},
		{Group: "default", Model: "gpt-5.6-luna", ChannelId: 1, Enabled: false},
		{Group: "unavailable", Model: "gpt-5.5", ChannelId: 2, Enabled: true},
	}).Error)
	tokenResponse := httptest.NewRecorder()
	tokenContext, _ := gin.CreateTestContext(tokenResponse)
	tokenContext.Request = httptest.NewRequest(http.MethodGet, "/v1/models?client_version=codexbei", nil)
	tokenContext.Set("id", 1107)
	common.SetContextKey(tokenContext, constant.ContextKeyUserGroup, "default")
	common.SetContextKey(tokenContext, constant.ContextKeyTokenGroup, "default")
	ListModels(tokenContext, constant.ChannelTypeOpenAI)
	require.Equal(t, http.StatusOK, tokenResponse.Code)

	dashboardResponse := httptest.NewRecorder()
	dashboardContext, _ := gin.CreateTestContext(dashboardResponse)
	dashboardContext.Request = httptest.NewRequest(http.MethodGet, "/api/user/models?group=default&client_version=codexbei", nil)
	dashboardContext.Set("id", 1107)
	GetUserModels(dashboardContext)
	require.Equal(t, http.StatusOK, dashboardResponse.Code)
	assert.Equal(t, tokenResponse.Body.String(), dashboardResponse.Body.String())
	var catalog struct {
		Models []struct {
			Slug string `json:"slug"`
		} `json:"models"`
	}
	require.NoError(t, common.Unmarshal(dashboardResponse.Body.Bytes(), &catalog))
	require.Len(t, catalog.Models, 3)
	assert.Equal(t, "gpt-6-astra", catalog.Models[0].Slug)

	forbiddenResponse := httptest.NewRecorder()
	forbiddenContext, _ := gin.CreateTestContext(forbiddenResponse)
	forbiddenContext.Request = httptest.NewRequest(http.MethodGet, "/api/user/models?group=unavailable&client_version=codexbei", nil)
	forbiddenContext.Set("id", 1107)
	GetUserModels(forbiddenContext)
	assert.JSONEq(t, `{"models":[]}`, forbiddenResponse.Body.String())
}
