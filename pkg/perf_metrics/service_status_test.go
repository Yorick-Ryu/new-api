package perfmetrics

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStatusMetricsDistinguishesMissingSamplesFromMeasuredZeros(t *testing.T) {
	empty := statusMetrics(counters{})
	assert.Nil(t, empty.CacheHitRate)
	assert.Nil(t, empty.SuccessRate)
	assert.Nil(t, empty.AvgTtftMs)
	assert.Nil(t, empty.AvgLatencyMs)
	assert.Nil(t, empty.AvgTps)

	failed := statusMetrics(counters{requestCount: 1, ttftCount: 1})
	require.NotNil(t, failed.SuccessRate)
	require.NotNil(t, failed.AvgTtftMs)
	assert.Zero(t, *failed.SuccessRate)
	assert.Zero(t, *failed.AvgTtftMs)
	assert.Nil(t, failed.AvgTps)
}

func TestStatusMetricsCacheRateUsesInputTokens(t *testing.T) {
	for _, tc := range []struct {
		name          string
		input, cached int64
		want          float64
	}{
		{"no cache hits", 100, 0, 0},
		{"partial cache hits", 300, 100, 33.33},
		{"all input cached", 100, 100, 100},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := statusMetrics(counters{inputTokens: tc.input, cacheReadTokens: tc.cached})
			require.NotNil(t, got.CacheHitRate)
			assert.InDelta(t, tc.want, *got.CacheHitRate, 0.001)
		})
	}
}
