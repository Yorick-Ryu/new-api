package controller

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestServiceStatusSeparatesGroupsAndWeightsActualRequests(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.PerfMetric{}))
	at := time.Now().Truncate(time.Hour).Add(-6 * time.Hour).Unix()
	rows := []model.PerfMetric{
		{ModelName: "alpha", Group: "default", BucketTs: at, RequestCount: 9, SuccessCount: 9, TotalLatencyMs: 9000, TtftSumMs: 900, TtftCount: 9, OutputTokens: 900, GenerationMs: 9000},
		{ModelName: "alpha", Group: "default", BucketTs: at + 3600, RequestCount: 1, TotalLatencyMs: 9000, OutputTokens: 100, GenerationMs: 1000},
		{ModelName: "alpha", Group: "premium", BucketTs: at, RequestCount: 3, SuccessCount: 1, TotalLatencyMs: 3000},
		{ModelName: "old", Group: "default", BucketTs: at - 8*24*3600, RequestCount: 1},
		{ModelName: "future", Group: "default", BucketTs: at + 8*24*3600, RequestCount: 1},
	}
	require.NoError(t, db.Create(&rows).Error)
	result, err := perfmetrics.QueryServiceStatus(context.Background(), 24)
	require.NoError(t, err)
	require.Len(t, result.Groups, 2)
	require.Len(t, result.Groups[0].Models, 1)
	item := result.Groups[0].Models[0]
	assert.Equal(t, "default", result.Groups[0].Group)
	assert.Equal(t, "alpha", item.ModelName)
	assert.InDelta(t, 90, *item.SuccessRate, 0.001)
	assert.InDelta(t, 1800, *item.AvgLatencyMs, 0.001)
	assert.InDelta(t, 100, *item.AvgTtftMs, 0.001)
	assert.InDelta(t, 100, *item.AvgTps, 0.001)
	require.Len(t, item.Series, 2)
	assert.Equal(t, at, item.Series[0].Ts)
	assert.Nil(t, item.Series[1].AvgTtftMs)
	assert.Equal(t, 0.0, *item.Series[1].SuccessRate)
	assert.InDelta(t, 100.0/3, *result.Groups[1].Models[0].SuccessRate, 0.001)
	encoded, err := common.Marshal(result)
	require.NoError(t, err)
	assert.NotContains(t, string(encoded), "request_count")
	assert.NotContains(t, string(encoded), "success_count")
	assert.NotContains(t, string(encoded), "channel")
}

func TestServiceStatusReturnsFixedIntervalCounts(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.PerfMetric{}))
	for _, tc := range []struct {
		hours   int
		seconds int64
		count   int64
	}{{24, 1800, 48}, {72, 3600, 72}, {168, 7200, 84}} {
		result, err := perfmetrics.QueryServiceStatus(context.Background(), tc.hours)
		require.NoError(t, err)
		assert.Equal(t, tc.seconds, result.BucketSeconds)
		assert.Equal(t, tc.count, (result.EndTs-result.StartTs)/result.BucketSeconds+1)
	}
}

func TestVisibleServiceStatusFiltersGroupsWithoutMutatingSharedData(t *testing.T) {
	input := perfmetrics.StatusResult{Groups: []perfmetrics.StatusGroup{
		{Group: "default", Models: []perfmetrics.StatusModel{{ModelName: "alpha"}, {ModelName: "unavailable-model"}}},
		{Group: "private", Models: []perfmetrics.StatusModel{{ModelName: "private-model"}}},
	}}
	pricing := []model.Pricing{
		{ModelName: "alpha", EnableGroup: []string{"default"}, VendorID: 1},
		{ModelName: "no-traffic", EnableGroup: []string{"default"}},
		{ModelName: "private-model", EnableGroup: []string{"private"}},
	}
	result := buildVisibleServiceStatus(input, map[string]string{"default": "  Default access  "}, pricing, []model.PricingVendor{{ID: 1, Icon: "OpenAI"}}, []string{"no-traffic"})
	require.Len(t, result.Groups, 1)
	assert.Equal(t, "Default access", result.Groups[0].Description)
	assert.Empty(t, input.Groups[0].Description)
	updated := buildVisibleServiceStatus(input, map[string]string{"default": "Updated access"}, pricing, nil, nil)
	assert.Equal(t, "Updated access", updated.Groups[0].Description)
	require.Len(t, result.Groups[0].Models, 3)
	items := result.Groups[0].Models
	assert.Equal(t, "no-traffic", items[0].ModelName)
	assert.Nil(t, items[0].SuccessRate)
	assert.Empty(t, items[0].Series)
	assert.Equal(t, "OpenAI", items[1].Icon)
	assert.Equal(t, "unavailable-model", items[2].ModelName)
	assert.Len(t, input.Groups, 2)
	assert.Empty(t, input.Groups[0].Models[0].Icon)
	assert.Len(t, input.Groups[0].Models, 2)
}

