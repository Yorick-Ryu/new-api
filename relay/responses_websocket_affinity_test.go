package relay

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	appconstant "github.com/QuantumNous/new-api/constant"
	appmodel "github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
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
			IncludeRuleName: true, IncludeUsingGroup: true, SkipRetryOnFailure: true,
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

func TestResponsesWSAffinityRecordsOnlyCompletedRequests(t *testing.T) {
	setupResponsesWSAffinityTest(t)
	for _, tc := range []struct {
		name, event string
		wantBound   bool
	}{
		{"completed", `{"type":"response.completed","response":{"status":"completed"}}`, true},
		{"legacy done", `{"type":"response.done","response":{"status":"completed"}}`, true},
		{"failed", `{"type":"response.failed","response":{"status":"failed"}}`, false},
		{"cancelled", `{"type":"response.cancelled","response":{"status":"cancelled"}}`, false},
		{"incomplete", `{"type":"response.incomplete","response":{"status":"incomplete"}}`, false},
		{"error", `{"type":"error","error":{"message":"upstream failed"}}`, false},
		{"error in done", `{"type":"response.done","response":{"status":"failed","error":{"message":"failed"}}}`, false},
		{"missing response", `{"type":"response.completed"}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body, err := common.Marshal(map[string]string{"prompt_cache_key": tc.name})
			require.NoError(t, err)
			c := newResponsesWSAffinityContext()
			_, found := service.GetPreferredChannelByAffinityWithBody(c, "gpt-test", "default", body)
			require.False(t, found)
			common.SetContextKey(c, appconstant.ContextKeyChannelId, 4)
			session := &responsesWSSession{c: c, current: &responsesWSCallState{
				info: &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelId: 4}}, usage: &dto.Usage{},
			}}
			require.True(t, session.observeUpstreamMessage([]byte(tc.event)))
			reconnected := newResponsesWSAffinityContext()
			channelID, found := service.GetPreferredChannelByAffinityWithBody(reconnected, "gpt-test", "default", body)
			assert.Equal(t, tc.wantBound, found)
			if tc.wantBound {
				assert.Equal(t, 4, channelID)
			}
		})
	}
}

func TestResponsesWSAffinityAcrossConnectionsAndFrames(t *testing.T) {
	setupResponsesWSChannelSelectionTest(t)
	setupResponsesWSAffinityTest(t)
	// Exercise the real prepare/dial/send path without charging an account or
	// making model requests. The mock returns completed, zero-usage responses.
	originalRatios := ratio_setting.ModelRatio2JSONString()
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"gpt-test":0,"gpt-other":0}`))
	originalFreePreConsume := operation_setting.GetQuotaSetting().EnableFreeModelPreConsume
	operation_setting.GetQuotaSetting().EnableFreeModelPreConsume = false
	originalCountToken := appconstant.CountToken
	appconstant.CountToken = false
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(originalRatios))
		operation_setting.GetQuotaSetting().EnableFreeModelPreConsume = originalFreePreConsume
		appconstant.CountToken = originalCountToken
	})

	upgrader := websocket.Upgrader{}
	received := make(chan []byte, 8)
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
			if err := conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.completed","response":{"status":"completed"}}`)); err != nil {
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
	// Use polling API keys so an accidental credential reselection on an open
	// connection would be observable.
	first.Type = appconstant.ChannelTypeOpenAI
	first.Key = "fixture-key-a\nfixture-key-b"
	first.ChannelInfo = appmodel.ChannelInfo{IsMultiKey: true, MultiKeySize: 2, MultiKeyMode: appconstant.MultiKeyModePolling}
	require.NoError(t, appmodel.DB.Save(first).Error)
	appmodel.InitChannelCache()

	peer, client, cleanup := newTestWebSocketPair(t)
	defer cleanup()
	session := &responsesWSSession{c: newResponsesWSAffinityContext(), client: client}
	defer session.closeTarget()
	create, _, err := normalizeResponsesWSCreateEvent([]byte(`{"type":"response.create","model":"gpt-test","prompt_cache_key":"thread-a","input":"hi"}`))
	require.NoError(t, err)
	require.Nil(t, session.handleResponseCreate(create, ""))
	_, boundBeforeCompletion := service.GetPreferredChannelByAffinityWithBody(newResponsesWSAffinityContext(), "gpt-test", "default", create.Body)
	assert.False(t, boundBeforeCompletion, "dialing and sending must not bind a channel before upstream success")
	close(firstResponse)
	require.NoError(t, peer.SetReadDeadline(time.Now().Add(5*time.Second)))
	_, _, err = peer.ReadMessage()
	require.NoError(t, err)
	<-received
	assert.Equal(t, 4, session.lockedChannel.Id)

	// A new, higher-priority channel proves that subsequent selection follows
	// the binding, rather than coincidentally choosing the same channel.
	second := &appmodel.Channel{Id: 13, Name: "second", Models: "gpt-test,gpt-other", BaseURL: common.GetPointer(upstream.URL)}
	addResponsesWSChannelSelectionTestChannel(t, second)
	require.NoError(t, appmodel.DB.Model(second).Updates(map[string]interface{}{"type": appconstant.ChannelTypeOpenAI, "priority": 200}).Error)
	appmodel.InitChannelCache()

	peer2, client2, cleanup2 := newTestWebSocketPair(t)
	defer cleanup2()
	reconnected := &responsesWSSession{c: newResponsesWSAffinityContext(), client: client2}
	defer reconnected.closeTarget()
	wrapped, _, err := normalizeResponsesWSCreateEvent([]byte(`{"type":"response.create","response":{"model":"gpt-test","prompt_cache_key":"thread-a","input":"again"}}`))
	require.NoError(t, err)
	require.Nil(t, reconnected.handleResponseCreate(wrapped, ""))
	require.NoError(t, peer2.SetReadDeadline(time.Now().Add(5*time.Second)))
	_, _, err = peer2.ReadMessage()
	require.NoError(t, err)
	<-received
	assert.Equal(t, 4, reconnected.lockedChannel.Id, "reconnect should prefer the previous channel over higher priority")
	info := map[string]interface{}{}
	service.AppendChannelAffinityAdminInfo(reconnected.c, info)
	require.Contains(t, info, "channel_affinity")
	affinity := info["channel_affinity"].(map[string]interface{})
	assert.Equal(t, 4, affinity["channel_id"])
	assert.EqualValues(t, "websocket", affinity["transport"])

	target := reconnected.getTarget()
	credential := common.GetContextKeyString(reconnected.c, appconstant.ContextKeyChannelKey)
	otherContext := newResponsesWSAffinityContext()
	service.GetPreferredChannelByAffinityWithBody(otherContext, "gpt-test", "default", []byte(`{"prompt_cache_key":"thread-b"}`))
	service.RecordChannelAffinity(otherContext, 13)
	for _, tc := range []struct {
		name, message string
		wantAffinity  bool
	}{
		{"same conversation", `{"type":"response.create","model":"gpt-test","prompt_cache_key":"thread-a","previous_response_id":"resp-1","input":[]}`, true},
		{"different conversation", `{"type":"response.create","model":"gpt-test","prompt_cache_key":"thread-b","input":"new"}`, true},
		{"no key", `{"type":"response.create","model":"gpt-test","input":"unbound"}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			frame, _, err := normalizeResponsesWSCreateEvent([]byte(tc.message))
			require.NoError(t, err)
			require.Nil(t, reconnected.handleResponseCreate(frame, ""))
			require.NoError(t, peer2.SetReadDeadline(time.Now().Add(5*time.Second)))
			_, _, err = peer2.ReadMessage()
			require.NoError(t, err)
			payload := <-received
			assert.Same(t, target, reconnected.getTarget(), "continuations keep the open socket")
			assert.Equal(t, credential, common.GetContextKeyString(reconnected.c, appconstant.ContextKeyChannelKey))
			adminInfo := map[string]interface{}{}
			service.AppendChannelAffinityAdminInfo(reconnected.c, adminInfo)
			assert.Equal(t, tc.wantAffinity, adminInfo["channel_affinity"] != nil)
			var sent map[string]interface{}
			require.NoError(t, common.Unmarshal(payload, &sent))
			if tc.wantAffinity {
				assert.Contains(t, sent, "metadata", "current frame gets the affinity template")
			} else {
				assert.NotContains(t, sent, "metadata", "a frame without a key must not inherit the prior template")
			}
			if tc.name == "different conversation" {
				bound, found := service.GetPreferredChannelByAffinityWithBody(newResponsesWSAffinityContext(), "gpt-test", "default", frame.Body)
				require.True(t, found)
				assert.Equal(t, 4, bound, "successful reuse updates this frame's binding to the actual channel")
			}
		})
	}

	// A model switch keeps the existing logical channel and re-evaluates the
	// frame's binding. A disabled bound channel must fall back normally.
	switched, _, err := normalizeResponsesWSCreateEvent([]byte(`{"type":"response.create","model":"gpt-other","prompt_cache_key":"thread-a","input":"switch"}`))
	require.NoError(t, err)
	require.Nil(t, reconnected.handleResponseCreate(switched, ""))
	require.NoError(t, peer2.SetReadDeadline(time.Now().Add(5*time.Second)))
	_, _, err = peer2.ReadMessage()
	require.NoError(t, err)
	<-received
	assert.Equal(t, 4, reconnected.lockedChannel.Id)
	assert.NotSame(t, target, reconnected.getTarget())
	require.NoError(t, appmodel.DB.Model(first).Update("status", common.ChannelStatusManuallyDisabled).Error)
	appmodel.InitChannelCache()
	c := newResponsesWSAffinityContext()
	retry := &service.RetryParam{Ctx: c, TokenGroup: "default", ModelName: "gpt-test", ResponsesTransport: appconstant.ResponsesTransportWebSocket}
	selected, apiErr := selectResponsesWSChannel(c, "gpt-test", retry, 0, create.Body)
	require.Nil(t, apiErr)
	assert.Equal(t, 13, selected.Id)
}
