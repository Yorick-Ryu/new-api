package helper

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestImageInputValidation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	tests := []struct {
		name, path, body, param string
		format                  types.RelayFormat
	}{
		{
			name: "chat empty base64 in history retains original index", path: "/v1/chat/completions", format: types.RelayFormatOpenAI,
			body:  `{"model":"gpt-test","messages":[{"role":"system","content":"test"},{"role":"user","content":[{"type":"provider_extension"},{"type":"image_url","image_url":{"url":"data:image/png;base64,"}}]}]}`,
			param: "messages[1].content[1].image_url.url",
		},
		{
			name: "chat string image URL whitespace payload", path: "/v1/chat/completions", format: types.RelayFormatOpenAI,
			body:  `{"model":"gpt-test","messages":[{"role":"user","content":[{"type":"image_url","image_url":"data:image/jpeg;base64, \r\n\t"}]}]}`,
			param: "messages[0].content[0].image_url",
		},
		{
			name: "chat missing image source", path: "/v1/chat/completions", format: types.RelayFormatOpenAI,
			body:  `{"model":"gpt-test","messages":[{"role":"user","content":[{"type":"image_url"}]}]}`,
			param: "messages[0].content[0].image_url",
		},
		{
			name: "chat blank URL", path: "/v1/chat/completions", format: types.RelayFormatOpenAI,
			body:  `{"model":"gpt-test","messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":" "}}]}]}`,
			param: "messages[0].content[0].image_url.url",
		},
		{
			name: "responses reported empty image", path: "/v1/responses", format: types.RelayFormatOpenAIResponses,
			body:  `{"model":"gpt-test","input":[{"role":"system","content":"test"},{"role":"user","content":[{"type":"input_image","image_url":"data:image/png;base64,"}]}]}`,
			param: "input[1].content[0].image_url",
		},
		{
			name: "responses tool output image", path: "/v1/responses", format: types.RelayFormatOpenAIResponses,
			body:  `{"model":"gpt-test","input":[{"type":"function_call_output","call_id":"call-test","output":[{"type":"input_image","image_url":"data:image/png;base64,"}]}]}`,
			param: "input[0].output[0].image_url",
		},
		{
			name: "responses computer screenshot", path: "/v1/responses", format: types.RelayFormatOpenAIResponses,
			body:  `{"model":"gpt-test","input":[{"type":"computer_call_output","call_id":"call-test","output":{"type":"computer_screenshot","image_url":"data:image/png;base64,"}}]}`,
			param: "input[0].output.image_url",
		},
		{
			name: "compaction rejects empty image", path: "/v1/responses/compact", format: types.RelayFormatOpenAIResponsesCompaction,
			body:  `{"model":"gpt-test","input":[{"type":"message","role":"user","content":[{"type":"input_image","image_url":""}]}]}`,
			param: "input[0].content[0].image_url",
		},
		{
			name: "chat normal URLs and base64 are unchanged", path: "/v1/chat/completions", format: types.RelayFormatOpenAI,
			body: `{"model":"gpt-test","messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":"https://example.invalid/photo.png"}},{"type":"image_url","image_url":"data:image/png;base64,aW1hZ2U="},{"type":"text","text":"data:image/png;base64,"}]}]}`,
		},
		{
			name: "responses files normal images and tool text are unchanged", path: "/v1/responses", format: types.RelayFormatOpenAIResponses,
			body: `{"model":"gpt-test","input":[{"role":"user","content":[{"type":"input_image","file_id":"file-test"},{"type":"input_image","file_id":"file-test-2","image_url":null},{"type":"input_image","image_url":"https://example.invalid/photo.png"},{"type":"input_image","image_url":"data:image/png;base64,aW1hZ2U="}]},{"type":"function_call_output","call_id":"call-test","output":"{\"type\":\"input_image\",\"image_url\":\"\"}"}]}`,
		},
		{
			name: "text that describes an empty image is unchanged", path: "/v1/responses", format: types.RelayFormatOpenAIResponses,
			body: `{"model":"gpt-test","input":"Please explain data:image/png;base64,"}`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, tt.path, strings.NewReader(tt.body))
			c.Request.Header.Set("Content-Type", "application/json")
			request, err := GetAndValidateRequest(c, tt.format)
			if tt.param != "" {
				var apiErr *types.NewAPIError
				require.ErrorAs(t, err, &apiErr)
				assert.Equal(t, http.StatusBadRequest, apiErr.StatusCode)
				assert.True(t, types.IsSkipRetryError(apiErr))
				payload := apiErr.ToOpenAIError()
				assert.Equal(t, "invalid_request_error", payload.Type)
				assert.Equal(t, "invalid_image_url", payload.Code)
				assert.Equal(t, tt.param, payload.Param)
				assert.Contains(t, payload.Message, "upload it again before retrying")
				assert.NotContains(t, payload.Message, "data:image")
				return
			}
			require.NoError(t, err)
			require.NotNil(t, request)
			storage, err := common.GetBodyStorage(c)
			require.NoError(t, err)
			body, err := storage.Bytes()
			require.NoError(t, err)
			assert.Equal(t, tt.body, string(body))
		})
	}
}

func TestResponsesImageValidationAllowsIncrementalWebSocketInput(t *testing.T) {
	request := &dto.OpenAIResponsesRequest{Model: "gpt-test", PreviousResponseID: "resp-test"}
	require.NoError(t, ValidateResponsesRequest(request))
	request.Input = common.RawMessage(`[]`)
	require.NoError(t, ValidateResponsesRequest(request))
}