func TestVisibleServiceStatusWithNoAllowedGroupsReturnsEmptyArray(t *testing.T) {
	result := buildVisibleServiceStatus(perfmetrics.StatusResult{}, map[string]string{}, []model.Pricing{{ModelName: "alpha", EnableGroup: []string{"all"}}}, nil, nil)
	assert.NotNil(t, result.Groups)
	assert.Empty(t, result.Groups)
}

func TestServiceStatusIdentifiesImageModelsWithoutInferringFromTokenMetrics(t *testing.T) {
	input := perfmetrics.StatusResult{Groups: []perfmetrics.StatusGroup{{Group: "default", Models: []perfmetrics.StatusModel{
		{ModelName: "gpt-image-2", StatusMetrics: perfmetrics.StatusMetrics{AvgTps: common.GetPointer(21.2)}},
		{ModelName: "gpt-6-astra", StatusMetrics: perfmetrics.StatusMetrics{AvgTps: common.GetPointer(21.2)}},
	}}}}
	pricing := []model.Pricing{
		{ModelName: "gpt-image-2", EnableGroup: []string{"default"}, SupportedEndpointTypes: []constant.EndpointType{constant.EndpointTypeOpenAI, constant.EndpointTypeImageGeneration}},
		{ModelName: "art-model", EnableGroup: []string{"default"}, SupportedEndpointTypes: []constant.EndpointType{constant.EndpointTypeImageGeneration}},
	}
	result := buildVisibleServiceStatus(input, map[string]string{"default": ""}, pricing, nil, nil)
	require.Len(t, result.Groups, 1)
	require.Len(t, result.Groups[0].Models, 3)
	for _, item := range result.Groups[0].Models {
		assert.Equal(t, item.ModelName != "gpt-6-astra", item.IsImageModel, item.ModelName)
	}
	assert.False(t, input.Groups[0].Models[0].IsImageModel, "shared metrics must remain unchanged")
}

