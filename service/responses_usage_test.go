package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"

	"github.com/QuantumNous/new-api/relaykit/dto"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestApplyResponsesUsageCopiesTokenDetails(t *testing.T) {
	dst := &dto.Usage{}
	src := &dto.Usage{
		InputTokens:  11,
		OutputTokens: 7,
		TotalTokens:  18,
		InputTokensDetails: &dto.InputTokenDetails{
			CachedTokens:         3,
			CachedCreationTokens: 2,
			TextTokens:           6,
			AudioTokens:          4,
			ImageTokens:          5,
		},
		OutputTokensDetails: &dto.OutputTokenDetails{
			TextTokens:      1,
			AudioTokens:     2,
			ImageTokens:     3,
			ReasoningTokens: 4,
		},
		PromptCacheHitTokens: 3,
		UsageSemantic:        "openai",
		UsageSource:          "upstream",
	}

	ApplyResponsesUsage(dst, src)

	assert.Equal(t, 11, dst.PromptTokens)
	assert.Equal(t, 7, dst.CompletionTokens)
	assert.Equal(t, 18, dst.TotalTokens)
	require.NotNil(t, dst.InputTokensDetails)
	assert.Equal(t, *src.InputTokensDetails, dst.PromptTokensDetails)
	assert.Equal(t, *src.OutputTokensDetails, dst.CompletionTokenDetails)
	require.NotNil(t, dst.OutputTokensDetails)
	assert.Equal(t, *src.OutputTokensDetails, *dst.OutputTokensDetails)
	assert.Equal(t, "openai", dst.UsageSemantic)
	assert.Equal(t, "upstream", dst.UsageSource)
	assert.Equal(t, 3, dst.PromptCacheHitTokens)
}

func TestApplyResponsesUsageCopiesCacheWriteTokens(t *testing.T) {
	dst := &dto.Usage{}
	src := &dto.Usage{
		InputTokens:  20,
		OutputTokens: 5,
		InputTokensDetails: &dto.InputTokenDetails{
			CachedTokens:     8,
			CacheWriteTokens: 12,
		},
	}

	ApplyResponsesUsage(dst, src)

	assert.Equal(t, 8, dst.PromptTokensDetails.CachedTokens)
	assert.Equal(t, 12, dst.PromptTokensDetails.CacheWriteTokens)
}

func TestApplyResponsesUsageFallsBackToCompletionTokenDetails(t *testing.T) {
	dst := &dto.Usage{}
	src := &dto.Usage{
		CompletionTokenDetails: dto.OutputTokenDetails{
			ReasoningTokens: 9,
		},
	}

	ApplyResponsesUsage(dst, src)

	assert.Equal(t, 9, dst.CompletionTokenDetails.ReasoningTokens)
	require.NotNil(t, dst.OutputTokensDetails)
	assert.Equal(t, 9, dst.OutputTokensDetails.ReasoningTokens)
}

