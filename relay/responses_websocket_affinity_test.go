package relay

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	appconstant "github.com/QuantumNous/new-api/constant"
	appmodel "github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupResponsesWSAffinityTest(t *testing.T) {
	t.Helper()
	setting := operation_setting.GetChannelAffinitySetting()
	original := *setting
	originalRedis := common.RedisEnabled
	common.RedisEnabled = false
	*setting = operation_setting.ChannelAffinitySetting{
		Enabled: true, SwitchOnSuccess: true, DefaultTTLSeconds: 3600,
		Rules: []operation_setting.ChannelAffinityRule{{
			Name: t.Name(), ModelRegex: []string{"^gpt-"}, PathRegex: []string{"/v1/responses"},
			KeySources:      []operation_setting.ChannelAffinityKeySource{{Type: "gjson", Path: "prompt_cache_key"}},
			IncludeRuleName: true, IncludeUsingGroup: true, SessionMode: "prefer",
			ParamOverrideTemplate: map[string]interface{}{"metadata": map[string]interface{}{"affinity_test": "applied"}},
		}},
	}
	t.Cleanup(func() {
		_, err := service.ClearChannelAffinityCacheByRuleName(t.Name())
		require.NoError(t, err)
		*setting = original
		common.RedisEnabled = originalRedis
	})
}

func newResponsesWSAffinityContext() *gin.Context {
	c := newResponsesWSChannelSelectionContext()
	c.Request.Header.Set("Upgrade", "websocket")
	common.SetContextKey(c, appconstant.ContextKeyTokenGroup, "default")
	return c
}

// This fixture runs the merged serial request worker against real local sockets.
// The callback supplies the same already-authenticated account context for each
// turn; controller tests separately cover the public auth/rate-limit runner.
func newResponsesWSWorkerFixture(t *testing.T, client *websocket.Conn) (*responsesWSSession, *atomic.Pointer[gin.Context]) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	latest := &atomic.Pointer[gin.Context]{}
	s := &responsesWSSession{ctx: ctx, cancel: cancel, client: client, request: httptest.NewRequest(http.MethodGet, "/v1/responses", nil), requestID: t.Name()}
	s.request.Header.Set("Upgrade", "websocket")
	s.runner = func(request *http.Request, requestID string, handle func(*gin.Context) *types.NewAPIError) *types.NewAPIError {
		c := newResponsesWSAffinityContext()
		c.Set("id", 1)
		c.Request = request
		c.Set(common.RequestIdKey, requestID)
		common.SetContextKey(c, appconstant.ContextKeyUserId, 1)
		latest.Store(c)
		apiErr := handle(c)
		if apiErr != nil {
			t.Logf("worker error: %s", apiErr.Error())
		}
		return apiErr
	}
	t.Cleanup(func() { s.shutdown(); s.workers.Wait() })
	return s, latest
}

func submitResponsesWSWorkerFixture(t *testing.T, s *responsesWSSession, body string) <-chan struct{} {
	t.Helper()
	envelope, streamID, err := parseResponsesWSEnvelope([]byte(body))
	require.NoError(t, err)
	state := &responsesWSCallState{streamID: streamID, inbox: make(chan responsesWSMessage), controls: make(chan responsesWSControl, 1), done: make(chan struct{})}
	require.True(t, s.tryReserveCurrent(state))
	requestID := fmt.Sprintf("%s-%d", t.Name(), s.nextEventIndex)
	s.nextEventIndex++
	s.workers.Go(func() { s.runRequest(state, []byte(body), envelope, streamID, requestID) })
	return state.done
}

