package relay

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
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
	// Unknown responses must still be rejected locally.
	require.NoError(t, peer.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.interrupt","response_id":"unknown"}`)))
	assert.Contains(t, readEvent(), `"status":400`)
}

// A completed response can still appear active to a client processing buffered
// output. Its late interrupt must not fail or interrupt the following response.
func TestCodexLateInterruptAndContinue(t *testing.T) {
	for _, terminal := range []string{"response.completed", "response.done", "response.incomplete", "response.failed", "response.cancelled", "response.canceled"} {
		status := strings.TrimPrefix(terminal, "response.")
		if terminal == "response.done" {
			status = "completed"
		}
		if terminal == "response.canceled" {
			status = "cancelled"
		}
		for _, duringNext := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/next_active=%t", terminal, duringNext), func(t *testing.T) {
				setupResponsesWSWorkerTest(t)
				frames := make(chan string, 3)
				upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
					if !assert.NoError(t, err) {
						return
					}
					defer conn.Close()
					for turn := 1; turn <= 2; turn++ {
						_, body, err := conn.ReadMessage()
						if err != nil {
							return
						}
						frames <- string(body)
						if err := conn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf(`{"type":"response.created","response":{"id":"r%d","status":"in_progress"}}`, turn))); err != nil {
							return
						}
						if turn == 1 {
							if err := conn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf(`{"type":%q,"response":{"id":"r1","status":%q,"output":[],"usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5}}}`, terminal, status))); err != nil {
								return
							}
							continue
						}
						_, body, err = conn.ReadMessage()
						if err != nil {
							return
						}
						frames <- string(body)
						_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.incomplete","response":{"id":"r2","status":"incomplete","incomplete_details":{"reason":"interrupted"},"output":[],"usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5}}}`))
					}
					_, _, _ = conn.ReadMessage()
				}))
				t.Cleanup(upstream.Close)
				addResponsesWSChannelSelectionTestChannel(t, &model.Channel{Id: 4, Name: "fixture", Models: "gpt-test", BaseURL: common.GetPointer(upstream.URL)})
				peer := newCodexInterruptTestSession(t, nil)
				readEvent := func() map[string]any {
					t.Helper()
					_, body, err := peer.ReadMessage()
					require.NoError(t, err)
					var event map[string]any
					require.NoError(t, common.Unmarshal(body, &event))
					return event
				}
				create := `{"type":"response.create","model":"gpt-test","input":"synthetic","stream_id":"lane1"}`
				require.NoError(t, peer.WriteMessage(websocket.TextMessage, []byte(create)))
				require.Equal(t, "response.created", readEvent()["type"])
				require.Equal(t, terminal, readEvent()["type"])
				late := `{"type":"response.interrupt","response_id":"r1","stream_id":"lane1","mode":"discard_partial_items"}`
				if !duringNext {
					require.NoError(t, peer.WriteMessage(websocket.TextMessage, []byte(late)))
				}
				require.NoError(t, peer.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"gpt-test","input":"follow-up","stream_id":"lane2"}`)))
				require.Equal(t, "response.created", readEvent()["type"], "a late control must not leave an error for the next create")
				if duringNext {
					require.NoError(t, peer.WriteMessage(websocket.TextMessage, []byte(late)))
				}
				active := `{"type":"response.interrupt","response_id":"r2","mode":"discard_partial_items","extension":"preserved"}`
				require.NoError(t, peer.WriteMessage(websocket.TextMessage, []byte(active)))
				require.Equal(t, "response.incomplete", readEvent()["type"])
				assert.Contains(t, <-frames, `"type":"response.create"`)
				assert.Contains(t, <-frames, `"type":"response.create"`)
				assert.JSONEq(t, active, <-frames, "only the active response's interrupt reaches upstream")
			})
		}
	}
}

