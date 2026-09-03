package relay

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	appconstant "github.com/QuantumNous/new-api/constant"
	appmodel "github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestNormalizeResponsesWSCreateEventWrapper(t *testing.T) {
	message := []byte(`{
		"type": "response.create",
		"event_id": "evt_1",
		"generate": false,
		"response": {
			"model": "gpt-5.3-codex-spark",
			"input": "hi",
			"store": false,
			"stream": true,
			"stream_options": {"include_usage": true}
		}
	}`)

	create, eventID, err := normalizeResponsesWSCreateEvent(message)
	require.NoError(t, err)
	req := create.Request
	assert.Equal(t, "evt_1", eventID)
	assert.Equal(t, "gpt-5.3-codex-spark", req.Model)
	assert.Equal(t, "false", strings.TrimSpace(string(create.Generate)))
	assert.Nil(t, req.Stream)
	assert.Nil(t, req.StreamOptions)
	assert.Equal(t, "false", strings.TrimSpace(string(req.Store)))
}

func TestNormalizeResponsesWSCreateEventFlat(t *testing.T) {
	message := []byte(`{
		"type": "response.create",
		"event_id": "evt_2",
		"model": "gpt-5.3-codex-spark",
		"input": "hi",
		"generate": false,
		"stream": true,
		"background": true,
		"stream_options": {"include_usage": true}
	}`)

	create, eventID, err := normalizeResponsesWSCreateEvent(message)
	require.NoError(t, err)
	req := create.Request
	assert.Equal(t, "evt_2", eventID)
	assert.Equal(t, "gpt-5.3-codex-spark", req.Model)
	assert.Equal(t, "false", strings.TrimSpace(string(create.Generate)))
	assert.Nil(t, req.Stream)
	assert.Nil(t, req.StreamOptions)
}

func TestBuildResponsesWSCreateEventIsFlat(t *testing.T) {
	payload := []byte(`{
		"model": "gpt-5.3-codex-spark",
		"input": "hi",
		"store": false,
		"event_id": "evt_upstream",
		"stream": true,
		"background": true,
		"stream_options": {"include_usage": true}
	}`)

	got, err := buildResponsesWSCreateEvent(payload, common.RawMessage(`false`))
	require.NoError(t, err)
	var data map[string]any
	require.NoError(t, common.Unmarshal(got, &data))
	assert.Equal(t, responsesWSEventTypeResponseCreate, data["type"])
	assert.Equal(t, "gpt-5.3-codex-spark", data["model"])
	assert.Equal(t, "hi", data["input"])
	assert.Equal(t, false, data["store"])
	assert.Equal(t, false, data["generate"])
	for _, key := range []string{"response", "event_id", "stream", "background", "stream_options"} {
		assert.NotContains(t, data, key, "field %q should not be present in upstream event", key)
	}
}

func TestHTTPResponsesRequestDoesNotMarshalGenerate(t *testing.T) {
	var req dto.OpenAIResponsesRequest
	require.NoError(t, common.Unmarshal([]byte(`{"model":"gpt-5.3-codex-spark","input":"hi","generate":false}`), &req))
	got, err := common.Marshal(req)
	require.NoError(t, err)
	var data map[string]any
	require.NoError(t, common.Unmarshal(got, &data))
	assert.NotContains(t, data, "generate", "generate leaked into HTTP request JSON: %s", got)
}

func TestBuildResponsesWSErrorPayloadIncludesStatus(t *testing.T) {
	payload, err := buildResponsesWSErrorPayload("evt_err", types.NewErrorWithStatusCode(
		errors.New("model is required"),
		types.ErrorCodeInvalidRequest,
		http.StatusBadRequest,
		types.ErrOptionWithSkipRetry(),
	))
	require.NoError(t, err)
	var data struct {
		Type    string             `json:"type"`
		Status  int                `json:"status"`
		EventID string             `json:"event_id"`
		Error   *types.OpenAIError `json:"error"`
	}
	require.NoError(t, common.Unmarshal(payload, &data))
	assert.Equal(t, "error", data.Type)
	assert.Equal(t, http.StatusBadRequest, data.Status)
	assert.Equal(t, "evt_err", data.EventID)
	require.NotNil(t, data.Error)
	assert.Equal(t, string(types.ErrorCodeInvalidRequest), data.Error.Code)
}

