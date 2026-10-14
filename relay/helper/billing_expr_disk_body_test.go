package helper

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type billingDiskReadCounter struct {
	common.BodyStorage
	reads       int
	loadedBytes int
}

func (storage *billingDiskReadCounter) Bytes() ([]byte, error) {
	storage.reads++
	body, err := storage.BodyStorage.Bytes()
	storage.loadedBytes += len(body)
	return body, err
}

func TestModelPriceHelperTieredLargeDiskBody(testContext *testing.T) {
	gin.SetMode(gin.TestMode)
	saved := map[string]string{}
	require.NoError(testContext, config.GlobalConfig.SaveToDB(func(key, value string) error {
		saved[key] = value
		return nil
	}))
	savedDiskConfig := common.GetDiskCacheConfig()
	testContext.Cleanup(func() {
		require.NoError(testContext, config.GlobalConfig.LoadFromDB(saved))
		common.SetDiskCacheConfig(savedDiskConfig)
	})
	require.NoError(testContext, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.billing_mode":                  `{"disk-token-only":"tiered_expr","disk-param":"tiered_expr"}`,
		"billing_setting.billing_expr":                  `{"disk-token-only":"tier(\"base\", p * 3)","disk-param":"param(\"service_tier\") == \"priority\" ? tier(\"priority\", p * 4) : tier(\"base\", p * 3)"}`,
		"operation_setting.input_preconsume_multiplier": "1",
		"group_ratio_setting.group_ratio":               `{"default":1}`,
		"group_ratio_setting.group_group_ratio":         `{}`,
	}))
	common.SetDiskCacheConfig(common.DiskCacheConfig{
		Enabled: true, ThresholdMB: 1, MaxSizeMB: 128, Path: testContext.TempDir(),
	})
	const bodySize = 24 << 20
	prefix := []byte(`{"service_tier":"priority","padding":"`)
	suffix := []byte(`"}`)
	fixture, err := os.CreateTemp(testContext.TempDir(), "billing-body-*.json")
	require.NoError(testContext, err)
	testContext.Cleanup(func() { require.NoError(testContext, fixture.Close()) })
	_, err = fixture.Write(prefix)
	require.NoError(testContext, err)
	chunk := bytes.Repeat([]byte("x"), 64<<10)
	for remaining := bodySize - len(prefix) - len(suffix); remaining > 0; {
		written, writeErr := fixture.Write(chunk[:min(remaining, len(chunk))])
		require.NoError(testContext, writeErr)
		remaining -= written
	}
	_, err = fixture.Write(suffix)
	require.NoError(testContext, err)
	for _, testCase := range []struct {
		model     string
		bodyReads int
		bodyBytes int
		quota     int
	}{
		{model: "disk-token-only", bodyReads: 0, bodyBytes: 0, quota: 1500},
		{model: "disk-param", bodyReads: 1, bodyBytes: bodySize, quota: 2000},
	} {
		testContext.Run(testCase.model, func(testContext *testing.T) {
			_, err := fixture.Seek(0, io.SeekStart)
			require.NoError(testContext, err)
			bodyStorage, err := common.CreateBodyStorageFromReader(fixture, bodySize, 32<<20)
			require.NoError(testContext, err)
			testContext.Cleanup(func() { require.NoError(testContext, bodyStorage.Close()) })
			require.True(testContext, bodyStorage.IsDisk())
			storage := &billingDiskReadCounter{BodyStorage: bodyStorage}
			requestContext, _ := gin.CreateTestContext(httptest.NewRecorder())
			requestContext.Request = httptest.NewRequestWithContext(testContext.Context(), http.MethodPost, "/v1/responses", nil)
			requestContext.Request.Header.Set("Content-Type", "application/json")
			requestContext.Set(common.KeyBodyStorage, storage)
			requestContext.Set("group", "default")
			info := &relaycommon.RelayInfo{
				OriginModelName: testCase.model, UserGroup: "default", UsingGroup: "default",
				RequestHeaders: map[string]string{"Content-Type": "application/json"},
			}
			runtime.GC()
			var before, after runtime.MemStats
			runtime.ReadMemStats(&before)
			started := time.Now()
			price, err := ModelPriceHelper(requestContext, info, 1000, &types.TokenCountMeta{})
			elapsed := time.Since(started)
			runtime.ReadMemStats(&after)
			require.NoError(testContext, err)
			require.NotNil(testContext, info.BillingRequestInput)
			assert.Equal(testContext, testCase.bodyReads, storage.reads)
			assert.Equal(testContext, testCase.bodyBytes, storage.loadedBytes)
			assert.Len(testContext, info.BillingRequestInput.Body, testCase.bodyBytes)
			assert.Equal(testContext, testCase.quota, price.QuotaToPreConsume)
			assert.Equal(testContext, "application/json", info.BillingRequestInput.Headers["Content-Type"])
			testContext.Logf("model=%s fixture_bytes=%d disk_reads=%d loaded_bytes=%d retained_bytes=%d allocated_bytes=%d elapsed_us=%d quota=%d", testCase.model, bodySize, storage.reads, storage.loadedBytes, len(info.BillingRequestInput.Body), after.TotalAlloc-before.TotalAlloc, elapsed.Microseconds(), price.QuotaToPreConsume)
		})
	}
}
