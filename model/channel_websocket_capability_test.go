package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	hostdto "github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResponsesWebSocketChannelCapabilities(t *testing.T) {
	for _, tc := range []struct {
		name      string
		kind      int
		enabled   *bool
		converter string
		want      bool
	}{
		{"legacy OpenAI", constant.ChannelTypeOpenAI, nil, "", true},
		{"legacy Codex", constant.ChannelTypeCodex, nil, "", true},
		{"disabled OpenAI", constant.ChannelTypeOpenAI, common.GetPointer(false), "", false},
		{"NewAPI requires opt in", constant.ChannelTypeNewAPI, nil, "", false},
		{"NewAPI enabled", constant.ChannelTypeNewAPI, common.GetPointer(true), "", true},
		{"Sub2API enabled", constant.ChannelTypeSub2API, common.GetPointer(true), "", true},
		{"custom native", constant.ChannelTypeAdvancedCustom, common.GetPointer(true), "none", true},
		{"custom implicit native", constant.ChannelTypeAdvancedCustom, common.GetPointer(true), "", true},
		{"custom conversion", constant.ChannelTypeAdvancedCustom, common.GetPointer(true), "openai_responses_to_openai_chat_completions", false},
		{"unsupported provider", constant.ChannelTypeAnthropic, common.GetPointer(true), "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			channel := &Channel{Type: tc.kind}
			channel.SetOtherSettings(dto.ChannelOtherSettings{
				ResponsesWebSocketEnabled: tc.enabled,
				AdvancedCustom: &dto.AdvancedCustomConfig{Routes: []dto.AdvancedCustomRoute{{
					IncomingPath: "/v1/responses", UpstreamPath: "/native/responses", Converter: tc.converter, Models: []string{"gpt-native"},
				}}},
			})
			assert.Equal(t, tc.want, channel.SupportsResponsesTransport(constant.ResponsesTransportWebSocket, "gpt-native"))
			assert.True(t, channel.SupportsResponsesTransport(constant.ResponsesTransportHTTP))
			if tc.kind == constant.ChannelTypeAdvancedCustom {
				assert.False(t, channel.SupportsResponsesTransport(constant.ResponsesTransportWebSocket, "gpt-other"))
			}
		})
	}
}

func TestResponsesWebSocketSelectionExcludesConvertersBeforePriority(t *testing.T) {
	for _, memory := range []bool{false, true} {
		t.Run(map[bool]string{false: "database", true: "cache"}[memory], func(t *testing.T) {
			resetChannelTransportSelectionTables(t, memory)
			for _, tc := range []struct {
				id        int
				converter string
				priority  int64
			}{
				{71, "openai_responses_to_openai_chat_completions", 200}, {72, "none", 100},
			} {
				insertChannelTransportSelectionChannel(t, &Channel{
					Id: tc.id, Type: constant.ChannelTypeAdvancedCustom, Models: "gpt-native", Priority: &tc.priority,
				}, dto.ChannelOtherSettings{
					ResponsesWebSocketEnabled: common.GetPointer(true),
					AdvancedCustom:            &dto.AdvancedCustomConfig{Routes: []dto.AdvancedCustomRoute{{IncomingPath: "/v1/responses", UpstreamPath: "/v1/responses", Converter: tc.converter}}},
				})
			}
			InitChannelCache()
			selected, err := GetRandomSatisfiedChannel("default", "gpt-native", 0, []hostdto.ChannelFilter{{Kind: hostdto.FilterRequestPath, RequestPath: "/v1/responses"}, {Kind: hostdto.FilterResponsesTransport, ResponsesTransport: constant.ResponsesTransportWebSocket}})
			require.NoError(t, err)
			require.NotNil(t, selected)
			assert.Equal(t, 72, selected.Id)
			httpChannel, err := GetRandomSatisfiedChannel("default", "gpt-native", 0, []hostdto.ChannelFilter{{Kind: hostdto.FilterRequestPath, RequestPath: "/v1/responses"}, {Kind: hostdto.FilterResponsesTransport, ResponsesTransport: constant.ResponsesTransportHTTP}})
			require.NoError(t, err)
			require.NotNil(t, httpChannel)
			assert.Equal(t, 71, httpChannel.Id)
		})
	}
}

func TestResponsesWebSocketSwitchesHonorBothStorageFormats(t *testing.T) {
	for _, tc := range []struct {
		name     string
		kind     int
		legacy   *bool
		upstream string
		want     bool
	}{
		{"legacy OpenAI missing", constant.ChannelTypeOpenAI, nil, "{}", true},
		{"new provider missing", constant.ChannelTypeNewAPI, nil, "{}", false},
		{"new provider upstream opt in", constant.ChannelTypeNewAPI, nil, `{"responses_websocket_enabled":true}`, true},
		{"legacy disabled wins", constant.ChannelTypeNewAPI, common.GetPointer(false), `{"responses_websocket_enabled":true}`, false},
		{"upstream disabled wins", constant.ChannelTypeOpenAI, common.GetPointer(true), `{"responses_websocket_enabled":false}`, false},
		{"malformed upstream fails closed", constant.ChannelTypeOpenAI, common.GetPointer(true), `{`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			channel := &Channel{Type: tc.kind, Setting: &tc.upstream}
			channel.SetOtherSettings(dto.ChannelOtherSettings{ResponsesWebSocketEnabled: tc.legacy})
			assert.Equal(t, tc.want, channel.SupportsResponsesTransport(constant.ResponsesTransportWebSocket, "gpt-test"))
			assert.True(t, channel.SupportsResponsesTransport(constant.ResponsesTransportHTTP, "gpt-test"))
		})
	}
}
