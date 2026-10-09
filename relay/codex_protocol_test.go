package relay

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaychannel "github.com/QuantumNous/new-api/relay/channel"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCodexProtocolHeadersOnWire(t *testing.T) {
	service.InitHttpClient()
	for _, transport := range []string{"http", "ws"} {
		for _, tc := range []struct {
			name, model, guardian, cache string
			override                     bool
		}{
			{"reviewer_without_cache", "codex-auto-review", "reviewer", "", false},
			{"classifier", "gpt-5.5", "classifier", "shared-cache", false},
			{"ordinary_without_cache", "gpt-5.5", "", "", false},
			{"channel_override", "codex-auto-review", "reviewer", "", true},
		} {
			t.Run(transport+"/"+tc.name, func(t *testing.T) {
				captured := make(chan http.Header, 1)
				upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					captured <- r.Header.Clone()
					if transport == "ws" {
						conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
						if err == nil {
							defer conn.Close()
							_, _, _ = conn.ReadMessage()
						}
					} else {
						_, _ = io.Copy(io.Discard, r.Body)
						_, _ = w.Write([]byte(`{}`))
					}
				}))
				defer upstream.Close()
				raw, err := common.Marshal(map[string]any{"model": tc.model, "input": []any{}, "prompt_cache_key": tc.cache})
				require.NoError(t, err)
				c, _ := gin.CreateTestContext(httptest.NewRecorder())
				c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(raw))
				supplied := map[string]string{"User-Agent": "codex-tui/0.162.0", "Session-Id": "parent", "Thread-Id": "fork", "X-Codex-Parent-Thread-Id": "parent", "X-OpenAI-Subagent": "guardian"}
				if tc.guardian != "" {
					supplied["X-Codex-Guardian"] = tc.guardian
				}
				for key, value := range supplied {
					c.Request.Header.Set(key, value)
				}
				c.Request.Header.Set("Authorization", "Bearer client-secret-must-not-forward")
				c.Request.Header.Set("Cookie", "client-cookie-must-not-forward")
				common.SetContextKey(c, constant.ContextKeyOriginalModel, tc.model)
				common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeOpenAI)
				common.SetContextKey(c, constant.ContextKeyChannelBaseUrl, upstream.URL)
				common.SetContextKey(c, constant.ContextKeyChannelKey, "synthetic-channel-key")
				common.SetContextKey(c, constant.ContextKeyUsingGroup, "default")
				if tc.override {
					common.SetContextKey(c, constant.ContextKeyChannelHeaderOverride, map[string]any{"X-Codex-Guardian": "classifier", "User-Agent": "operator-ua"})
				}
				service.GetPreferredChannelByAffinityWithBody(c, tc.model, "default", raw)
				if overrides, applied := service.ApplyChannelAffinityOverrideTemplate(c, nil); applied {
					common.SetContextKey(c, constant.ContextKeyChannelParamOverride, overrides)
				}
				var request dto.OpenAIResponsesRequest
				require.NoError(t, common.Unmarshal(raw, &request))
				info := relaycommon.GenRelayInfoResponses(c, &request)
				adaptor, body, closer, apiErr := PrepareResponsesRequest(c, info, &request)
				require.Nil(t, apiErr)
				defer closer.Close()
				if transport == "ws" {
					conn, err := relaychannel.DoWssRequest(adaptor, c, info, nil)
					require.NoError(t, err)
					defer conn.Close()
					require.NoError(t, conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create"}`)))
				} else {
					response, err := adaptor.DoRequest(c, info, body)
					require.NoError(t, err)
					defer response.(*http.Response).Body.Close()
				}
				got := <-captured
				if tc.override {
					supplied["X-Codex-Guardian"] = "classifier"
					supplied["User-Agent"] = "operator-ua"
				}
				for key, value := range supplied {
					assert.Equal(t, value, got.Get(key), key)
				}
				if tc.guardian == "" {
					assert.Empty(t, got.Get("X-Codex-Guardian"))
				}
				assert.Equal(t, "Bearer synthetic-channel-key", got.Get("Authorization"))
				assert.Empty(t, got.Get("Cookie"))
			})
		}
	}
}

func TestCodexInterruptThroughSessionAndContinue(t *testing.T) {
	setupResponsesWSWorkerTest(t)
	frames := make(chan []byte, 4)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for turn := 1; turn <= 2; turn++ {
			_, create, err := conn.ReadMessage()
			if err != nil {
				return
			}
			frames <- create
			if err := conn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf(`{"type":"response.created","response":{"id":"resp_%d","status":"in_progress"}}`, turn))); err != nil {
				return
			}
			if turn == 1 {
				_, control, err := conn.ReadMessage()
				if err != nil {
					return
				}
				frames <- control
				if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.interrupt.accepted","response_id":"resp_1"}`)); err != nil {
					return
				}
				if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.incomplete","response":{"id":"resp_1","status":"incomplete","incomplete_details":{"reason":"interrupted"},"usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5}}}`)); err != nil {
					return
				}
			} else {
				_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.completed","response":{"id":"resp_2","status":"completed","usage":{"input_tokens":4,"output_tokens":1,"total_tokens":5}}}`))
			}
		}
		// Keep the connection alive until the proxy closes it after the test.
		_, _, _ = conn.ReadMessage()
	}))
	defer upstream.Close()
	addResponsesWSChannelSelectionTestChannel(t, &model.Channel{Id: 4, Name: "fixture", Models: "gpt-test", BaseURL: common.GetPointer(upstream.URL)})
	peer, server, cleanup := newTestWebSocketPair(t)
	defer cleanup()
	c := newResponsesWSAffinityContext()
	c.Set("id", 1)
	common.SetContextKey(c, constant.ContextKeyUserId, 1)
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = responsesWebSocketHelper(c, server, responsesWSHeartbeatConfig{}, func(request *http.Request, requestID string, handle func(*gin.Context) *types.NewAPIError) *types.NewAPIError {
			ctx := newResponsesWSAffinityContext()
			ctx.Request = request
			ctx.Set("id", 1)
			ctx.Set(common.RequestIdKey, requestID)
			common.SetContextKey(ctx, constant.ContextKeyUserId, 1)
			return handle(ctx)
		})
	}()
	defer func() { _ = peer.Close(); <-done }()
	readEvent := func() string {
		t.Helper()
		require.NoError(t, peer.SetReadDeadline(time.Now().Add(5*time.Second)))
		_, body, err := peer.ReadMessage()
		require.NoError(t, err)
		return string(body)
	}
	for turn := 1; turn <= 2; turn++ {
		require.NoError(t, peer.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"gpt-test","input":"synthetic"}`)))
		require.Contains(t, readEvent(), "response.created")
		assert.Contains(t, string(<-frames), "response.create")
		if turn == 1 {
			control := []byte(`{"type":"response.interrupt","response_id":"resp_1","mode":"discard_partial_items"}`)
			require.NoError(t, peer.WriteMessage(websocket.TextMessage, control))
			// This exercises the public read loop, control queue and upstream worker.
			require.Contains(t, readEvent(), "response.interrupt.accepted")
			assert.JSONEq(t, string(control), string(<-frames))
			reply := readEvent()
			assert.Contains(t, reply, "response.incomplete")
			assert.Contains(t, reply, `"total_tokens":5`)
		} else {
			assert.Contains(t, readEvent(), "response.completed")
		}
	}
	// A control with no active generation must still be rejected locally.
	require.NoError(t, peer.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.interrupt","response_id":"resp_2"}`)))
	assert.Contains(t, readEvent(), "unsupported websocket event")
}