func TestResponsesWSInvalidRequestErrorUsesBadRequestStatus(t *testing.T) {
	payload, err := buildResponsesWSErrorPayload("", newResponsesWSInvalidRequestError(errors.New("bad event")))
	require.NoError(t, err)
	var data struct {
		Status int `json:"status"`
	}
	require.NoError(t, common.Unmarshal(payload, &data))
	assert.Equal(t, http.StatusBadRequest, data.Status)
}

func TestRemoveResponsesWSTransportFields(t *testing.T) {
	payload := []byte(`{
		"model": "gpt-5.3-codex-spark",
		"stream": true,
		"background": true,
		"stream_options": {"include_usage": true},
		"store": false
	}`)

	got, err := removeResponsesWSTransportFields(payload)
	require.NoError(t, err)
	var data map[string]any
	require.NoError(t, common.Unmarshal(got, &data))
	for _, key := range []string{"stream", "background", "stream_options"} {
		assert.NotContains(t, data, key, "transport field %q still present in %s", key, got)
	}
	assert.Equal(t, false, data["store"])
}

func TestToWebSocketURL(t *testing.T) {
	tests := map[string]string{
		"https://api.openai.com/v1/responses":             "wss://api.openai.com/v1/responses",
		"http://127.0.0.1:3000/v1/responses":              "ws://127.0.0.1:3000/v1/responses",
		"wss://chatgpt.com/backend-api/codex/responses":   "wss://chatgpt.com/backend-api/codex/responses",
		"ws://127.0.0.1:3000/backend-api/codex/responses": "ws://127.0.0.1:3000/backend-api/codex/responses",
	}

	for input, want := range tests {
		assert.Equal(t, want, toWebSocketURL(input), "toWebSocketURL(%q)", input)
	}
}

func TestHandleTargetWriteFailureWithStateReleasesCurrentAndClearsTarget(t *testing.T) {
	target, cleanup := newTestResponsesWSTarget(t)
	defer cleanup()

	var committed *bool
	session := &responsesWSSession{target: target}
	state := &responsesWSCallState{
		info: &relaycommon.RelayInfo{},
		commitRate: func(success bool) {
			committed = &success
		},
	}
	session.current = state

	apiErr := session.handleTargetWriteFailureWithState(state, errors.New("write failed"))

	require.NotNil(t, apiErr)
	assert.Nil(t, session.target, "target was not cleared")
	assert.Nil(t, session.getCurrent(), "current response was not released")
	require.NotNil(t, committed, "commit was not invoked")
	assert.False(t, *committed)
}

func TestHandleControlEventWriteFailureSendsResponsesError(t *testing.T) {
	clientConn, serverConn, cleanupClient := newTestWebSocketPair(t)
	defer cleanupClient()
	target, cleanupTarget := newTestResponsesWSTarget(t)
	defer cleanupTarget()

	session := &responsesWSSession{
		client: serverConn,
		target: target,
	}
	apiErr := session.handleControlEventWriteFailure(errors.New("write failed"))
	require.Nil(t, apiErr)
	assert.Nil(t, session.target, "target was not cleared")

	require.NoError(t, clientConn.SetReadDeadline(time.Now().Add(time.Second)))
	_, payload, err := clientConn.ReadMessage()
	require.NoError(t, err)
	var data struct {
		Type   string `json:"type"`
		Status int    `json:"status"`
	}
	require.NoError(t, common.Unmarshal(payload, &data))
	assert.Equal(t, "error", data.Type)
	assert.NotZero(t, data.Status)
}

func TestResponsesWSModelChangeClosesTargetAndClearsLock(t *testing.T) {
	target, targetPeer, cleanup := newTestWebSocketPair(t)
	defer cleanup()

	unregistered := false
	session := &responsesWSSession{
		target:        target,
		unregister:    func() { unregistered = true },
		lockedModel:   "gpt-5.6-sol",
		lockedChannel: &appmodel.Channel{Id: 1},
	}

	previousChannelID := session.resetTargetForModelChange("gpt-5.6-terra")

	assert.Equal(t, 1, previousChannelID)
	assert.Nil(t, session.getTarget())
	assert.Empty(t, session.lockedModel)
	assert.Nil(t, session.lockedChannel)
	assert.True(t, unregistered)
	require.NoError(t, targetPeer.SetReadDeadline(time.Now().Add(time.Second)))
	_, _, err := targetPeer.ReadMessage()
	assert.Error(t, err, "the previous upstream websocket should be closed")
}

