package openai

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestChatStreamDistinguishesReportedUsageFromMissingUsage(t *testing.T) {
	previousTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = previousTimeout })
	for _, tc := range []struct {
		name, usageFrame     string
		wantInput, wantCache int
		missing              bool
	}{
		{name: "missing usage", wantInput: 1000, missing: true},
		{name: "explicit zero remains zero", usageFrame: `{"choices":[],"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}`},
		{name: "real cache zero", usageFrame: `{"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":1,"total_tokens":101}}`, wantInput: 100},
		{name: "real cached usage survives later empty frames", usageFrame: `{"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":1,"total_tokens":101,"prompt_tokens_details":{"cached_tokens":80}}}`, wantInput: 100, wantCache: 80},
	} {
		t.Run(tc.name, func(t *testing.T) {
			frames := []string{`{"model":"gpt-6.1-sol","choices":[{"index":0,"delta":{"content":"hello"}}]}`}
			if tc.usageFrame != "" {
				frames = append(frames, tc.usageFrame)
			}
			frames = append(frames, `{"choices":[]}`, `{"choices":[]}`, `{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`, "[DONE]")
			var wire strings.Builder
			for _, frame := range frames {
				wire.WriteString("data: " + frame + "\n\n")
			}
			body := &responsesLifecycleBody{data: strings.NewReader(wire.String()), waiting: make(chan struct{}), closed: make(chan struct{})}
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			info := &relaycommon.RelayInfo{
				IsStream: true, DisablePing: true, StartTime: time.Now(), OriginModelName: "gpt-6.1-sol",
				RelayMode: relayconstant.RelayModeChatCompletions, RelayFormat: types.RelayFormatOpenAI,
				ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-6.1-sol"},
			}
			info.SetEstimatePromptTokens(1000)
			usage, apiErr := OaiStreamHandler(c, info, &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/event-stream"}}, Body: body})
			require.Nil(t, apiErr)
			require.NotNil(t, usage)
			assert.Equal(t, tc.wantInput, usage.PromptTokens)
			assert.Equal(t, tc.wantCache, usage.PromptTokensDetails.CachedTokens)
			assert.Equal(t, tc.missing, common.GetContextKeyBool(c, constant.ContextKeyMissingStreamUsage))
			if tc.usageFrame != "" && tc.wantInput == 0 {
				assert.Zero(t, usage.CompletionTokens)
			}
		})
	}
}

func TestGeminiToOpenAIChatRequestsSupportedStreamUsage(t *testing.T) {
	for _, tc := range []struct {
		name             string
		stream, supports bool
	}{
		{"supported stream", true, true},
		{"unsupported stream", true, false},
		{"supported non-stream", false, true},
		{"unsupported non-stream", false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			info := &relaycommon.RelayInfo{
				RelayFormat: types.RelayFormatGemini, IsStream: tc.stream,
				ChannelMeta: &relaycommon.ChannelMeta{
					ChannelType: constant.ChannelTypeOpenAI, UpstreamModelName: "gpt-4.1",
					SupportStreamOptions: tc.supports,
				},
			}
			request := &dto.GeminiChatRequest{Contents: []dto.GeminiChatContent{{Role: "user", Parts: []dto.GeminiPart{{Text: "hello"}}}}}
			converted, err := (&Adaptor{}).ConvertGeminiRequest(c, info, request)
			require.NoError(t, err)
			body, err := common.Marshal(converted)
			require.NoError(t, err)
			var wire map[string]common.RawMessage
			require.NoError(t, common.Unmarshal(body, &wire))
			if tc.stream && tc.supports {
				assert.JSONEq(t, `{"include_usage":true}`, string(wire["stream_options"]))
			} else {
				assert.NotContains(t, wire, "stream_options")
			}
		})
	}
}

func TestResponsesToChatStreamKeepsExplicitZeroUsage(t *testing.T) {
	previousTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = previousTimeout })
	for _, tc := range []struct {
		name, usageJSON, terminal string
		wantInput                 int
		missing                   bool
	}{
		{name: "missing usage is estimated", wantInput: 1000, missing: true},
		{name: "failed stream without usage estimates partial output", terminal: "response.failed", wantInput: 1000, missing: true},
		{name: "failed stream explicit zero stays zero", terminal: "response.failed", usageJSON: `,"usage":{"input_tokens":0,"output_tokens":0,"total_tokens":0}`},
		{name: "reported zero is authoritative", usageJSON: `,"usage":{"input_tokens":0,"output_tokens":0,"total_tokens":0}`},
		{name: "reported real usage", usageJSON: `,"usage":{"input_tokens":100,"output_tokens":1,"total_tokens":101}`, wantInput: 100},
	} {
		t.Run(tc.name, func(t *testing.T) {
			terminal := tc.terminal
			if terminal == "" {
				terminal = "response.completed"
			}
			status := "completed"
			if terminal == "response.failed" {
				status = "failed"
			}
			wire := "data: " + `{"type":"response.created","response":{"id":"resp-test","model":"gpt-6.1-sol","status":"in_progress","output":[]}}` + "\n\n" +
				"data: " + `{"type":"response.output_text.delta","delta":"hello","output_index":0,"content_index":0}` + "\n\n" +
				"data: " + `{"type":"` + terminal + `","response":{"id":"resp-test","model":"gpt-6.1-sol","status":"` + status + `","output":[]` + tc.usageJSON + `}}` + "\n\ndata: [DONE]\n\n"
			body := &responsesLifecycleBody{data: strings.NewReader(wire), waiting: make(chan struct{}), closed: make(chan struct{})}
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			info := &relaycommon.RelayInfo{IsStream: true, DisablePing: true, StartTime: time.Now(), OriginModelName: "gpt-6.1-sol",
				RelayMode: relayconstant.RelayModeResponses, RelayFormat: types.RelayFormatOpenAI,
				ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-6.1-sol"}}
			info.SetEstimatePromptTokens(1000)
			usage, apiErr := OaiResponsesToChatStreamHandler(c, info, &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/event-stream"}}, Body: body})
			require.Nil(t, apiErr)
			require.NotNil(t, usage)
			assert.Equal(t, tc.wantInput, usage.PromptTokens)
			assert.Equal(t, tc.missing, common.GetContextKeyBool(c, constant.ContextKeyMissingStreamUsage))
			if tc.wantInput == 0 {
				assert.Zero(t, usage.CompletionTokens)
			}
		})
	}
}
