package relay

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	appconstant "github.com/QuantumNous/new-api/constant"
	appdto "github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/i18n"
	appmodel "github.com/QuantumNous/new-api/model"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResponsesWSAdditionalChannelsPreserveNativeConversation(t *testing.T) {
	for _, tc := range []struct {
		name string
		kind int
		auth *dto.AdvancedCustomRouteAuth
	}{
		{"NewAPI", appconstant.ChannelTypeNewAPI, nil},
		{"Sub2API", appconstant.ChannelTypeSub2API, nil},
		{"custom header", appconstant.ChannelTypeAdvancedCustom, &dto.AdvancedCustomRouteAuth{Type: "header", Name: "X-Channel-Key", Value: "{api_key}"}},
		{"custom query", appconstant.ChannelTypeAdvancedCustom, &dto.AdvancedCustomRouteAuth{Type: "query", Name: "api_key", Value: "{api_key}"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setupResponsesWSWorkerTest(t)
			type handshake struct{ path, header, query string }
			hands := make(chan handshake, 2)
			frames := make(chan []byte, 3)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				hands <- handshake{r.URL.Path, r.Header.Get("X-Channel-Key"), r.URL.Query().Get("api_key")}
				conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
				if err != nil {
					return
				}
				defer conn.Close()
				for turn := 1; turn <= 2; turn++ {
					_, body, err := conn.ReadMessage()
					if err != nil {
						return
					}
					frames <- body
					if err = conn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf(`{"type":"response.completed","response":{"id":"resp-%d","status":"completed","usage":{"input_tokens":0,"output_tokens":0,"total_tokens":0}}}`, turn))); err != nil {
						return
					}
				}
				// Keep the same upstream socket alive until the session closes it.
				_, _, _ = conn.ReadMessage()
			}))
			defer upstream.Close()
			channel := &appmodel.Channel{Id: 71, Name: "batch4", Models: "gpt-test", BaseURL: common.GetPointer(upstream.URL)}
			addResponsesWSChannelSelectionTestChannel(t, channel)
			channel.Type = tc.kind
			settings := dto.ChannelOtherSettings{ResponsesWebSocketEnabled: common.GetPointer(true)}
			if tc.kind == appconstant.ChannelTypeAdvancedCustom {
				settings.AdvancedCustom = &dto.AdvancedCustomConfig{Routes: []dto.AdvancedCustomRoute{{IncomingPath: "/v1/responses", UpstreamPath: "/native/responses", Converter: "none", Auth: tc.auth}}}
			}
			channel.SetOtherSettings(settings)
			require.NoError(t, appmodel.DB.Save(channel).Error)
			appmodel.InitChannelCache()
			peer, client, cleanup := newTestWebSocketPair(t)
			defer cleanup()
			session, latest := newResponsesWSWorkerFixture(t, client)
			var firstTarget *websocket.Conn
			for turn := 1; turn <= 2; turn++ {
				message := fmt.Sprintf(`{"type":"response.create","stream_id":"local-%d","model":"gpt-test","input":"hello"}`, turn)
				if turn == 2 {
					message = `{"type":"response.create","model":"gpt-test","previous_response_id":"resp-1","input":[{"type":"function_call_output","call_id":"call-1","output":"done"}]}`
				}
				done := submitResponsesWSWorkerFixture(t, session, message)
				reply := readResponsesWSTerminal(t, peer, done)
				assert.Equal(t, fmt.Sprintf("resp-%d", turn), reply["response"].(map[string]any)["id"])
				var sent map[string]any
				require.NoError(t, common.Unmarshal(<-frames, &sent))
				assert.Equal(t, "response.create", sent["type"])
				assert.NotContains(t, sent, "stream_id")
				if turn == 1 {
					firstTarget = session.getTarget()
				} else {
					assert.Same(t, firstTarget, session.getTarget())
					assert.Equal(t, "resp-1", sent["previous_response_id"])
				}
			}
			h := <-hands
			if tc.kind == appconstant.ChannelTypeAdvancedCustom {
				assert.Equal(t, "/native/responses", h.path)
				if tc.auth.Type == "header" {
					assert.Equal(t, "test-key", h.header)
				} else {
					assert.Equal(t, "test-key", h.query)
				}
				settings.AdvancedCustom.Routes[0].UpstreamPath = "/changed/responses"
				channel.SetOtherSettings(settings)
				require.NoError(t, appmodel.DB.Save(channel).Error)
				appmodel.InitChannelCache()
				apiErr := session.restoreConnectionContext(latest.Load(), "gpt-test")
				require.NotNil(t, apiErr)
				assert.Contains(t, apiErr.Error(), "reconnect required")
			} else {
				assert.Equal(t, "/v1/responses", h.path)
			}
			assert.Empty(t, hands, "continuations must not perform another handshake")
		})
	}
}

