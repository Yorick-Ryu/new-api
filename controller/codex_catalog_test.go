package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

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