func setupResponsesWSWorkerTest(t *testing.T) {
	t.Helper()
	setupResponsesWSChannelSelectionTest(t)
	originalRedis := common.RedisEnabled
	common.RedisEnabled = false
	t.Cleanup(func() { common.RedisEnabled = originalRedis })
	originalLogDB := appmodel.LOG_DB
	appmodel.LOG_DB = appmodel.DB
	t.Cleanup(func() { appmodel.LOG_DB = originalLogDB })
	require.NoError(t, appmodel.DB.AutoMigrate(&appmodel.Log{}))
	require.NoError(t, appmodel.DB.AutoMigrate(&appmodel.User{}, &appmodel.UserSubscription{}))
	require.NoError(t, appmodel.DB.Create(&appmodel.User{Id: 1, Username: "ws-worker-user", Role: common.RoleCommonUser, Status: common.UserStatusEnabled}).Error)
	originalRatios := ratio_setting.ModelRatio2JSONString()
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"gpt-test":0,"gpt-other":0}`))
	originalFree := operation_setting.GetQuotaSetting().EnableFreeModelPreConsume
	operation_setting.GetQuotaSetting().EnableFreeModelPreConsume = false
	originalCount := appconstant.CountToken
	appconstant.CountToken = false
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(originalRatios))
		operation_setting.GetQuotaSetting().EnableFreeModelPreConsume = originalFree
		appconstant.CountToken = originalCount
	})
}

func readResponsesWSTerminal(t *testing.T, peer *websocket.Conn, done <-chan struct{}) map[string]any {
	t.Helper()
	require.NoError(t, peer.SetReadDeadline(time.Now().Add(5*time.Second)))
	var event map[string]any
	for {
		_, body, err := peer.ReadMessage()
		require.NoError(t, err)
		require.NoError(t, common.Unmarshal(body, &event))
		kind, _ := event["type"].(string)
		if kind == "error" || kind == "response.completed" || kind == "response.done" || kind == "response.failed" || kind == "response.cancelled" || kind == "response.incomplete" {
			break
		}
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("request worker did not release the completed turn")
	}
	return event
}

func TestResponsesWSAffinityRecordsOnlyCompletedRequests(t *testing.T) {
	setupResponsesWSWorkerTest(t)
	setupResponsesWSAffinityTest(t)
	upgrader := websocket.Upgrader{}
	reply := make(chan string, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if !assert.NoError(t, err) {
			return
		}
		defer conn.Close()
		if _, _, err = conn.ReadMessage(); err == nil {
			_ = conn.WriteMessage(websocket.TextMessage, []byte(<-reply))
		}
	}))
	defer upstream.Close()
	channel := &appmodel.Channel{Id: 4, Name: "fixture", Models: "gpt-test", BaseURL: common.GetPointer(upstream.URL)}
	addResponsesWSChannelSelectionTestChannel(t, channel)
	for _, tc := range []struct {
		name, event string
		want        bool
	}{
		{"completed", `{"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":0,"output_tokens":0}}}`, true},
		{"legacy done", `{"type":"response.done","response":{"status":"completed","usage":{"input_tokens":0,"output_tokens":0}}}`, true},
		{"failed", `{"type":"response.failed","response":{"status":"failed"}}`, false},
		{"cancelled", `{"type":"response.cancelled","response":{"status":"cancelled"}}`, false},
		{"incomplete", `{"type":"response.incomplete","response":{"status":"incomplete"}}`, false},
		{"error", `{"type":"error","error":{"message":"failed"}}`, false},
		{"error in done", `{"type":"response.done","response":{"status":"failed","error":{"message":"failed"}}}`, false},
		{"missing response", `{"type":"response.completed"}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			peer, client, cleanup := newTestWebSocketPair(t)
			defer cleanup()
			s, _ := newResponsesWSWorkerFixture(t, client)
			body, err := common.Marshal(map[string]any{"type": "response.create", "model": "gpt-test", "prompt_cache_key": tc.name, "input": "hi"})
			require.NoError(t, err)
			reply <- tc.event
			done := submitResponsesWSWorkerFixture(t, s, string(body))
			readResponsesWSTerminal(t, peer, done)
			id, found := service.GetPreferredChannelByAffinityWithBody(newResponsesWSAffinityContext(), "gpt-test", "default", body)
			assert.Equal(t, tc.want, found)
			if tc.want {
				assert.Equal(t, 4, id)
			}
		})
	}
}