func TestResponsesWSSameModelKeepsTargetAndLock(t *testing.T) {
	target, cleanup := newTestResponsesWSTarget(t)
	defer cleanup()
	channel := &appmodel.Channel{Id: 1}
	session := &responsesWSSession{
		target:        target,
		lockedModel:   "gpt-5.6-sol",
		lockedChannel: channel,
	}

	previousChannelID := session.resetTargetForModelChange("gpt-5.6-sol")

	assert.Zero(t, previousChannelID)
	assert.Same(t, target, session.getTarget())
	assert.Equal(t, "gpt-5.6-sol", session.lockedModel)
	assert.Same(t, channel, session.lockedChannel)
}

func setupResponsesWSChannelSelectionTest(t *testing.T) {
	t.Helper()
	originalDB := appmodel.DB
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	require.NoError(t, err)
	appmodel.DB = db
	common.MemoryCacheEnabled = true
	require.NoError(t, appmodel.DB.AutoMigrate(&appmodel.Channel{}, &appmodel.Ability{}))
	t.Cleanup(func() {
		appmodel.DB = originalDB
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
		if originalDB != nil && originalMemoryCacheEnabled {
			appmodel.InitChannelCache()
		}
	})
}

func addResponsesWSChannelSelectionTestChannel(t *testing.T, channel *appmodel.Channel) {
	t.Helper()
	channel.Status = common.ChannelStatusEnabled
	channel.Type = appconstant.ChannelTypeCodex
	channel.Key = "test-key"
	channel.Group = "default"
	channel.Priority = common.GetPointer[int64](100)
	channel.Weight = common.GetPointer[uint](100)
	require.NoError(t, appmodel.DB.Create(channel).Error)
	require.NoError(t, channel.AddAbilities(nil))
	appmodel.InitChannelCache()
}

func newResponsesWSChannelSelectionContext() *gin.Context {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/v1/responses", nil)
	common.SetContextKey(c, appconstant.ContextKeyUsingGroup, "default")
	return c
}

func TestSelectResponsesWSChannelPrefersPreviousChannelForNewModel(t *testing.T) {
	setupResponsesWSChannelSelectionTest(t)
	addResponsesWSChannelSelectionTestChannel(t, &appmodel.Channel{Id: 4, Name: "CPA", Models: "gpt-old,gpt-new"})
	addResponsesWSChannelSelectionTestChannel(t, &appmodel.Channel{Id: 13, Name: "Krill", Models: "gpt-new"})

	c := newResponsesWSChannelSelectionContext()
	retryParam := &service.RetryParam{
		Ctx:                c,
		TokenGroup:         "default",
		ModelName:          "gpt-new",
		RequestPath:        "/v1/responses",
		ResponsesTransport: appconstant.ResponsesTransportWebSocket,
		Retry:              common.GetPointer(0),
	}

	channel, apiErr := selectResponsesWSChannel(c, "gpt-new", retryParam, 4)
	require.Nil(t, apiErr)
	require.NotNil(t, channel)
	assert.Equal(t, 4, channel.Id)
}

func TestSelectResponsesWSChannelFallsBackWhenPreviousChannelLacksNewModel(t *testing.T) {
	setupResponsesWSChannelSelectionTest(t)
	addResponsesWSChannelSelectionTestChannel(t, &appmodel.Channel{Id: 4, Name: "CPA", Models: "gpt-old"})
	addResponsesWSChannelSelectionTestChannel(t, &appmodel.Channel{Id: 13, Name: "Krill", Models: "gpt-new"})

	c := newResponsesWSChannelSelectionContext()
	retryParam := &service.RetryParam{
		Ctx:                c,
		TokenGroup:         "default",
		ModelName:          "gpt-new",
		RequestPath:        "/v1/responses",
		ResponsesTransport: appconstant.ResponsesTransportWebSocket,
		Retry:              common.GetPointer(0),
	}

	channel, apiErr := selectResponsesWSChannel(c, "gpt-new", retryParam, 4)
	require.Nil(t, apiErr)
	require.NotNil(t, channel)
	assert.Equal(t, 13, channel.Id)
}

