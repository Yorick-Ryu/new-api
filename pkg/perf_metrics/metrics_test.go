package perfmetrics

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAtomicBucketTracksCacheReadTokens(t *testing.T) {
	bucket := &atomicBucket{}
	bucket.add(Sample{InputTokens: 100, CacheReadTokens: 25})
	bucket.add(Sample{InputTokens: 10, CacheReadTokens: 20})
	bucket.add(Sample{CacheReadTokens: 50})

	snapshot := bucket.snapshot()
	assert.Equal(t, int64(110), snapshot.inputTokens)
	assert.Equal(t, int64(35), snapshot.cacheReadTokens)
}

func TestCacheHitRate(t *testing.T) {
	t.Run("returns nil without input token data", func(t *testing.T) {
		assert.Nil(t, cacheHitRate(counters{cacheReadTokens: 10}))
	})

	t.Run("returns percentage rounded to two decimals", func(t *testing.T) {
		rate := cacheHitRate(counters{inputTokens: 300, cacheReadTokens: 100})
		require.NotNil(t, rate)
		assert.Equal(t, 33.33, *rate)
	})
}