func TestResponsesWSAffinityAcrossConnectionsAndFrames(t *testing.T) {
	setupResponsesWSWorkerTest(t)
	setupResponsesWSAffinityTest(t)
	upgrader := websocket.Upgrader{}
	received := make(chan []byte, 16)
	firstResponse := make(chan struct{})
	var firstReply sync.Once
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if !assert.NoError(t, err) {
			return
		}
		defer conn.Close()
		for {
			_, body, err := conn.ReadMessage()
			if err != nil {
				return
			}
			received <- body
			firstReply.Do(func() { <-firstResponse })
			if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":0,"output_tokens":0}}}`)); err != nil {
				return
			}
		}
	}))
	defer upstream.Close()
	defer func() {
		select {
		case <-firstResponse:
		default:
			close(firstResponse)
		}
	}()
	first := &appmodel.Channel{Id: 4, Name: "first", Models: "gpt-test,gpt-other", BaseURL: common.GetPointer(upstream.URL)}
	addResponsesWSChannelSelectionTestChannel(t, first)
	first.Type = appconstant.ChannelTypeOpenAI
	first.Key = "fixture-key-a\nfixture-key-b"
	first.ChannelInfo = appmodel.ChannelInfo{IsMultiKey: true, MultiKeySize: 2, MultiKeyMode: appconstant.MultiKeyModePolling}
	require.NoError(t, appmodel.DB.Save(first).Error)
	appmodel.InitChannelCache()
	peer, client, cleanup := newTestWebSocketPair(t)
	defer cleanup()
	session, _ := newResponsesWSWorkerFixture(t, client)
	body := `{"type":"response.create","model":"gpt-test","prompt_cache_key":"thread-a","input":"hi"}`
	done := submitResponsesWSWorkerFixture(t, session, body)
	<-received
	_, found := service.GetPreferredChannelByAffinityWithBody(newResponsesWSAffinityContext(), "gpt-test", "default", []byte(body))
	assert.False(t, found, "dial/send must not bind before completion")
	close(firstResponse)
	readResponsesWSTerminal(t, peer, done)
	assert.Equal(t, 4, session.lockedChannelID)
	second := &appmodel.Channel{Id: 13, Name: "second", Models: "gpt-test,gpt-other", BaseURL: common.GetPointer(upstream.URL)}
	addResponsesWSChannelSelectionTestChannel(t, second)
	require.NoError(t, appmodel.DB.Model(second).Updates(map[string]any{"type": appconstant.ChannelTypeOpenAI, "priority": 200}).Error)
	appmodel.InitChannelCache()
	peer2, client2, cleanup2 := newTestWebSocketPair(t)
	defer cleanup2()
	reconnected, latest := newResponsesWSWorkerFixture(t, client2)
	done = submitResponsesWSWorkerFixture(t, reconnected, `{"type":"response.create","response":{"model":"gpt-test","prompt_cache_key":"thread-a","input":"again"}}`)
	readResponsesWSTerminal(t, peer2, done)
	<-received
	assert.Equal(t, 4, reconnected.lockedChannelID, "reconnect must honor affinity over priority")
	target, credential := reconnected.getTarget(), reconnected.lockedKey
	other := newResponsesWSAffinityContext()
	service.GetPreferredChannelByAffinityWithBody(other, "gpt-test", "default", []byte(`{"prompt_cache_key":"thread-b"}`))
	service.RecordChannelAffinity(other, 13)
	for _, tc := range []struct {
		name, body   string
		wantAffinity bool
	}{
		{"same conversation", `{"type":"response.create","model":"gpt-test","prompt_cache_key":"thread-a","previous_response_id":"resp-1","input":[]}`, true},
		{"different conversation", `{"type":"response.create","model":"gpt-test","prompt_cache_key":"thread-b","input":"new"}`, true},
		{"no key", `{"type":"response.create","model":"gpt-test","input":"unbound"}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			done := submitResponsesWSWorkerFixture(t, reconnected, tc.body)
			event := readResponsesWSTerminal(t, peer2, done)
			require.NotEqual(t, "error", event["type"])
			payload := <-received
			assert.Same(t, target, reconnected.getTarget())
			assert.Equal(t, credential, reconnected.lockedKey)
			other := appmodel.NewLogOther()
			service.AppendChannelAffinityAdminInfo(latest.Load(), other)
			var log map[string]any
			require.NoError(t, common.Unmarshal([]byte(other.JSONString()), &log))
			admin, _ := log["admin_info"].(map[string]any)
			assert.Equal(t, tc.wantAffinity, admin["channel_affinity"] != nil)
			var sent map[string]any
			require.NoError(t, common.Unmarshal(payload, &sent))
			if tc.wantAffinity {
				assert.Contains(t, sent, "metadata")
			} else {
				assert.NotContains(t, sent, "metadata")
			}
		})
	}
	done = submitResponsesWSWorkerFixture(t, reconnected, `{"type":"response.create","model":"gpt-other","prompt_cache_key":"thread-a","input":"switch"}`)
	event := readResponsesWSTerminal(t, peer2, done)
	require.NotEqual(t, "error", event["type"])
	<-received
	assert.Equal(t, 4, reconnected.lockedChannelID)
	assert.NotSame(t, target, reconnected.getTarget())
	require.NoError(t, appmodel.DB.Model(first).Update("status", common.ChannelStatusManuallyDisabled).Error)
	appmodel.InitChannelCache()
	c := newResponsesWSAffinityContext()
	retry := &service.RetryParam{Ctx: c, TokenGroup: "default", ModelName: "gpt-test", ResponsesTransport: appconstant.ResponsesTransportWebSocket}
	selected, apiErr := selectResponsesWSChannel(c, "gpt-test", retry)
	require.Nil(t, apiErr)
	assert.Equal(t, 13, selected.Id)
}
