package service

import (
	"fmt"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/auto_ban"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// Measures only the additional branch on already decoded Responses/WS frames.
// JSON parsing belongs to the existing relay and is not repeated for auto-ban.
func BenchmarkAutoBanResponsesEventGate(b *testing.B) {
	for _, event := range []dto.ResponsesStreamResponse{
		{Type: "response.output_text.delta", Delta: "cyber_policy"},
		{Type: "response.completed", Response: &dto.OpenAIResponsesResponse{}},
		{Type: "response.image_generation_call.partial_image"},
	} {
		b.Run(event.Type, func(b *testing.B) {
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				if IsResponsesFailure(&event) {
					b.Fatal("successful event was treated as failure")
				}
			}
		})
	}
}

// Measures snapshot reads and rule matching on ordinary upstream errors that
// do not ban users. Configuration parsing happens outside the measured loop.
func BenchmarkAutoBanUnmatchedUpstreamError(b *testing.B) {
	previous, oldMode := auto_ban.CurrentSnapshot(), gin.Mode()
	gin.SetMode(gin.TestMode)
	b.Cleanup(func() { auto_ban.PublishSnapshot(previous); gin.SetMode(oldMode) })
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set("id", 1)
	body := []byte(`{"error":{"code":"invalid_request","message":"Invalid argument: the requested model is not available"}}`)
	for _, tc := range []struct {
		mode  string
		rules int
	}{{"off", 3}, {"observe", 3}, {"observe", 64}} {
		b.Run(fmt.Sprintf("%s_%d_rules", tc.mode, tc.rules), func(b *testing.B) {
			s := auto_ban.Defaults()
			s.Mode = tc.mode
			templates := s.Rules
			s.Rules = nil
			for i := 0; i < tc.rules; i++ {
				r := templates[i%len(templates)]
				r.ID = fmt.Sprint("rule-", i)
				s.Rules = append(s.Rules, r)
			}
			data, err := common.Marshal(s)
			require.NoError(b, err)
			snapshot, err := auto_ban.ParseSnapshot(string(data))
			require.NoError(b, err)
			auto_ban.PublishSnapshot(snapshot)
			require.False(b, ObserveUpstreamFailure(c, body, 400))
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				ObserveUpstreamFailure(c, body, 400)
			}
		})
	}
}