func TestResponsesWSModelChangeWhileResponseActiveKeepsTarget(t *testing.T) {
	target, cleanup := newTestResponsesWSTarget(t)
	defer cleanup()
	state := &responsesWSCallState{}
	session := &responsesWSSession{
		target:      target,
		lockedModel: "gpt-5.6-sol",
		current:     state,
	}

	apiErr := session.handleResponseCreate(responsesWSCreateRequest{
		Request: dto.OpenAIResponsesRequest{Model: "gpt-5.6-terra"},
	}, "evt-switch")

	require.NotNil(t, apiErr)
	assert.Equal(t, http.StatusConflict, apiErr.StatusCode)
	assert.Same(t, target, session.getTarget())
	assert.Equal(t, "gpt-5.6-sol", session.lockedModel)
	assert.Same(t, state, session.getCurrent())
}

// TestFinalizeResponsesWSUsageBillsInterruptedStream pins the billing policy
// for a stream that never reached its terminal event — the client disconnected,
// upstream died, or the idle timeout fired. Upstream already generated (and
// charged us for) that output, so it must be billable from the observed delta
// text, not refunded in full.
func TestFinalizeResponsesWSUsageBillsInterruptedStream(t *testing.T) {
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "claude-sonnet-4"}}
	info.SetEstimatePromptTokens(123)
	state := &responsesWSCallState{info: info, usage: &dto.Usage{}}
	state.outputText.WriteString("partial answer streamed before the client vanished")

	require.True(t, finalizeResponsesWSUsage(state), "generated output must be billable")
	assert.Positive(t, state.usage.CompletionTokens, "completion tokens should be counted from observed output")
	assert.Equal(t, 123, state.usage.PromptTokens, "prompt tokens should fall back to the pre-consume estimate")
	assert.Equal(t, state.usage.PromptTokens+state.usage.CompletionTokens, state.usage.TotalTokens)
}

func TestFinalizeResponsesWSUsageReportsNothingBillableWithoutOutput(t *testing.T) {
	state := &responsesWSCallState{
		info:  &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "claude-sonnet-4"}},
		usage: &dto.Usage{},
	}

	assert.False(t, finalizeResponsesWSUsage(state), "a call that produced nothing must stay refundable")
}

// TestFinishCallAbortedRefundsDespiteObservedOutput guards the other side of the
// policy: when the request never reached upstream there is nothing to pay for,
// even if stale state carries text.
func TestFinishCallAbortedRefundsDespiteObservedOutput(t *testing.T) {
	var committed *bool
	session := &responsesWSSession{}
	state := &responsesWSCallState{
		info:  &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "claude-sonnet-4"}},
		usage: &dto.Usage{},
		commitRate: func(success bool) {
			committed = &success
		},
	}
	state.outputText.WriteString("never sent upstream")
	session.current = state

	session.finishCall(state, responsesWSCallAborted, true)

	assert.Nil(t, session.getCurrent(), "current response was not released")
	require.NotNil(t, committed, "commit was not invoked")
	assert.False(t, *committed, "an aborted call must not be committed as a successful request")
}

// TestApplyTerminalResponseUsageRecordsFailedResponseUsage covers the fix for
// terminal failure events: upstream reports real usage on response.failed, and
// discarding it meant billing nothing for output the provider already charged.
func TestApplyTerminalResponseUsageRecordsFailedResponseUsage(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	session := &responsesWSSession{c: c}
	state := &responsesWSCallState{
		info:  &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "claude-sonnet-4"}},
		usage: &dto.Usage{},
	}

	session.applyTerminalResponseUsage(state, &dto.OpenAIResponsesResponse{
		Usage: &dto.Usage{InputTokens: 40, OutputTokens: 9, TotalTokens: 49},
	})

	assert.Equal(t, 40, state.usage.PromptTokens)
	assert.Equal(t, 9, state.usage.CompletionTokens)
}

