package dto

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResponsesTokenCountMetaExcludesFunctionCallOutput(t *testing.T) {
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
	assert.NotContains(t, meta.CombineText, toolResult, "pre-consume must not include function_call_output")
	assert.Contains(t, meta.CombineText, "continue", "ordinary input must still reach token counting")
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
