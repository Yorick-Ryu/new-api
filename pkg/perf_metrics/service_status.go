package perfmetrics

import (
	"context"
	"sort"
	"time"

	"github.com/QuantumNous/new-api/model"
)

// Counts remain internal, consistent with the existing public metrics API.
// Null distinguishes a missing measurement from a measured zero.
type StatusMetrics struct {
	CacheHitRate *float64 `json:"cache_hit_rate"`
	SuccessRate  *float64 `json:"success_rate"`
	AvgTtftMs    *float64 `json:"avg_ttft_ms"`
	AvgLatencyMs *float64 `json:"avg_latency_ms"`
	AvgTps       *float64 `json:"avg_tps"`
}

type StatusPoint struct {
	Ts int64 `json:"ts"`
	StatusMetrics
}

type StatusModel struct {
	ModelName    string        `json:"model_name"`
	Icon         string        `json:"icon,omitempty"`
	IsImageModel bool          `json:"is_image_model,omitempty"`
	Series       []StatusPoint `json:"series"`
	StatusMetrics
}

type StatusGroup struct {
	Group       string        `json:"group"`
	Description string        `json:"description,omitempty"`
	Models      []StatusModel `json:"models"`
}

type StatusResult struct {
	StartTs       int64         `json:"start_ts"`
	EndTs         int64         `json:"end_ts"`
	BucketSeconds int64         `json:"bucket_seconds"`
	Groups        []StatusGroup `json:"groups"`
}

func QueryServiceStatus(ctx context.Context, hours int) (StatusResult, error) {
	return queryServiceStatusAt(ctx, hours, time.Now().Unix())
}

func queryServiceStatusAt(ctx context.Context, hours int, endTs int64) (StatusResult, error) {
	if hours != 24 && hours != 72 && hours != 168 {
		hours = 24
	}
	step := int64(1800)
	if hours == 72 {
		step = 3600
	} else if hours == 168 {
		step = 7200
	}
	// Include the current, possibly incomplete interval and exactly N-1 older
	// intervals. Aligning both ends inclusively previously added an extra bar.
	count := int64(hours) * 3600 / step
	startTs := endTs - endTs%step - (count-1)*step
	result := StatusResult{StartTs: startTs, EndTs: endTs, BucketSeconds: step, Groups: []StatusGroup{}}
	rows, err := model.GetServiceStatusBuckets(ctx, startTs, endTs, step)
	if err != nil {
		return result, err
	}
	merged := make(map[bucketKey]counters, len(rows))
	for _, row := range rows {
		mergeCounters(merged, bucketKey{model: row.ModelName, group: row.Group, bucketTs: row.BucketTs}, counters{
			requestCount: row.RequestCount, successCount: row.SuccessCount,
			totalLatencyMs: row.TotalLatencyMs, ttftSumMs: row.TtftSumMs, ttftCount: row.TtftCount,
			inputTokens: row.InputTokens, cacheReadTokens: row.CacheReadTokens,
			outputTokens: row.OutputTokens, generationMs: row.GenerationMs,
		})
	}
	hotBuckets.Range(func(key, value any) bool {
		k := key.(bucketKey)
		if k.bucketTs < startTs || k.bucketTs > endTs {
			return true
		}
		k.bucketTs -= k.bucketTs % step
		mergeCounters(merged, k, value.(*atomicBucket).snapshot())
		return true
	})

	groupModels := map[string]map[string]map[int64]StatusPoint{}
	totals := map[bucketKey]counters{}
	for key, value := range merged {
		if value.requestCount == 0 {
			continue
		}
		if groupModels[key.group] == nil {
			groupModels[key.group] = map[string]map[int64]StatusPoint{}
		}
		if groupModels[key.group][key.model] == nil {
			groupModels[key.group][key.model] = map[int64]StatusPoint{}
		}
		points := groupModels[key.group][key.model]
		points[key.bucketTs] = StatusPoint{Ts: key.bucketTs, StatusMetrics: statusMetrics(value)}

		mergeCounters(totals, bucketKey{model: key.model, group: key.group}, value)
	}
	for group, models := range groupModels {
		entry := StatusGroup{Group: group, Models: make([]StatusModel, 0, len(models))}
		for name, points := range models {
			series := make([]StatusPoint, 0, len(points))
			for _, point := range points {
				series = append(series, point)
			}
			sort.Slice(series, func(i, j int) bool { return series[i].Ts < series[j].Ts })
			entry.Models = append(entry.Models, StatusModel{
				ModelName: name, Series: series,
				StatusMetrics: statusMetrics(totals[bucketKey{model: name, group: group}]),
			})
		}
		sort.Slice(entry.Models, func(i, j int) bool { return entry.Models[i].ModelName < entry.Models[j].ModelName })
		result.Groups = append(result.Groups, entry)
	}
	sort.Slice(result.Groups, func(i, j int) bool { return result.Groups[i].Group < result.Groups[j].Group })
	return result, nil
}

func statusMetrics(value counters) StatusMetrics {
	result := StatusMetrics{CacheHitRate: cacheHitRate(value)}
	if value.requestCount > 0 {
		rate := 100 * float64(value.successCount) / float64(value.requestCount)
		latency := float64(value.totalLatencyMs) / float64(value.requestCount)
		result.SuccessRate, result.AvgLatencyMs = &rate, &latency
	}
	if value.ttftCount > 0 {
		ttft := float64(value.ttftSumMs) / float64(value.ttftCount)
		result.AvgTtftMs = &ttft
	}
	if value.generationMs > 0 {
		tps := float64(value.outputTokens) * 1000 / float64(value.generationMs)
		result.AvgTps = &tps
	}
	return result
}