func TestResponsesWSSlotCapEvictsLeastRecentlyUsedIdleSession(t *testing.T) {
	resetResponsesWSSlotsForTest(t, 2)

	const userId = 4242
	oldIdle := &responsesWSSession{}
	oldIdle.lastActivity.Store(10)
	active := &responsesWSSession{}
	active.lastActivity.Store(5)
	active.activityState.Store(responsesWSSessionActive)
	incoming := &responsesWSSession{}
	incoming.lastActivity.Store(30)

	evicted, acquired := acquireResponsesWSSlot(userId, oldIdle)
	require.True(t, acquired)
	assert.Nil(t, evicted)
	evicted, acquired = acquireResponsesWSSlot(userId, active)
	require.True(t, acquired)
	assert.Nil(t, evicted)
	otherUser := &responsesWSSession{}
	evicted, acquired = acquireResponsesWSSlot(userId+1, otherUser)
	require.True(t, acquired, "connection cap must remain scoped per user")
	assert.Nil(t, evicted)

	evicted, acquired = acquireResponsesWSSlot(userId, incoming)
	require.True(t, acquired)
	assert.Same(t, oldIdle, evicted, "oldest idle session should be replaced before an active session")
	assert.Equal(t, responsesWSSessionEvicting, oldIdle.activityState.Load())

	responsesWSSlotMu.Lock()
	assert.ElementsMatch(t, []*responsesWSSession{active, incoming}, responsesWSSlots[userId])
	responsesWSSlotMu.Unlock()

	releaseResponsesWSSlot(userId, active)
	releaseResponsesWSSlot(userId, incoming)
	releaseResponsesWSSlot(userId+1, otherUser)
	responsesWSSlotMu.Lock()
	assert.Empty(t, responsesWSSlots)
	responsesWSSlotMu.Unlock()
}

func TestResponsesWSSlotCapRejectsWhenEverySessionIsActive(t *testing.T) {
	resetResponsesWSSlotsForTest(t, 2)

	const userId = 4242
	first := &responsesWSSession{}
	first.activityState.Store(responsesWSSessionActive)
	second := &responsesWSSession{}
	second.activityState.Store(responsesWSSessionActive)
	incoming := &responsesWSSession{}

	_, acquired := acquireResponsesWSSlot(userId, first)
	require.True(t, acquired)
	_, acquired = acquireResponsesWSSlot(userId, second)
	require.True(t, acquired)
	evicted, acquired := acquireResponsesWSSlot(userId, incoming)
	assert.False(t, acquired)
	assert.Nil(t, evicted)

	responsesWSSlotMu.Lock()
	assert.ElementsMatch(t, []*responsesWSSession{first, second}, responsesWSSlots[userId])
	responsesWSSlotMu.Unlock()
}

func TestResponsesWSSlotEvictionClosesReplacedSession(t *testing.T) {
	resetResponsesWSSlotsForTest(t, 1)

	clientPeer, client, cleanup := newTestWebSocketPair(t)
	defer cleanup()
	oldIdle := &responsesWSSession{client: client}
	oldIdle.lastActivity.Store(10)
	incoming := &responsesWSSession{}
	incoming.lastActivity.Store(20)

	_, acquired := acquireResponsesWSSlot(4242, oldIdle)
	require.True(t, acquired)
	evicted, acquired := acquireResponsesWSSlot(4242, incoming)
	require.True(t, acquired)
	require.Same(t, oldIdle, evicted)

	evicted.closeForReplacement()
	require.NoError(t, clientPeer.SetReadDeadline(time.Now().Add(time.Second)))
	_, _, err := clientPeer.ReadMessage()
	var closeErr *websocket.CloseError
	require.ErrorAs(t, err, &closeErr)
	assert.Equal(t, websocket.CloseGoingAway, closeErr.Code)
	assert.Equal(t, responsesWSReplacedCloseReason, closeErr.Text)
}

func resetResponsesWSSlotsForTest(t *testing.T, maxPerUser int) {
	t.Helper()
	responsesWSSlotMu.Lock()
	originalMax := responsesWSMaxPerUser
	originalSlots := responsesWSSlots
	responsesWSMaxPerUser = maxPerUser
	responsesWSSlots = map[int][]*responsesWSSession{}
	responsesWSSlotMu.Unlock()
	t.Cleanup(func() {
		responsesWSSlotMu.Lock()
		responsesWSMaxPerUser = originalMax
		responsesWSSlots = originalSlots
		responsesWSSlotMu.Unlock()
	})
}

