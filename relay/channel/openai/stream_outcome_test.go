package openai

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResponsesStreamDiagnosticsPreserveRequestSuccessRate(t *testing.T) {
	previousTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = previousTimeout })
	for _, tc := range []struct {
		name, event string
		want        perfmetrics.Outcome
	}{
		{"completed", `{"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":10,"output_tokens":2,"total_tokens":12}}}`, perfmetrics.OutcomeSuccess},
		{"HTTP 200 with overload", `{"type":"error","error":{"code":"server_is_overloaded","type":"server_error","message":"busy"}}`, perfmetrics.OutcomeSuccess},
		{"context limit", `{"type":"error","code":"context_length_exceeded"}`, perfmetrics.OutcomeIgnored},
		{"output limit", `{"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}`, perfmetrics.OutcomeSuccess},
		{"cancelled", `{"type":"response.cancelled"}`, perfmetrics.OutcomeIgnored},
		{"truncated", `{"type":"response.output_text.delta","delta":"hello"}`, perfmetrics.OutcomeSuccess},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
			info := &relaycommon.RelayInfo{IsStream: true, RelayFormat: types.RelayFormatOpenAIResponses, ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gpt-4o"}}
			resp := &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("data: " + tc.event + "\n\n"))}
			_, apiErr := OaiResponsesStreamHandler(c, info, resp)
			require.Nil(t, apiErr)
			assert.Equal(t, 200, w.Code)
			assert.Contains(t, w.Body.String(), tc.event)
			assert.Equal(t, tc.want, perfmetrics.ClassifyRelayOutcome(c.Request.Context(), info, nil))
		})
	}
}
