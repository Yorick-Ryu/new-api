package perf_metrics_setting

import (
	"github.com/stretchr/testify/assert"
	"testing"
)

func TestBucketDurations(t *testing.T) {
	previous := perfMetricsSetting
	t.Cleanup(func() { perfMetricsSetting = previous })
	for _, tc := range []struct {
		name    string
		seconds int64
	}{{"minute", 60}, {"5min", 300}, {"30min", 1800}, {"invalid", 1800}} {
		perfMetricsSetting.BucketTime = tc.name
		assert.Equal(t, tc.seconds, GetBucketSeconds(), tc.name)
	}
}