func TestCodexInterruptRejectsInvalidTargets(t *testing.T) {
	setupResponsesWSWorkerTest(t)
	forwarded := make(chan string, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if !assert.NoError(t, err) {
			return
		}
		defer conn.Close()
		if _, _, err := conn.ReadMessage(); err != nil {
			return
		}
		if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.created","response":{"id":"active","status":"in_progress"}}`)); err != nil {
			return
		}
		_, control, err := conn.ReadMessage()
		if err != nil {
			return
		}
		forwarded <- string(control)
		_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.incomplete","response":{"id":"active","status":"incomplete","incomplete_details":{"reason":"interrupted"},"usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5}}}`))
		_, _, _ = conn.ReadMessage()
	}))
	t.Cleanup(upstream.Close)
	addResponsesWSChannelSelectionTestChannel(t, &model.Channel{Id: 4, Name: "fixture", Models: "gpt-test", BaseURL: common.GetPointer(upstream.URL)})
	peer := newCodexInterruptTestSession(t, nil)
	require.NoError(t, peer.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"gpt-test","input":"synthetic"}`)))
	_, created, err := peer.ReadMessage()
	require.NoError(t, err)
	require.Contains(t, string(created), "response.created")
	for _, fields := range []string{
		``, `,"response_id":null`, `,"response_id":42`, `,"response_id":" "`,
		`,"response_id":"unknown"`, `,"response_id":"active","stream_id":"wrong-lane"`,
	} {
		payload := `{"type":"response.interrupt","event_id":"invalid-control"` + fields + `}`
		require.NoError(t, peer.WriteMessage(websocket.TextMessage, []byte(payload)))
		_, body, err := peer.ReadMessage()
		require.NoError(t, err)
		var event responsesWSErrorEvent
		require.NoError(t, common.Unmarshal(body, &event))
		require.Equal(t, "error", event.Type)
		assert.Equal(t, http.StatusBadRequest, event.Status)
		assert.Equal(t, "invalid-control", event.EventID)
	}
	valid := `{"type":"response.interrupt","response_id":"active","mode":"discard_partial_items"}`
	require.NoError(t, peer.WriteMessage(websocket.TextMessage, []byte(valid)))
	_, terminal, err := peer.ReadMessage()
	require.NoError(t, err)
	require.Contains(t, string(terminal), "response.incomplete")
	assert.JSONEq(t, valid, <-forwarded)
	// A new downstream session must not inherit another session's terminal IDs.
	other := newCodexInterruptTestSession(t, nil)
	require.NoError(t, other.WriteMessage(websocket.TextMessage, []byte(valid)))
	_, rejected, err := other.ReadMessage()
	require.NoError(t, err)
	assert.Contains(t, string(rejected), `"status":400`)
}

func TestCodexLateInterruptBeforeCompletionDelivery(t *testing.T) {
	setupResponsesWSWorkerTest(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if !assert.NoError(t, err) {
			return
		}
		defer conn.Close()
		for turn := 1; turn <= 2; turn++ {
			_, body, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if !assert.Contains(t, string(body), `"type":"response.create"`) {
				return
			}
			for _, kind := range []string{"response.created", "response.completed"} {
				status := "in_progress"
				if kind == "response.completed" {
					status = "completed"
				}
				body := fmt.Sprintf(`{"type":%q,"response":{"id":"r%d","status":%q,"output":[],"usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5}}}`, kind, turn, status)
				if err := conn.WriteMessage(websocket.TextMessage, []byte(body)); err != nil {
					return
				}
			}
		}
		_, _, _ = conn.ReadMessage()
	}))
	t.Cleanup(upstream.Close)
	addResponsesWSChannelSelectionTestChannel(t, &model.Channel{Id: 4, Name: "fixture", Models: "gpt-test", BaseURL: common.GetPointer(upstream.URL)})
	settled, release := make(chan struct{}), make(chan struct{})
	var holdOnce, releaseOnce sync.Once
	peer := newCodexInterruptTestSession(t, func() {
		holdOnce.Do(func() { close(settled); <-release })
	})
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
	create := []byte(`{"type":"response.create","model":"gpt-test","input":"synthetic"}`)
	require.NoError(t, peer.WriteMessage(websocket.TextMessage, create))
	_, created, err := peer.ReadMessage()
	require.NoError(t, err)
	require.Contains(t, string(created), "response.created")
	select {
	case <-settled:
	case <-time.After(5 * time.Second):
		t.Fatal("upstream response did not finish")
	}
	// Hold the completion downstream while sending duplicate late interrupts.
	// The explicit barrier proves the reader processed both without using sleeps.
	for range 2 {
		require.NoError(t, peer.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.interrupt","response_id":"r1"}`)))
	}
	require.NoError(t, peer.WriteMessage(websocket.TextMessage, []byte(`{"type":"test.barrier","event_id":"barrier"}`)))
	_, barrier, err := peer.ReadMessage()
	require.NoError(t, err)
	var event responsesWSErrorEvent
	require.NoError(t, common.Unmarshal(barrier, &event))
	require.Equal(t, "barrier", event.EventID, "late interrupts must not emit a stray error even before terminal delivery")
	releaseOnce.Do(func() { close(release) })
	_, terminal, err := peer.ReadMessage()
	require.NoError(t, err)
	require.Contains(t, string(terminal), "response.completed")
	require.NoError(t, peer.WriteMessage(websocket.TextMessage, create))
	for _, expected := range []string{"response.created", "response.completed"} {
		_, body, err := peer.ReadMessage()
		require.NoError(t, err)
		require.Contains(t, string(body), expected)
	}
}