func TestServiceStatusOrdersNumericVersionsDescendingWithManualOrderFirst(t *testing.T) {
	names := []string{"gpt-5.9", "gpt-image-2", "claude-fable-5", "gpt-6-astra", "gpt-5.10", "gpt-5.6-sol", "claude-fable-5-1"}
	models := make([]perfmetrics.StatusModel, 0, len(names))
	for _, name := range names {
		models = append(models, perfmetrics.StatusModel{ModelName: name})
	}
	input := perfmetrics.StatusResult{Groups: []perfmetrics.StatusGroup{{Group: "default", Models: models}}}
	for _, tc := range []struct {
		name         string
		manual, want []string
	}{
		{"default", nil, []string{"claude-fable-5-1", "claude-fable-5", "gpt-6-astra", "gpt-5.10", "gpt-5.9", "gpt-5.6-sol", "gpt-image-2"}},
		{"manual", []string{"gpt-image-2", "gpt-5.6-sol"}, []string{"gpt-image-2", "gpt-5.6-sol", "claude-fable-5-1", "claude-fable-5", "gpt-6-astra", "gpt-5.10", "gpt-5.9"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := buildVisibleServiceStatus(input, map[string]string{"default": ""}, nil, nil, tc.manual)
			got := make([]string, 0, len(names))
			for _, item := range result.Groups[0].Models {
				got = append(got, item.ModelName)
			}
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestGetServiceStatusRejectsUnsupportedTimeRanges(t *testing.T) {
	for _, value := range []string{"0", "-24", "48", "invalid", "999999999999999999999"} {
		t.Run(value, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Request = httptest.NewRequest(http.MethodGet, "/api/service-status?hours="+value, nil)
			GetServiceStatus(ctx)
			assert.Equal(t, http.StatusBadRequest, recorder.Code)
		})
	}
}

func TestServiceStatusAggregatesHalfHoursByRequestWeight(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.PerfMetric{}))
	at := time.Now().Truncate(2 * time.Hour).Add(-6 * time.Hour).Unix()
	require.NoError(t, model.UpsertPerfMetric(&model.PerfMetric{ModelName: "alpha", Group: "default", BucketTs: at, RequestCount: 9, SuccessCount: 9}))
	require.NoError(t, model.UpsertPerfMetric(&model.PerfMetric{ModelName: "alpha", Group: "default", BucketTs: at + 1800, RequestCount: 1}))
	for _, tc := range []struct {
		hours  int
		points int
	}{{24, 2}, {72, 1}, {168, 1}} {
		result, err := perfmetrics.QueryServiceStatus(context.Background(), tc.hours)
		require.NoError(t, err)
		item := result.Groups[0].Models[0]
		require.Len(t, item.Series, tc.points)
		assert.InDelta(t, 90, *item.SuccessRate, 0.001)
		if tc.points == 1 {
			assert.InDelta(t, 90, *item.Series[0].SuccessRate, 0.001)
		} else {
			assert.Equal(t, 100.0, *item.Series[0].SuccessRate)
			assert.Equal(t, 0.0, *item.Series[1].SuccessRate)
		}
	}
}

func TestServiceStatusCacheRateWeightsTokensAcrossIntervalsAndSeparatesGroups(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.PerfMetric{}))
	at := time.Now().Truncate(2 * time.Hour).Add(-6 * time.Hour).Unix()
	rows := []model.PerfMetric{
		{ModelName: "alpha", Group: "default", BucketTs: at, RequestCount: 9, SuccessCount: 9, InputTokens: 100, CacheReadTokens: 100},
		{ModelName: "alpha", Group: "default", BucketTs: at + 1800, RequestCount: 1, SuccessCount: 1, InputTokens: 900, CacheReadTokens: 300},
		{ModelName: "alpha", Group: "premium", BucketTs: at, RequestCount: 1, SuccessCount: 1, InputTokens: 100},
		{ModelName: "no-usage", Group: "premium", BucketTs: at, RequestCount: 1, SuccessCount: 1},
	}
	require.NoError(t, db.Create(&rows).Error)
	for _, hours := range []int{24, 72, 168} {
		result, err := perfmetrics.QueryServiceStatus(context.Background(), hours)
		require.NoError(t, err)
		require.Len(t, result.Groups, 2)
		item := result.Groups[0].Models[0]
		require.NotNil(t, item.CacheHitRate)
		assert.InDelta(t, 40, *item.CacheHitRate, 0.001)
		require.NotNil(t, item.Series[0].CacheHitRate)
		if hours == 24 {
			require.Len(t, item.Series, 2)
			assert.InDelta(t, 100, *item.Series[0].CacheHitRate, 0.001)
			require.NotNil(t, item.Series[1].CacheHitRate)
			assert.InDelta(t, 33.33, *item.Series[1].CacheHitRate, 0.001)
		} else {
			require.Len(t, item.Series, 1)
			assert.InDelta(t, 40, *item.Series[0].CacheHitRate, 0.001)
		}
		premium := result.Groups[1].Models
		require.Len(t, premium, 2)
		require.NotNil(t, premium[0].CacheHitRate)
		assert.Zero(t, *premium[0].CacheHitRate)
		assert.Nil(t, premium[1].CacheHitRate)
		encoded, err := common.Marshal(result)
		require.NoError(t, err)
		assert.Contains(t, string(encoded), `"cache_hit_rate":40`)
		assert.Contains(t, string(encoded), `"cache_hit_rate":null`)
		assert.NotContains(t, string(encoded), `"input_tokens"`)
		assert.NotContains(t, string(encoded), `"cache_read_tokens"`)
	}
}
