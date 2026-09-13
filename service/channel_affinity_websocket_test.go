package service

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestChannelAffinityWebSocketBodyAndRequestIsolation(t *testing.T) {
	setting := operation_setting.GetChannelAffinitySetting()
	original := *setting
	originalRedisEnabled := common.RedisEnabled
	common.RedisEnabled = false
	*setting = operation_setting.ChannelAffinitySetting{
		Enabled: true, DefaultTTLSeconds: 3600,
		Rules: []operation_setting.ChannelAffinityRule{{
			Name: t.Name(), ModelRegex: []string{"^gpt-"}, PathRegex: []string{"/v1/responses"},
			KeySources:      []operation_setting.ChannelAffinityKeySource{{Type: "gjson", Path: "metadata.session"}},
			IncludeRuleName: true, IncludeUsingGroup: true, SkipRetryOnFailure: true,
		}},
	}
	t.Cleanup(func() {
		_, err := ClearChannelAffinityCacheByRuleName(t.Name())
		require.NoError(t, err)
		*setting = original
		common.RedisEnabled = originalRedisEnabled
	})

	body := []byte(`{"metadata":{"session":"conversation-a"}}`)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/v1/responses", strings.NewReader(`{"metadata":{"session":"handshake"}}`))
	c.Request.Header.Set("Upgrade", "websocket")
	_, found := GetPreferredChannelByAffinityWithBody(c, "gpt-test", "default", body)
	require.False(t, found)
	RecordChannelAffinity(c, 4)

	channelID, found := GetPreferredChannelByAffinityWithBody(c, "gpt-test", "default", body)
	require.True(t, found)
	assert.Equal(t, 4, channelID)
	MarkChannelAffinityUsed(c, "default", channelID)
	assert.True(t, ShouldSkipRetryAfterChannelAffinityFailure(c))
	adminInfo := map[string]interface{}{}
	AppendChannelAffinityAdminInfo(c, adminInfo)
	assert.Contains(t, adminInfo, "channel_affinity")

	// Explicit frame input must neither read nor replace the HTTP handshake body.
	storage, err := common.GetBodyStorage(c)
	require.NoError(t, err)
	t.Cleanup(func() { common.CleanupBodyStorage(c) })
	handshake, err := storage.Bytes()
	require.NoError(t, err)
	assert.JSONEq(t, `{"metadata":{"session":"handshake"}}`, string(handshake))

	for _, tc := range []struct {
		name, model, group, body string
	}{
		{"different conversation", "gpt-test", "default", `{"metadata":{"session":"conversation-b"}}`},
		{"missing key", "gpt-test", "default", `{}`},
		{"empty frame", "gpt-test", "default", ""},
		{"different group", "gpt-test", "vip", string(body)},
		{"unmatched model", "claude-test", "default", string(body)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, hit := GetPreferredChannelByAffinityWithBody(c, "gpt-test", "default", body)
			require.True(t, hit)
			MarkChannelAffinityUsed(c, "default", 4)
			_, hit = GetPreferredChannelByAffinityWithBody(c, tc.model, tc.group, []byte(tc.body))
			assert.False(t, hit)
			assert.False(t, ShouldSkipRetryAfterChannelAffinityFailure(c))
			info := map[string]interface{}{}
			AppendChannelAffinityAdminInfo(c, info)
			assert.NotContains(t, info, "channel_affinity", "do not log the previous frame's binding")
		})
	}

	// The ordinary HTTP path still reads its body and has a separate binding.
	httpContext, _ := gin.CreateTestContext(httptest.NewRecorder())
	httpContext.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", strings.NewReader(string(body)))
	t.Cleanup(func() { common.CleanupBodyStorage(httpContext) })
	_, found = GetPreferredChannelByAffinity(httpContext, "gpt-test", "default")
	require.False(t, found)
	RecordChannelAffinity(httpContext, 13)
	channelID, found = GetPreferredChannelByAffinity(httpContext, "gpt-test", "default")
	require.True(t, found)
	assert.Equal(t, 13, channelID)
	channelID, found = GetPreferredChannelByAffinityWithBody(c, "gpt-test", "default", body)
	require.True(t, found)
	assert.Equal(t, 4, channelID)

	MarkChannelAffinityUsed(c, "default", 4)
	setting.Enabled = false
	_, found = GetPreferredChannelByAffinityWithBody(c, "gpt-test", "default", body)
	assert.False(t, found)
	_, hasMeta := GetChannelAffinityStatsContext(c)
	assert.False(t, hasMeta)
	info := map[string]interface{}{}
	AppendChannelAffinityAdminInfo(c, info)
	assert.Empty(t, info)
}