func TestCodexControlWaitsForResponseIdentity(t *testing.T) {
	for _, tc := range []struct {
		name, control string
		rejected      bool
	}{
		{"interrupt", `{"type":"response.interrupt","response_id":"active","mode":"discard_partial_items"}`, false},
		{"unknown interrupt", `{"type":"response.interrupt","response_id":"unknown","event_id":"unknown-control"}`, true},
		{"cancel", `{"type":"response.cancel","event_id":"cancel-control"}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			setupResponsesWSWorkerTest(t)
			release := make(chan struct{})
			var releaseOnce sync.Once
			forwarded := make(chan string, 1)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				conn, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
				if !assert.NoError(t, err) {
					return
				}
				defer conn.Close()
				if _, _, err := conn.ReadMessage(); err != nil {
					return
				}
				<-release
				if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.created","response":{"id":"active","status":"in_progress"}}`)); err != nil {
					return
				}
				_, control, err := conn.ReadMessage()
				if err != nil {
					return
				}
				forwarded <- string(control)
				_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.incomplete","response":{"id":"active","status":"incomplete","output":[],"usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5}}}`))
				_, _, _ = conn.ReadMessage()
			}))
			t.Cleanup(upstream.Close)
			addResponsesWSChannelSelectionTestChannel(t, &model.Channel{Id: 4, Name: "fixture", Models: "gpt-test", BaseURL: common.GetPointer(upstream.URL)})
			peer := newCodexInterruptTestSession(t, nil)
			t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })
			require.NoError(t, peer.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"gpt-test","input":"synthetic"}`)))
			require.NoError(t, peer.WriteMessage(websocket.TextMessage, []byte(tc.control)))
			// The barrier confirms the control was accepted before created was sent.
			require.NoError(t, peer.WriteMessage(websocket.TextMessage, []byte(`{"type":"test.barrier","event_id":"barrier"}`)))
			_, body, err := peer.ReadMessage()
			require.NoError(t, err)
			var barrier responsesWSErrorEvent
			require.NoError(t, common.Unmarshal(body, &barrier))
			require.Equal(t, "barrier", barrier.EventID)
			releaseOnce.Do(func() { close(release) })
			_, body, err = peer.ReadMessage()
			require.NoError(t, err)
			require.Contains(t, string(body), `"type":"response.created"`)
			expected := tc.control
			if tc.rejected {
				_, body, err = peer.ReadMessage()
				require.NoError(t, err)
				var rejection responsesWSErrorEvent
				require.NoError(t, common.Unmarshal(body, &rejection))
				require.Equal(t, http.StatusBadRequest, rejection.Status)
				require.Equal(t, "unknown-control", rejection.EventID)
				expected = `{"type":"response.interrupt","response_id":"active"}`
				require.NoError(t, peer.WriteMessage(websocket.TextMessage, []byte(expected)))
			}
			_, body, err = peer.ReadMessage()
			require.NoError(t, err)
			require.Contains(t, string(body), `"type":"response.incomplete"`)
			assert.JSONEq(t, expected, <-forwarded, "an unknown early interrupt must not reach upstream")
		})
	}
}

func newCodexInterruptTestSession(t *testing.T, afterCall func()) *websocket.Conn {
	t.Helper()
	peer, server, cleanup := newTestWebSocketPair(t)
	t.Cleanup(cleanup)
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
			err := handle(ctx)
			if afterCall != nil {
				afterCall()
			}
			return err
		})
	}()
	t.Cleanup(func() {
		_ = peer.Close()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Error("websocket session did not shut down")
		}
	})
	require.NoError(t, peer.SetReadDeadline(time.Now().Add(5*time.Second)))
	return peer
}