func TestResponsesWSResultsAreSampledOncePerTurn(t *testing.T) {
	setupResponsesWSWorkerTest(t)
	require.NoError(t, appmodel.DB.AutoMigrate(&appmodel.PerfMetric{}))
	modelName := "gpt-batch4-metrics"
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"gpt-batch4-metrics":0}`))
	events := []string{
		`{"type":"response.completed","response":{"id":"one","status":"completed","usage":{"input_tokens":0,"output_tokens":0}}}`,
		`{"type":"error","error":{"code":"server_is_overloaded","type":"server_error"}}`,
		`{"type":"response.cancelled","response":{"id":"three"}}`,
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for _, event := range events {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
			if err := conn.WriteMessage(websocket.TextMessage, []byte(event)); err != nil {
				return
			}
		}
		_, _, _ = conn.ReadMessage()
	}))
	defer upstream.Close()
	channel := &appmodel.Channel{Id: 72, Models: modelName, BaseURL: common.GetPointer(upstream.URL)}
	addResponsesWSChannelSelectionTestChannel(t, channel)
	peer, client, cleanup := newTestWebSocketPair(t)
	defer cleanup()
	session, latest := newResponsesWSWorkerFixture(t, client)
	for index := range events {
		done := submitResponsesWSWorkerFixture(t, session, fmt.Sprintf(`{"type":"response.create","model":%q,"input":"hello"}`, modelName))
		readResponsesWSTerminal(t, peer, done)
		assert.Nil(t, session.getCurrent(), "settled turn must release its worker exactly once")
		if index != 1 {
			value, ok := latest.Load().Get(string(appconstant.ContextKeyResponseStreamStatus))
			require.True(t, ok)
			assert.True(t, value.(*relaycommon.StreamStatus).IsNormalEnd())
		}
	}
	result, err := perfmetrics.QuerySummaryAll(24, nil)
	require.NoError(t, err)
	var got *perfmetrics.ModelSummary
	for i := range result.Models {
		if result.Models[i].ModelName == modelName {
			got = &result.Models[i]
		}
	}
	require.NotNil(t, got)
	assert.Equal(t, int64(2), got.RequestCount)
	assert.Equal(t, 50.0, got.SuccessRate)
}

func TestResponsesWSDisconnectOutcomeKeepsFirstCause(t *testing.T) {
	for _, tc := range []struct {
		name   string
		reason relaycommon.StreamEndReason
		want   perfmetrics.Outcome
	}{
		{"client leaves", relaycommon.StreamEndReasonClientGone, perfmetrics.OutcomeIgnored},
		{"upstream disappears", relaycommon.StreamEndReasonScannerErr, perfmetrics.OutcomeFailure},
		{"upstream stalls", relaycommon.StreamEndReasonTimeout, perfmetrics.OutcomeFailure},
		{"client heartbeat", relaycommon.StreamEndReasonPingFail, perfmetrics.OutcomeIgnored},
	} {
		t.Run(tc.name, func(t *testing.T) {
			info := &relaycommon.RelayInfo{StreamStatus: relaycommon.NewStreamStatus()}
			info.StreamStatus.RequireTerminal()
			// The serial worker records a reason before shutdown; a concurrent
			// client disconnect must not overwrite that first terminal cause.
			info.StreamStatus.SetEndReason(tc.reason, nil)
			info.StreamStatus.SetEndReason(relaycommon.StreamEndReasonClientGone, nil)
			assert.Equal(t, tc.want, perfmetrics.ClassifyRelayOutcome(nil, info, nil))
		})
	}
}

func TestResponsesWSPinnedChannelCannotBypassNativeRoutePolicy(t *testing.T) {
	require.NoError(t, i18n.Init())
	for _, tc := range []struct {
		name      string
		kind      int
		enabled   *bool
		converter string
	}{
		{"NewAPI requires opt in", appconstant.ChannelTypeNewAPI, nil, ""},
		{"Sub2API disabled", appconstant.ChannelTypeSub2API, common.GetPointer(false), ""},
		{"custom converter", appconstant.ChannelTypeAdvancedCustom, common.GetPointer(true), "openai_responses_to_openai_chat_completions"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setupResponsesWSChannelSelectionTest(t)
			channel := &appmodel.Channel{Id: 81, Models: "gpt-test"}
			addResponsesWSChannelSelectionTestChannel(t, channel)
			channel.Type = tc.kind
			channel.SetOtherSettings(dto.ChannelOtherSettings{
				ResponsesWebSocketEnabled: tc.enabled,
				AdvancedCustom: &dto.AdvancedCustomConfig{Routes: []dto.AdvancedCustomRoute{{
					IncomingPath: "/v1/responses", Converter: tc.converter,
				}}},
			})
			require.NoError(t, appmodel.DB.Save(channel).Error)
			appmodel.InitChannelCache()
			c := newResponsesWSChannelSelectionContext()
			service.GetChannelConstraints(c).AddPin(appdto.ChannelPin{ChannelId: channel.Id, Source: appdto.PinSourceToken, Rank: appdto.PinRankToken, RetryMode: appdto.PinRetrySingleAttempt})
			selected, apiErr := selectResponsesWSChannel(c, "gpt-test", &service.RetryParam{Ctx: c, ModelName: "gpt-test", TokenGroup: "default"})
			assert.Nil(t, selected)
			require.NotNil(t, apiErr)
			assert.Equal(t, http.StatusBadRequest, apiErr.StatusCode)
			assert.Equal(t, string(appdto.FilterResponsesWebSocket), string(apiErr.GetErrorCode()))
		})
	}
}

func TestResponsesWSRejectsChangedCustomRouteOnContinuation(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*dto.AdvancedCustomRoute)
	}{
		{"auth placement", func(r *dto.AdvancedCustomRoute) { r.Auth.Type = "query" }},
		{"auth template", func(r *dto.AdvancedCustomRoute) { r.Auth.Value = "Bearer {api_key}" }},
		{"converter", func(r *dto.AdvancedCustomRoute) { r.Converter = "openai_responses_to_openai_chat_completions" }},
		{"model scope", func(r *dto.AdvancedCustomRoute) { r.Models = []string{"gpt-other"} }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setupResponsesWSChannelSelectionTest(t)
			channel := &appmodel.Channel{Id: 82, Models: "gpt-test"}
			addResponsesWSChannelSelectionTestChannel(t, channel)
			channel.Type = appconstant.ChannelTypeAdvancedCustom
			channel.SetOtherSettings(dto.ChannelOtherSettings{
				ResponsesWebSocketEnabled: common.GetPointer(true),
				AdvancedCustom: &dto.AdvancedCustomConfig{Routes: []dto.AdvancedCustomRoute{{
					IncomingPath: "/v1/responses", UpstreamPath: "/native/responses", Converter: "none",
					Auth: &dto.AdvancedCustomRouteAuth{Type: "header", Name: "X-Key", Value: "{api_key}"},
				}}},
			})
			require.NoError(t, appmodel.DB.Save(channel).Error)
			appmodel.InitChannelCache()
			route, ok := channel.GetOtherSettings().AdvancedCustom.MatchPathForModel("/v1/responses", "gpt-test")
			require.True(t, ok)
			c := newResponsesWSChannelSelectionContext()
			service.GetChannelConstraints(c).AddPin(appdto.ChannelPin{ChannelId: channel.Id, Source: appdto.PinSourceToken, Rank: appdto.PinRankToken, RetryMode: appdto.PinRetrySingleAttempt})
			session := &responsesWSSession{lockedChannelID: channel.Id, lockedKey: channel.Key, lockedRoute: route,
				lockedContext: map[appconstant.ContextKey]any{appconstant.ContextKeyChannelType: channel.Type, appconstant.ContextKeyChannelBaseUrl: channel.GetBaseURL(), appconstant.ContextKeyChannelHeaderOverride: channel.GetHeaderOverride()}}
			require.Nil(t, session.restoreConnectionContext(c, "gpt-test"))
			settings := channel.GetOtherSettings()
			tc.change(&settings.AdvancedCustom.Routes[0])
			channel.SetOtherSettings(settings)
			require.NoError(t, appmodel.DB.Save(channel).Error)
			appmodel.InitChannelCache()
			apiErr := session.restoreConnectionContext(c, "gpt-test")
			require.NotNil(t, apiErr)
			assert.Equal(t, http.StatusForbidden, apiErr.StatusCode)
		})
	}
}