func TestObserveUpstreamFailedReleasesCurrent(t *testing.T) {
	var committed *bool
	session := &responsesWSSession{}
	session.activityState.Store(responsesWSSessionActive)
	state := &responsesWSCallState{
		info: &relaycommon.RelayInfo{},
		commitRate: func(success bool) {
			committed = &success
		},
	}
	session.current = state

	finished := session.observeUpstreamMessage([]byte(`{"type":"response.failed"}`))

	assert.True(t, finished)
	assert.Nil(t, session.getCurrent(), "current response was not released")
	assert.Equal(t, responsesWSSessionActive, session.activityState.Load(), "session must stay protected until the terminal event reaches the client")
	require.NotNil(t, committed, "commit was not invoked")
	assert.False(t, *committed)
	session.markIdle()
	assert.Equal(t, responsesWSSessionIdle, session.activityState.Load())
}

func TestResponsesWSPongKeepsNetworkAlive(t *testing.T) {
	clientPeer, client, cleanup := newTestWebSocketPair(t)
	defer cleanup()
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())

	done := make(chan *types.NewAPIError, 1)
	go func() {
		done <- responsesWebSocketHelper(ctx, client, responsesWSHeartbeatConfig{
			pingInterval: 10 * time.Millisecond,
			pongTimeout:  40 * time.Millisecond,
		})
	}()

	clientReadDone := make(chan error, 1)
	go func() {
		_, _, err := clientPeer.ReadMessage()
		clientReadDone <- err
	}()
	time.Sleep(100 * time.Millisecond)
	select {
	case apiErr := <-done:
		t.Fatalf("heartbeat connection closed while Pong frames were arriving: %v", apiErr)
	default:
	}

	require.NoError(t, clientPeer.WriteControl(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, "done"),
		time.Now().Add(time.Second),
	))
	select {
	case apiErr := <-done:
		assert.Nil(t, apiErr)
	case <-time.After(time.Second):
		t.Fatal("responses WebSocket helper did not stop after client close")
	}
	select {
	case <-clientReadDone:
	case <-time.After(time.Second):
		t.Fatal("client reader did not stop")
	}
}

func TestResponsesWSHeartbeatTimeoutClosesClientWithoutPong(t *testing.T) {
	clientPeer, client, cleanup := newTestWebSocketPair(t)
	defer cleanup()
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	clientPeer.SetPingHandler(func(string) error { return nil })

	done := make(chan *types.NewAPIError, 1)
	go func() {
		done <- responsesWebSocketHelper(ctx, client, responsesWSHeartbeatConfig{
			pingInterval: 10 * time.Millisecond,
			pongTimeout:  45 * time.Millisecond,
		})
	}()

	require.NoError(t, clientPeer.SetReadDeadline(time.Now().Add(time.Second)))
	_, _, err := clientPeer.ReadMessage()
	var closeErr *websocket.CloseError
	require.ErrorAs(t, err, &closeErr)
	assert.Equal(t, websocket.CloseGoingAway, closeErr.Code)
	assert.Equal(t, relaycommon.WebSocketHeartbeatCloseReason, closeErr.Text)
	select {
	case apiErr := <-done:
		assert.Nil(t, apiErr)
	case <-time.After(time.Second):
		t.Fatal("responses WebSocket helper did not stop after heartbeat timeout")
	}
}

func TestResponsesWSPongDoesNotRefreshBusinessIdleTimeout(t *testing.T) {
	clientPeer, client, cleanup := newTestWebSocketPair(t)
	defer cleanup()
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())

	done := make(chan *types.NewAPIError, 1)
	go func() {
		done <- responsesWebSocketHelper(ctx, client, responsesWSHeartbeatConfig{
			idleTimeout:  60 * time.Millisecond,
			pingInterval: 10 * time.Millisecond,
			pongTimeout:  200 * time.Millisecond,
		})
	}()

	require.NoError(t, clientPeer.SetReadDeadline(time.Now().Add(time.Second)))
	_, _, err := clientPeer.ReadMessage()
	var closeErr *websocket.CloseError
	require.ErrorAs(t, err, &closeErr)
	assert.Equal(t, websocket.CloseGoingAway, closeErr.Code)
	assert.Equal(t, relaycommon.WebSocketIdleCloseReason, closeErr.Text)
	select {
	case apiErr := <-done:
		assert.Nil(t, apiErr)
	case <-time.After(time.Second):
		t.Fatal("responses WebSocket helper did not stop after business idle timeout")
	}
}

