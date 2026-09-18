package openai

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

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