func TestResponsesUsageAccumulatorInterruptedAndFailedStreams(t *testing.T) {
	for _, tc := range []struct {
		name               string
		events             []string
		prompt, completion int
	}{
		{name: "no upstream event"},
		{name: "created then disconnected", events: []string{`{"type":"response.created"}`}, prompt: 100},
		{name: "tool and reasoning interrupted", events: []string{`{"type":"response.reasoning_summary_text.delta","delta":"Inspect repository. "}`, `{"type":"response.function_call_arguments.delta","delta":"ls"}`}, prompt: 100, completion: CountTextToken("Inspect repository. ls", "gpt-4o")},
		{name: "reasoning and refusal", events: []string{`{"type":"response.reasoning_text.delta","delta":"Reason. "}`, `{"type":"response.refusal.delta","delta":"Cannot comply."}`}, prompt: 100, completion: CountTextToken("Reason. Cannot comply.", "gpt-4o")},
		{name: "terminal tool arguments", events: []string{`{"type":"response.completed","response":{"output":[{"type":"function_call","arguments":"ls"}]}}`}, prompt: 100, completion: CountTextToken("ls", "gpt-4o")},
		{name: "terminal text", events: []string{`{"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"answer"}]}]}}`}, prompt: 100, completion: CountTextToken("answer", "gpt-4o")},
		{name: "incomplete prompt", events: []string{`{"type":"response.incomplete"}`}, prompt: 100},
		{name: "cancelled reported usage", events: []string{`{"type":"response.cancelled","response":{"usage":{"input_tokens":12,"output_tokens":3}}}`}, prompt: 12, completion: 3},
		{name: "reported zero success", events: []string{`{"type":"response.output_text.delta","delta":"answer"}`, `{"type":"response.completed","response":{"usage":{"input_tokens":0,"output_tokens":0}}}`}},
		{name: "failure after output", events: []string{`{"type":"response.output_text.delta","delta":"answer"}`, `{"type":"response.failed"}`}},
		{name: "flat error after output", events: []string{`{"type":"response.output_text.delta","delta":"answer"}`, `{"type":"error"}`}},
		{name: "response error after output", events: []string{`{"type":"response.output_text.delta","delta":"answer"}`, `{"type":"response.error"}`}},
		{name: "failed legacy done", events: []string{`{"type":"response.output_text.delta","delta":"answer"}`, `{"type":"response.done","response":{"status":"failed"}}`}},
		{name: "reported zero failure", events: []string{`{"type":"response.output_text.delta","delta":"answer"}`, `{"type":"response.failed","response":{"usage":{"input_tokens":0,"output_tokens":0}}}`}},
		{name: "reported partial failure", events: []string{`{"type":"response.output_text.delta","delta":"answer"}`, `{"type":"response.failed","response":{"usage":{"input_tokens":12}}}`}, prompt: 12},
		{name: "reported complete failure", events: []string{`{"type":"response.failed","response":{"usage":{"input_tokens":12,"output_tokens":3,"total_tokens":15}}}`}, prompt: 12, completion: 3},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// No StreamStatus: accounting must remember protocol failure on its own.
			info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-4o"}}
			info.SetEstimatePromptTokens(100)
			a := NewResponsesUsageAccumulator(info)
			for _, raw := range tc.events {
				var event dto.ResponsesStreamResponse
				require.NoError(t, common.UnmarshalJsonStr(raw, &event))
				a.Observe(&event)
			}
			usage := a.Finish()
			assert.Equal(t, tc.prompt, usage.PromptTokens)
			assert.Equal(t, tc.completion, usage.CompletionTokens)
			assert.Equal(t, tc.prompt+tc.completion, usage.TotalTokens)
			snapshot := *usage
			a.Observe(&dto.ResponsesStreamResponse{Type: "response.completed", Response: &dto.OpenAIResponsesResponse{Usage: &dto.Usage{InputTokens: 999}}})
			assert.Equal(t, snapshot, *a.Finish(), "late events must not change settled usage")
		})
	}
}

func TestObserveResponsesOutcomeRecordsProtocolFacts(t *testing.T) {
	for _, tc := range []struct {
		name        string
		event       string
		wantOutcome relaycommon.ResponseOutcome
		wantCode    string
		wantType    string
		wantIncompl string
	}{
		{"flat sse error", `{"type":"error","code":"context_length_exceeded","message":"too long"}`, relaycommon.ResponseOutcomeFailed, "context_length_exceeded", "", ""},
		{"done with failed status", `{"type":"response.done","response":{"status":"failed","error":{"code":"invalid_api_key","type":"invalid_request_error","message":"bad key"}}}`, relaycommon.ResponseOutcomeFailed, "invalid_api_key", "invalid_request_error", ""},
		{"incomplete keeps reason", `{"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}`, relaycommon.ResponseOutcomeIncomplete, "", "", "max_output_tokens"},
		{"in progress is not terminal", `{"type":"response.created","response":{"status":"in_progress"}}`, relaycommon.ResponseOutcomeUnknown, "", "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var event dto.ResponsesStreamResponse
			require.NoError(t, common.UnmarshalJsonStr(tc.event, &event))
			info := &relaycommon.RelayInfo{StreamStatus: relaycommon.NewStreamStatus()}
			ObserveResponsesOutcome(info, &event)
			outcome := info.StreamStatus.OutcomeSnapshot()
			assert.Equal(t, tc.wantOutcome, outcome.Response)
			assert.Equal(t, tc.wantCode, outcome.ErrorCode)
			assert.Equal(t, tc.wantType, outcome.ErrorType)
			assert.Equal(t, tc.wantIncompl, outcome.IncompleteReason)
		})
	}
}