func TestResponsesWSIdleTimeoutClosesConnection(t *testing.T) {
	clientPeer, client, cleanup := newTestWebSocketPair(t)
	defer cleanup()
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())

	done := make(chan *types.NewAPIError, 1)
	go func() {
		done <- responsesWebSocketHelper(ctx, client, responsesWSHeartbeatConfig{
			idleTimeout: 25 * time.Millisecond,
		})
	}()

	require.NoError(t, clientPeer.SetReadDeadline(time.Now().Add(time.Second)))
	_, _, err := clientPeer.ReadMessage()
	var closeErr *websocket.CloseError
	require.ErrorAs(t, err, &closeErr)
	assert.Equal(t, websocket.CloseGoingAway, closeErr.Code)
	assert.Equal(t, relaycommon.WebSocketIdleCloseReason, closeErr.Text)
	select {
	case apiErr := <-done:
		assert.Nil(t, apiErr)
	case <-time.After(time.Second):
		t.Fatal("responses WebSocket helper did not stop after idle timeout")
	}
}

func TestResponsesWSForwardsUpstreamClose(t *testing.T) {
	tests := []struct {
		name   string
		code   int
		reason string
	}{
		{name: "normal closure", code: websocket.CloseNormalClosure, reason: "done"},
		{name: "message too big", code: websocket.CloseMessageTooBig, reason: "request exceeds upstream limit"},
		{name: "service restart", code: websocket.CloseServiceRestart, reason: "upstream requires HTTP replay"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			clientPeer, client, cleanupClient := newTestWebSocketPair(t)
			defer cleanupClient()
			targetPeer, target, cleanupTarget := newTestWebSocketPair(t)
			defer cleanupTarget()
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())

			session := &responsesWSSession{c: ctx, client: client, target: target}
			session.startTargetReader()

			require.NoError(t, targetPeer.WriteControl(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(tt.code, tt.reason),
				time.Now().Add(time.Second),
			))
			require.NoError(t, clientPeer.SetReadDeadline(time.Now().Add(time.Second)))
			_, _, err := clientPeer.ReadMessage()
			var closeErr *websocket.CloseError
			require.ErrorAs(t, err, &closeErr)
			assert.Equal(t, tt.code, closeErr.Code)
			assert.Equal(t, tt.reason, closeErr.Text)
		})
	}
}

func TestResponsesWSDoesNotSendSyntheticAbnormalClose(t *testing.T) {
	clientPeer, client, cleanupClient := newTestWebSocketPair(t)
	defer cleanupClient()
	targetPeer, target, cleanupTarget := newTestWebSocketPair(t)
	defer cleanupTarget()
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())

	session := &responsesWSSession{c: ctx, client: client, target: target}
	session.startTargetReader()
	require.NoError(t, targetPeer.Close())

	require.NoError(t, clientPeer.SetReadDeadline(time.Now().Add(time.Second)))
	_, _, err := clientPeer.ReadMessage()
	var closeErr *websocket.CloseError
	require.ErrorAs(t, err, &closeErr)
	assert.Equal(t, websocket.CloseAbnormalClosure, closeErr.Code)
}

func newTestResponsesWSTarget(t *testing.T) (*websocket.Conn, func()) {
	t.Helper()
	target, _, cleanup := newTestWebSocketPair(t)
	return target, cleanup
}

func newTestWebSocketPair(t *testing.T) (*websocket.Conn, *websocket.Conn, func()) {
	t.Helper()
	upgrader := websocket.Upgrader{}
	serverConnCh := make(chan *websocket.Conn, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrade websocket: %v", err)
			return
		}
		serverConnCh <- conn
	}))

	targetURL := "ws" + strings.TrimPrefix(server.URL, "http")
	target, _, err := websocket.DefaultDialer.Dial(targetURL, nil)
	if err != nil {
		server.Close()
		t.Fatalf("dial websocket: %v", err)
	}
	serverConn := <-serverConnCh
	cleanup := func() {
		_ = target.Close()
		_ = serverConn.Close()
		server.Close()
	}
	return target, serverConn, cleanup
}
