package model

import (
	"context"
	"strconv"
)

// GetServiceStatusBuckets aggregates before loading rows so the status page does
// not fetch a week's worth of minute-resolution samples for every model.
// Integer modulo works on all three supported databases.
func GetServiceStatusBuckets(ctx context.Context, startTs, endTs, bucketSeconds int64) ([]PerfMetric, error) {
	bucketExpr := "bucket_ts - (bucket_ts % " + strconv.FormatInt(bucketSeconds, 10) + ")"
	var rows []PerfMetric
	err := DB.WithContext(ctx).Model(&PerfMetric{}).
		Select("model_name, "+commonGroupCol+", "+bucketExpr+" AS bucket_ts, "+
			"SUM(request_count) AS request_count, SUM(success_count) AS success_count, "+
			"SUM(total_latency_ms) AS total_latency_ms, SUM(ttft_sum_ms) AS ttft_sum_ms, "+
			"SUM(ttft_count) AS ttft_count, SUM(input_tokens) AS input_tokens, SUM(cache_read_tokens) AS cache_read_tokens, "+
			"SUM(output_tokens) AS output_tokens, SUM(generation_ms) AS generation_ms").
		Where("bucket_ts >= ? AND bucket_ts <= ?", startTs, endTs).
		Group("model_name, " + commonGroupCol + ", " + bucketExpr).
		Having("SUM(request_count) > 0").
		Order("bucket_ts ASC").Find(&rows).Error
	return rows, err
}

// Only names are needed by the administrator's display editor.
func GetServiceStatusModelPairs(ctx context.Context, startTs int64) ([]PerfMetric, error) {
	var pairs []PerfMetric
	err := DB.WithContext(ctx).Model(&PerfMetric{}).Distinct("model_name", commonGroupCol).
		Where("bucket_ts >= ?", startTs).Find(&pairs).Error
	return pairs, err
}
