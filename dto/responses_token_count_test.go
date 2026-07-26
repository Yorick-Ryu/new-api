package dto

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestResponsesIncrementalTokenCountMetaIncludesFunctionCallOutput guards
// pre-consume sizing for stateful tool-result turns. A WebSocket turn can
// consist of nothing but a function_call_output item, so the incremental path
// must count it even though the HTTP path deliberately does not.
func TestResponsesIncrementalTokenCountMetaIncludesFunctionCallOutput(t *testing.T) {
	toolResult := "the weather in Shanghai is 31C and humid"

	var request OpenAIResponsesRequest
	require.NoError(t, common.Unmarshal([]byte(`{
		"model": "gpt-4o",
		"input": [
			{"type": "function_call_output", "call_id": "call_1", "output": "`+toolResult+`"}
		]
	}`), &request))

	meta := request.GetIncrementalTokenCountMeta()
	require.NotNil(t, meta)
	assert.Contains(t, meta.CombineText, toolResult, "function_call_output must reach token counting")
}

func TestResponsesIncrementalTokenCountMetaIncludesStructuredFunctionCallOutput(t *testing.T) {
	var request OpenAIResponsesRequest
	require.NoError(t, common.Unmarshal([]byte(`{
		"model": "gpt-4o",
		"input": [
			{"type": "function_call_output", "call_id": "call_1", "output": {"temperature": "31C", "city": "Shanghai"}}
		]
	}`), &request))

	meta := request.GetIncrementalTokenCountMeta()
	require.NotNil(t, meta)
	assert.Contains(t, meta.CombineText, "Shanghai", "structured tool output must reach token counting")
}

func TestResponsesHTTPTokenCountMetaExcludesAccumulatedFunctionCallOutput(t *testing.T) {
	toolResult := "large accumulated shell output"

	var request OpenAIResponsesRequest
	require.NoError(t, common.Unmarshal([]byte(`{
		"model": "gpt-4o",
		"input": [
			{"type": "function_call_output", "call_id": "call_1", "output": "`+toolResult+`"},
			{"type": "message", "role": "user", "content": "continue"}
		]
	}`), &request))

	meta := request.GetTokenCountMeta()
	require.NotNil(t, meta)
	assert.NotContains(t, meta.CombineText, toolResult, "HTTP pre-consume must not include accumulated tool-output history")
	assert.Contains(t, meta.CombineText, "continue", "ordinary HTTP input must still reach token counting")
}

func TestResponsesTokenCountMetaStillCountsPlainContent(t *testing.T) {
	var request OpenAIResponsesRequest
	require.NoError(t, common.Unmarshal([]byte(`{
		"model": "gpt-4o",
		"input": [
			{"type": "message", "role": "user", "content": "hello there"}
		]
	}`), &request))

	meta := request.GetTokenCountMeta()
	require.NotNil(t, meta)
	assert.Contains(t, meta.CombineText, "hello there")
}
