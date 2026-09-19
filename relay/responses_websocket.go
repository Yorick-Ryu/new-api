package relay

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"reflect"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	appconstant "github.com/QuantumNous/new-api/constant"
	appdto "github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	appmodel "github.com/QuantumNous/new-api/model"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	"github.com/QuantumNous/new-api/pkg/wsmanager"
	relaychannel "github.com/QuantumNous/new-api/relay/channel"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

const responsesWSEventTypeResponseCreate = "response.create"
const responsesWSWriteTimeout = 30 * time.Second

// ResponsesWSRequestRunner executes the existing authentication and rate-limit
// middleware around one complete request, without a second HTTP connection.
// Compress substantial responses while avoiding deflate overhead for small deltas.
const responsesWSCompressionMinBytes = 1 << 10

// responsesWSMaxMessageBytes bounds one inbound WebSocket message. The HTTP
// body limit does not cover WebSocket frames, so without it a valid key can
// stream unbounded data into memory. It follows MAX_REQUEST_BODY_MB so the same
// payload is accepted over both transports of /v1/responses, and only diverges
// when WEBSOCKET_MAX_MESSAGE_MB is set explicitly.
//
// Read lazily: constant.MaxRequestBodyMB is populated by InitEnv from main, so
// a package-level var here would capture zero.
//
// Gorilla's SetReadLimit bounds the wire length. The client reader also limits
// decompressed bytes so negotiated compression cannot bypass this bound.
func responsesWSMaxMessageBytes() int64 {
	maxMB := common.GetEnvOrDefault("WEBSOCKET_MAX_MESSAGE_MB", 0)
	if maxMB <= 0 {
		maxMB = appconstant.MaxRequestBodyMB
	}
	if maxMB <= 0 {
		maxMB = 32
	}
	return int64(maxMB) << 20
}

// responsesWSMaxPerUser caps concurrent Responses WebSocket sessions per user;
// 0 disables the cap. Idle sessions hold a goroutine, a socket and an upstream
// connection for up to WEBSOCKET_IDLE_TIMEOUT_MINUTES.
var responsesWSMaxPerUser = common.GetEnvOrDefault("RESPONSES_WEBSOCKET_MAX_PER_USER", 8)

var (
	responsesWSSlotMu sync.Mutex
	responsesWSSlots  = map[int][]*responsesWSSession{}
)

const (
	responsesWSSessionIdle uint32 = iota
	responsesWSSessionActive
	responsesWSSessionEvicting
)

const responsesWSReplacedCloseReason = "replaced by a newer websocket connection"

type ResponsesWSRequestRunner func(*http.Request, string, func(*gin.Context) *types.NewAPIError) *types.NewAPIError

type responsesWSCreateEvent struct {
	Type     string            `json:"type"`
	EventID  string            `json:"event_id,omitempty"`
	StreamID common.RawMessage `json:"stream_id,omitempty"`
	Generate common.RawMessage `json:"generate,omitempty"`
	Request  common.RawMessage `json:"response,omitempty"`
}

type responsesWSCreateRequest struct {
	Request  dto.OpenAIResponsesRequest
	Body     []byte
	Generate common.RawMessage
	StreamID string
}

type responsesWSErrorEvent struct {
	Type       string             `json:"type"`
	Status     int                `json:"status"`
	EventID    string             `json:"event_id,omitempty"`
	StreamID   string             `json:"stream_id,omitempty"`
	ResponseID string             `json:"response_id,omitempty"`
	Error      *types.OpenAIError `json:"error"`
}

type responsesWSMessage struct {
	target *websocket.Conn
	kind   int
	body   []byte
	err    error
}

// responsesWSControl is a client control event (response.cancel) whose
// envelope the read loop already parsed.
type responsesWSControl struct {
	body              []byte
	eventID, streamID string
}

// Only the request worker reads or changes billing state. Socket readers pass
// bounded messages to it; cancellation never performs an independent refund.
type responsesWSCallState struct {
	inbox       chan responsesWSMessage
	controls    chan responsesWSControl
	done        chan struct{}
	terminal    *responsesWSMessage
	closeAfter  bool
	closeCode   int
	closeReason string
	streamID    string
}

type responsesWSSession struct {
	ctx                context.Context
	cancel             context.CancelFunc
	client             *websocket.Conn
	runner             ResponsesWSRequestRunner
	request            *http.Request
	requestID          string
	nextEventIndex     int
	workers            sync.WaitGroup
	activityState      atomic.Uint32
	lastActivity       atomic.Int64
	lastPong           atomic.Int64
	heartbeat          responsesWSHeartbeatConfig
	heartbeatStop      chan struct{}
	heartbeatDone      chan struct{}
	heartbeatOnce      sync.Once
	heartbeatFailed    atomic.Bool
	closeOnce          sync.Once
	lastControlEventID string

	clientWriteMu sync.Mutex
	targetWriteMu sync.Mutex
	connectionMu  sync.Mutex
	target        *websocket.Conn
	unregister    func()
	stateMu       sync.Mutex
	current       *responsesWSCallState

	// These fields belong to the serial request worker and describe the actual
	// established connection. Per-request token/user data is never stored here.
	lastResponseID  string
	lockedModel     string
	lockedChannelID int
	lockedGroup     string
	lockedKey       string
	lockedKeyIndex  int
	lockedContext   map[appconstant.ContextKey]any
	lockedRoute     dto.AdvancedCustomRoute
}

func ResponsesWebSocketHelper(c *gin.Context, client *websocket.Conn, runner ResponsesWSRequestRunner) *types.NewAPIError {
	return responsesWebSocketHelper(c, client, responsesWSHeartbeatConfig{
		idleTimeout: relaycommon.GetWebSocketIdleTimeout(), pingInterval: relaycommon.GetWebSocketPingInterval(), pongTimeout: relaycommon.GetWebSocketPongTimeout(),
	}, runner)
}

type responsesWSHeartbeatConfig struct{ idleTimeout, pingInterval, pongTimeout time.Duration }

func responsesWebSocketHelper(c *gin.Context, client *websocket.Conn, heartbeat responsesWSHeartbeatConfig, runner ResponsesWSRequestRunner) *types.NewAPIError {
	ctx, cancel := context.WithCancel(c.Request.Context())
	s := &responsesWSSession{ctx: ctx, cancel: cancel, client: client, runner: runner,
		request: c.Request.Clone(ctx), requestID: c.GetString(common.RequestIdKey)}
	if s.requestID == "" {
		s.requestID = common.NewRequestId()
	}
	s.heartbeatStop, s.heartbeatDone = make(chan struct{}), make(chan struct{})
	s.touchActivity()
	s.lastPong.Store(time.Now().UnixNano())
	userID := common.GetContextKeyInt(c, appconstant.ContextKeyUserId)
	if userID == 0 {
		userID = c.GetInt("id")
	}
	evicted, acquired := acquireResponsesWSSlot(userID, s)
	if !acquired {
		cancel()
		return types.NewErrorWithStatusCode(fmt.Errorf("too many concurrent responses websocket connections (limit %d)", responsesWSMaxPerUser), types.ErrorCodeInvalidRequest, http.StatusTooManyRequests, types.ErrOptionWithSkipRetry())
	}
	defer releaseResponsesWSSlot(userID, s)
	if evicted != nil {
		evicted.closeForReplacement()
	}
	maxMessageBytes := responsesWSMaxMessageBytes()
	client.SetReadLimit(maxMessageBytes)
	defer func() { s.shutdown(); s.workers.Wait() }()
	if err := s.startHeartbeat(heartbeat); err != nil {
		return types.NewError(err, types.ErrorCodeBadResponse, types.ErrOptionWithSkipRetry())
	}
	defer s.stopHeartbeat()

	for {
		_, reader, err := client.NextReader()
		var message []byte
		if err == nil {
			message, err = io.ReadAll(io.LimitReader(reader, maxMessageBytes+1))
			if int64(len(message)) > maxMessageBytes {
				err = websocket.ErrReadLimit
			}
		}
		if err != nil {
			if errors.Is(err, websocket.ErrReadLimit) {
				s.closeWithCode(websocket.CloseMessageTooBig, "websocket message exceeds size limit")
			} else if relaycommon.IsWebSocketIdleTimeout(err) {
				now := time.Now()
				if s.businessIdleExpired(now) {
					s.closeForIdleTimeout()
				} else if s.heartbeatExpired(now) {
					s.closeForHeartbeatTimeout()
				}
			}
			return nil
		}
		if err := s.markBusinessActivity(); err != nil {
			return types.NewError(err, types.ErrorCodeBadResponse, types.ErrOptionWithSkipRetry())
		}
		envelope, streamID, err := parseResponsesWSEnvelope(message)
		eventType := envelope.Type
		if err != nil {
			s.sendError(envelope.EventID, streamID, newResponsesWSInvalidRequestError(err))
			continue
		}
		if eventType != responsesWSEventTypeResponseCreate {
			// Controls are owned by the active request too. In particular a cancel
			// arriving during authentication must not precede its upstream create.
			state := s.getCurrent()
			if eventType != "response.cancel" || state == nil {
				s.sendError(envelope.EventID, streamID, newResponsesWSInvalidRequestError(fmt.Errorf("unsupported websocket event %q", eventType)))
				continue
			}
			if streamID != "" && streamID != state.streamID {
				s.sendError(envelope.EventID, streamID, newResponsesWSInvalidRequestError(errors.New("stream_id does not match the active response")))
				continue
			}
			select {
			case state.controls <- responsesWSControl{body: message, eventID: envelope.EventID, streamID: streamID}:
			case <-state.done:
			case <-s.ctx.Done():
				return nil
			default:
				s.sendError(envelope.EventID, streamID, newResponsesWSInvalidRequestError(errors.New("a response control event is already pending")))
			}
			continue
		}
		state := &responsesWSCallState{streamID: streamID, inbox: make(chan responsesWSMessage), controls: make(chan responsesWSControl, 1), done: make(chan struct{})}
		if !s.tryReserveCurrent(state) {
			s.sendError(envelope.EventID, streamID, types.NewErrorWithStatusCode(errors.New("another response.create is already in progress on this websocket connection"), types.ErrorCodeInvalidRequest, http.StatusConflict, types.ErrOptionWithSkipRetry()))
			continue
		}
		requestID := fmt.Sprintf("%s-ws-%d", s.requestID, s.nextEventIndex)
		s.nextEventIndex++
		s.workers.Go(func() { s.runRequest(state, message, envelope, streamID, requestID) })
	}
}

func (s *responsesWSSession) runRequest(state *responsesWSCallState, message []byte, envelope responsesWSCreateEvent, streamID string, requestID string) {
	create, parseErr := normalizeResponsesWSCreateEvent(message, envelope, streamID)
	var apiErr *types.NewAPIError
	defer func() {
		if recovered := recover(); recovered != nil {
			apiErr = types.NewError(fmt.Errorf("responses websocket request panic: %v", recovered), types.ErrorCodeBadResponse, types.ErrOptionWithSkipRetry())
			state.closeAfter = true
		}
		// Finish the middleware count before publishing the terminal event. Hold
		// admission while writing it so an immediate next create cannot race
		// the current request's release; socket close needs neither lock.
		outgoing := state.terminal
		if apiErr != nil {
			if body, err := buildResponsesWSErrorPayload(envelope.EventID, streamID, apiErr); err == nil {
				outgoing = &responsesWSMessage{kind: websocket.TextMessage, body: body}
			}
		}
		s.clientWriteMu.Lock()
		s.stateMu.Lock()
		if outgoing != nil {
			if err := s.client.SetWriteDeadline(time.Now().Add(responsesWSWriteTimeout)); err != nil {
				state.closeAfter = true
			} else {
				s.client.EnableWriteCompression(len(outgoing.body) >= responsesWSCompressionMinBytes)
				if err := s.client.WriteMessage(outgoing.kind, outgoing.body); err != nil {
					state.closeAfter = true
				}
				s.client.EnableWriteCompression(false)
			}
		}
		s.current = nil
		s.markIdle()
		close(state.done)
		s.stateMu.Unlock()
		s.clientWriteMu.Unlock()
		if state.closeAfter {
			if state.closeCode != 0 {
				s.closeWithCode(state.closeCode, state.closeReason)
			} else {
				s.shutdown()
			}
		}
	}()
	request := s.request.Clone(s.ctx)
	request.Body = io.NopCloser(bytes.NewReader(message))
	request.ContentLength = int64(len(message))
	request.Header.Set("Content-Type", "application/json")
	apiErr = s.runner(request, requestID, func(c *gin.Context) *types.NewAPIError {
		if parseErr != nil {
			return newResponsesWSInvalidRequestError(parseErr)
		}
		c.Request.Body = io.NopCloser(bytes.NewReader(create.Body))
		c.Request.ContentLength = int64(len(create.Body))
		return s.runCall(c, state, create)
	})
	if apiErr != nil && (apiErr.StatusCode == http.StatusUnauthorized || apiErr.StatusCode == http.StatusForbidden) {
		state.closeAfter = true
	}
}

func (s *responsesWSSession) runCall(c *gin.Context, state *responsesWSCallState, create responsesWSCreateRequest) (apiErr *types.NewAPIError) {
	service.BeginAutoBanRequest(c)
	policy := service.RequestPolicy(c)
	modelName := create.Request.Model
	started := time.Now()
	var info *relaycommon.RelayInfo
	billingPrepared := false
	defer func() {
		if recovered := recover(); recovered != nil {
			apiErr = types.NewError(fmt.Errorf("responses websocket call panic: %v", recovered), types.ErrorCodeBadResponse, types.ErrOptionWithSkipRetry())
			state.closeAfter = true
		}
		if info == nil && modelName != "" {
			info = &relaycommon.RelayInfo{OriginModelName: modelName, UsingGroup: common.GetContextKeyString(c, appconstant.ContextKeyUsingGroup), StartTime: started}
		}
		perfmetrics.RecordRelayResult(c.Request.Context(), info, apiErr)
		// Settlement already marks the request policy successful, and nothing
		// reads a termination decision after this point on the WebSocket path,
		// so neither policy record belongs here.
		if info != nil && billingPrepared {
			apiErr = RefundFailedRequestBilling(c, info, apiErr)
		}
	}()
	if modelName == "" {
		return newResponsesWSInvalidRequestError(errors.New("model is required"))
	}
	previousChannelID := s.resetTargetForModelChange(modelName)
	if apiErr = checkResponsesWSModelAccess(c, modelName); apiErr != nil {
		return apiErr
	}
	common.SetContextKey(c, appconstant.ContextKeyOriginalModel, modelName)
	common.SetContextKey(c, appconstant.ContextKeyRequestStartTime, time.Now())
	service.GetChannelConstraints(c).AddFilter(appdto.ChannelFilter{Kind: appdto.FilterRequestPath, RequestPath: c.Request.URL.Path})
	service.GetChannelConstraints(c).AddFilter(appdto.ChannelFilter{Kind: appdto.FilterResponsesTransport, ResponsesTransport: appconstant.ResponsesTransportWebSocket})
	service.GetPreferredChannelByAffinityWithBody(c, modelName, common.GetContextKeyString(c, appconstant.ContextKeyUsingGroup), create.Body)

	if s.lockedChannelID != 0 {
		if service.RequestPolicy(c).SessionMode == "strict" {
			if preferred, found := service.GetPreferredChannelByAffinity(c, modelName, common.GetContextKeyString(c, appconstant.ContextKeyUsingGroup)); found && preferred != s.lockedChannelID {
				return newResponsesWSInvalidRequestError(errors.New("strict_session_binding_unavailable"))
			}
		}
		service.MarkChannelAffinityUsed(c, s.lockedGroup, s.lockedChannelID)
		if apiErr = s.restoreConnectionContext(c, modelName); apiErr != nil {
			return apiErr
		}
		info = relaycommon.GenRelayInfoResponses(c, &create.Request)
		info.ClientWs = s.client
		info.IsStream = true
		common.SetContextKey(c, appconstant.ContextKeyIsStream, true)
		if apiErr = PrepareRequestBilling(c, info); apiErr != nil {
			return apiErr
		}
		billingPrepared = true
		var payload []byte
		payload, apiErr = buildResponsesWSCreatePayload(c, info, create.Request, create.Generate, create.StreamID)
		if apiErr != nil {
			return apiErr
		}
		if err := s.writeTarget(websocket.TextMessage, payload); err != nil {
			state.closeAfter = true
			return types.NewError(err, types.ErrorCodeBadResponse, types.ErrOptionWithSkipRetry())
		}
	} else {
		retry := &service.RetryParam{Ctx: c, TokenGroup: common.GetContextKeyString(c, appconstant.ContextKeyUsingGroup), ModelName: modelName, RequestPath: c.Request.URL.Path, Retry: common.GetPointer(0)}
		for ; retry.GetRetry() <= common.RetryTimes; retry.IncreaseRetry() {
			var channel *appmodel.Channel
			channel, apiErr = selectResponsesWSChannel(c, modelName, retry, previousChannelID)
			if apiErr != nil {
				return apiErr
			}
			service.AppendUsedChannel(c, channel.Id)
			if info == nil {
				info = relaycommon.GenRelayInfoResponses(c, &create.Request)
				info.ClientWs = s.client
				info.IsStream = true
				common.SetContextKey(c, appconstant.ContextKeyIsStream, true)
				if apiErr = PrepareRequestBilling(c, info); apiErr != nil {
					return apiErr
				}
				billingPrepared = true
			} else {
				info.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c, info)
				if apiErr = service.PrepareTieredBillingForSelectedGroup(c, info); apiErr != nil {
					return apiErr
				}
			}
			info.RetryIndex = retry.GetRetry()
			policy.BeginAttempt(channel, info.UsingGroup)
			var payload []byte
			payload, apiErr = buildResponsesWSCreatePayload(c, info, create.Request, create.Generate, create.StreamID)
			if apiErr != nil {
				return apiErr
			}
			adaptor := GetAdaptor(info.ApiType)
			adaptor.Init(info)
			target, dialErr := relaychannel.DoWssRequest(adaptor, c, info, nil)
			if dialErr != nil {
				apiErr = service.NormalizeViolationFeeError(types.NewError(dialErr, types.ErrorCodeDoRequestFailed))
				service.ResetStatusCode(apiErr, c.GetString("status_code_mapping"))
				info.LastError = apiErr
				decision := service.DecideRelayRetry(c, apiErr, common.RetryTimes-retry.GetRetry())
				service.RecordPolicyFailure(c, channel.Id, apiErr, decision)
				service.ProcessChannelError(c, *types.NewChannelError(channel.Id, channel.Type, channel.Name, channel.ChannelInfo.IsMultiKey, info.ApiKey, channel.GetAutoBan()), apiErr, info)
				if decision.Action == "retry" {
					continue
				}
				return apiErr
			}
			if !s.setTarget(target) {
				return types.NewError(context.Canceled, types.ErrorCodeBadResponse, types.ErrOptionWithSkipRetry())
			}
			if err := s.writeTarget(websocket.TextMessage, payload); err != nil {
				state.closeAfter = true
				return types.NewError(err, types.ErrorCodeBadResponse, types.ErrOptionWithSkipRetry())
			}
			s.lockedModel, s.lockedChannelID, s.lockedGroup = modelName, channel.Id, info.UsingGroup
			s.lockedKey, s.lockedKeyIndex = info.ApiKey, info.ChannelMultiKeyIndex
			s.lockedRoute, _ = channel.GetOtherSettings().AdvancedCustom.MatchPathForModel(c.Request.URL.Path, modelName)
			s.lockedContext = make(map[appconstant.ContextKey]any)
			for _, key := range []appconstant.ContextKey{
				appconstant.ContextKeyChannelId, appconstant.ContextKeyChannelName, appconstant.ContextKeyChannelType,
				appconstant.ContextKeyChannelCreateTime, appconstant.ContextKeyChannelSetting, appconstant.ContextKeyChannelOtherSetting,
				appconstant.ContextKeyChannelParamOverride, appconstant.ContextKeyChannelHeaderOverride, appconstant.ContextKeyChannelOrganization,
				appconstant.ContextKeyChannelAutoBan, appconstant.ContextKeyChannelModelMapping, appconstant.ContextKeyChannelStatusCodeMapping,
				appconstant.ContextKeyChannelIsMultiKey, appconstant.ContextKeyChannelMultiKeyIndex, appconstant.ContextKeyChannelKey, appconstant.ContextKeyChannelBaseUrl,
			} {
				if value, ok := c.Get(string(key)); ok {
					s.lockedContext[key] = value
				}
			}
			s.registerChannelClose(channel.Id)
			s.startTargetReader(target)
			apiErr = nil
			break
		}
		if apiErr != nil {
			return apiErr
		}
	}

	accumulator := service.NewResponsesUsageAccumulator(info)
	info.StreamStatus = relaycommon.NewStreamStatus()
	info.StreamStatus.RequireTerminal()
	common.SetContextKey(c, appconstant.ContextKeyResponseStreamStatus, info.StreamStatus)
	timeout := time.Duration(appconstant.StreamingTimeout) * time.Second
	if timeout <= 0 {
		timeout = 300 * time.Second
	}
	idle := time.NewTimer(timeout)
	defer idle.Stop()
	accepted := false
	var pendingControl []byte
	var sentControl []byte
	var responseID string
	for {
		select {
		case incoming := <-state.inbox:
			// An old reader may already be handing off its final frame when a
			// model switch replaces the physical upstream connection.
			if incoming.target != nil && !s.isTarget(incoming.target) {
				continue
			}
			idle.Reset(timeout)
			if incoming.err != nil {
				var closeErr *websocket.CloseError
				if errors.As(incoming.err, &closeErr) && closeErr.Code != websocket.CloseAbnormalClosure && closeErr.Code != websocket.CloseNoStatusReceived && closeErr.Code != websocket.CloseTLSHandshake {
					// Publish the close after settlement so canceling the session
					// cannot hide the upstream failure from request metrics.
					state.closeCode, state.closeReason = closeErr.Code, closeErr.Text
				}
				info.StreamStatus.SetEndReason(relaycommon.StreamEndReasonScannerErr, incoming.err)
				state.closeAfter = true
				ConsumeResponsesQuota(c, info, accumulator.Finish())
				return nil
			}
			_ = s.markBusinessActivity()
			info.SetFirstResponseTime()
			var event struct {
				dto.ResponsesStreamResponse
				StreamID string `json:"stream_id"`
			}
			if err := common.Unmarshal(incoming.body, &event); err != nil {
				info.StreamStatus.RecordError("invalid upstream websocket event")
			} else {
				if event.Type != "error" && event.StreamID != "" && event.StreamID != create.StreamID {
					if err := s.writeClient(incoming.kind, incoming.body); err != nil {
						s.shutdown()
					}
					continue
				}
				// A repeated terminal from the previous response must never finish
				// a subsequent request on this persistent connection.
				if event.Response != nil && event.Response.ID != "" && event.Response.ID == s.lastResponseID {
					continue
				}
				if responseID != "" && event.Response != nil && event.Response.ID != "" && event.Response.ID != responseID {
					if err := s.writeClient(incoming.kind, incoming.body); err != nil {
						s.shutdown()
					}
					continue
				}
				if event.Type == "error" || event.Type == "response.error" {
					var rejection responsesWSErrorEvent
					_ = common.Unmarshal(incoming.body, &rejection)
					if rejection.EventID != "" && rejection.EventID == s.lastControlEventID && len(sentControl) == 0 {
						continue
					}
					if rejection.ResponseID != "" && rejection.ResponseID == s.lastResponseID {
						continue
					}
					terminal, ambiguous, controlError := responsesWSErrorEndsRequest(rejection, create.StreamID, responseID, sentControl)
					if !terminal {
						if err := s.writeClient(incoming.kind, incoming.body); err != nil {
							s.shutdown()
						}
						// Only a control error in this stream resolves its pending control.
						if controlError {
							sentControl = nil
						}
						continue
					}
					if service.IsResponsesFailure(&event.ResponsesStreamResponse) {
						service.ObserveUpstreamFailure(c, incoming.body, http.StatusSwitchingProtocols)
					}
					if accepted {
						if rejection.Error != nil {
							code := ""
							if rejection.Error.Code != nil {
								code = fmt.Sprint(rejection.Error.Code)
							}
							info.StreamStatus.MarkFailed(code, rejection.Error.Type, rejection.Status)
						}
						accumulator.Observe(&event.ResponsesStreamResponse)
						info.StreamStatus.SetEndReason(relaycommon.StreamEndReasonDone, nil)
						s.lastResponseID = responseID
						state.terminal, state.closeAfter = &incoming, ambiguous
						ConsumeResponsesQuota(c, info, accumulator.Finish())
						return nil
					}
					if rejection.Error == nil {
						// An error frame without an error object still describes the
						// rejected request; keep the client-facing type stable.
						rejection.Error = &types.OpenAIError{Type: "invalid_request_error", Message: event.Message, Code: event.Code}
					}
					rejected := types.WithOpenAIError(*rejection.Error, rejection.Status, types.ErrOptionWithSkipRetry())
					if rejected.StatusCode < 400 || rejected.StatusCode > 599 {
						rejected.StatusCode = http.StatusBadRequest
					}
					return rejected
				}
				if strings.HasPrefix(event.Type, "response.") {
					accepted = true
					if event.Response != nil && event.Response.ID != "" {
						responseID = event.Response.ID
					}
				}
				if service.IsResponsesFailure(&event.ResponsesStreamResponse) {
					service.ObserveUpstreamFailure(c, incoming.body, http.StatusSwitchingProtocols)
				}
				accumulator.Observe(&event.ResponsesStreamResponse)
			}
			switch event.Type {
			case "response.completed", "response.done", "response.incomplete", "response.failed", "response.cancelled", "response.canceled":
				if event.Response != nil {
					s.lastResponseID = event.Response.ID
				}
				info.StreamStatus.SetEndReason(relaycommon.StreamEndReasonDone, nil)
				var responseStatus string
				if event.Response != nil {
					_ = common.Unmarshal(event.Response.Status, &responseStatus)
				}
				if event.Response != nil && responseStatus == "completed" && event.Response.Error == nil && (event.Type == "response.completed" || event.Type == "response.done") {
					service.RecordChannelAffinity(c, s.lockedChannelID)
				}
				state.terminal = &incoming
				ConsumeResponsesQuota(c, info, accumulator.Finish())
				return nil
			}
			if err := s.writeClient(incoming.kind, incoming.body); err != nil {
				s.shutdown()
			}
			if accepted && pendingControl != nil {
				if err := s.writeControlEvent(websocket.TextMessage, pendingControl); err != nil {
					s.shutdown()
				}
				var sent responsesWSCreateEvent
				_ = common.Unmarshal(pendingControl, &sent)
				s.lastControlEventID = sent.EventID
				sentControl = pendingControl
				pendingControl = nil
			}
		case control := <-state.controls:
			if pendingControl != nil || sentControl != nil {
				s.sendError(control.eventID, control.streamID, newResponsesWSInvalidRequestError(errors.New("a response control event is already pending")))
				continue
			}
			if !accepted {
				pendingControl = control.body
				continue
			}
			if err := s.writeControlEvent(websocket.TextMessage, control.body); err != nil {
				s.shutdown()
			}
			s.lastControlEventID = control.eventID
			sentControl = control.body
		case <-idle.C:
			info.StreamStatus.SetEndReason(relaycommon.StreamEndReasonTimeout, context.DeadlineExceeded)
			state.closeAfter = true
			ConsumeResponsesQuota(c, info, accumulator.Finish())
			return nil
		case <-s.ctx.Done():
			info.StreamStatus.SetEndReason(relaycommon.StreamEndReasonClientGone, s.ctx.Err())
			ConsumeResponsesQuota(c, info, accumulator.Finish())
			return nil
		}
	}
}

// A single generation is active, but a cancel can fail independently. Correlate
// available IDs first; uncorrelated control/server errors require a bounded
// connection close because continuing could leave the generation stuck forever.
func responsesWSErrorEndsRequest(event responsesWSErrorEvent, streamID, responseID string, control []byte) (terminal, ambiguous, controlError bool) {
	if len(control) > 0 {
		var pending struct {
			EventID    string `json:"event_id"`
			StreamID   string `json:"stream_id"`
			ResponseID string `json:"response_id"`
		}
		_ = common.Unmarshal(control, &pending)
		if event.EventID != "" && event.EventID == pending.EventID {
			return false, false, true
		}
		if event.ResponseID != "" && event.ResponseID == pending.ResponseID && event.ResponseID != responseID {
			return false, false, true
		}
		if (event.StreamID == "" || event.StreamID == pending.StreamID) && event.Error != nil && event.Error.Type == "invalid_request_error" {
			switch event.Error.Code {
			case "response_not_found", "response_not_active", "response_already_completed":
				return false, false, true
			}
		}
	}
	if event.StreamID != "" && event.StreamID != streamID || responseID != "" && event.ResponseID != "" && event.ResponseID != responseID {
		return false, false, false
	}
	return true, len(control) > 0 && event.ResponseID == "", false
}

func (s *responsesWSSession) restoreConnectionContext(c *gin.Context, model string) *types.NewAPIError {
	// Recheck live transport and model capabilities before reusing a connection.
	channel, err := appmodel.CacheGetChannel(s.lockedChannelID)
	if err != nil || channel == nil || channel.Status != common.ChannelStatusEnabled || !channel.SupportsResponsesTransport(appconstant.ResponsesTransportWebSocket, model) {
		return types.NewErrorWithStatusCode(errors.New("Responses WebSocket is disabled for this channel"), types.ErrorCode(appdto.FilterResponsesWebSocket), http.StatusForbidden, types.ErrOptionWithSkipRetry())
	}
	keyEnabled := channel.Key == s.lockedKey
	if channel.ChannelInfo.IsMultiKey {
		keys := channel.GetKeys()
		status := channel.ChannelInfo.MultiKeyStatusList[s.lockedKeyIndex]
		keyEnabled = s.lockedKeyIndex >= 0 && s.lockedKeyIndex < len(keys) && keys[s.lockedKeyIndex] == s.lockedKey && (status == 0 || status == common.ChannelStatusEnabled)
	}
	if !keyEnabled {
		return types.NewErrorWithStatusCode(errors.New("the upstream connection credential is no longer enabled"), types.ErrorCodeAccessDenied, http.StatusForbidden, types.ErrOptionWithSkipRetry())
	}
	// Changes that alter the physical upstream connection require a new
	// handshake. Request-level settings can be refreshed without rotating keys.
	if channel.Type != s.lockedContext[appconstant.ContextKeyChannelType] ||
		channel.GetBaseURL() != s.lockedContext[appconstant.ContextKeyChannelBaseUrl] ||
		!reflect.DeepEqual(channel.GetHeaderOverride(), s.lockedContext[appconstant.ContextKeyChannelHeaderOverride]) {
		return types.NewErrorWithStatusCode(errors.New("upstream connection settings changed; reconnect required"), types.ErrorCodeAccessDenied, http.StatusForbidden, types.ErrOptionWithSkipRetry())
	}
	if previous, ok := s.lockedContext[appconstant.ContextKeyChannelSetting].(dto.ChannelSettings); ok && previous.Proxy != channel.GetSetting().Proxy {
		return types.NewErrorWithStatusCode(errors.New("upstream proxy changed; reconnect required"), types.ErrorCodeAccessDenied, http.StatusForbidden, types.ErrOptionWithSkipRetry())
	}
	// An advanced custom connection was dialed through the route matched for
	// this model. Only the fields that shape the upstream handshake force a
	// reconnect: target path, protocol conversion and credential placement.
	// Other channel types match the zero route on both sides.
	route, _ := channel.GetOtherSettings().AdvancedCustom.MatchPathForModel(c.Request.URL.Path, model)
	if strings.TrimSpace(route.UpstreamPath) != strings.TrimSpace(s.lockedRoute.UpstreamPath) ||
		route.IsNative() != s.lockedRoute.IsNative() ||
		!reflect.DeepEqual(route.Auth, s.lockedRoute.Auth) {
		return types.NewErrorWithStatusCode(errors.New("upstream route changed; reconnect required"), types.ErrorCodeAccessDenied, http.StatusForbidden, types.ErrOptionWithSkipRetry())
	}
	if pin, found, _ := service.GetChannelConstraints(c).ResolvedPin(); found {
		if pin.ChannelId != s.lockedChannelID {
			return types.NewErrorWithStatusCode(errors.New("channel pin changed; reconnect required"), types.ErrorCodeAccessDenied, http.StatusForbidden, types.ErrOptionWithSkipRetry())
		}
	} else {
		group := common.GetContextKeyString(c, appconstant.ContextKeyUsingGroup)
		if group == "auto" {
			if !slices.Contains(service.GetRequestAutoGroups(c, common.GetContextKeyString(c, appconstant.ContextKeyUserGroup)), s.lockedGroup) {
				return types.NewErrorWithStatusCode(errors.New("the connection group is no longer allowed"), types.ErrorCodeAccessDenied, http.StatusForbidden, types.ErrOptionWithSkipRetry())
			}
			group = s.lockedGroup
			common.SetContextKey(c, appconstant.ContextKeyAutoGroup, group)
		}
		if !appmodel.IsChannelEnabledForGroupModel(group, model, s.lockedChannelID) {
			return types.NewErrorWithStatusCode(errors.New("the connection channel is no longer allowed for this group and model"), types.ErrorCodeAccessDenied, http.StatusForbidden, types.ErrOptionWithSkipRetry())
		}
	}
	for key, value := range s.lockedContext {
		c.Set(string(key), value)
	}
	common.SetContextKey(c, appconstant.ContextKeyChannelSetting, channel.GetSetting())
	common.SetContextKey(c, appconstant.ContextKeyChannelOtherSetting, channel.GetOtherSettings())
	paramOverride := channel.GetParamOverride()
	if merged, applied := service.ApplyChannelAffinityOverrideTemplate(c, paramOverride); applied {
		paramOverride = merged
	}
	common.SetContextKey(c, appconstant.ContextKeyChannelParamOverride, paramOverride)
	common.SetContextKey(c, appconstant.ContextKeyChannelModelMapping, channel.GetModelMapping())
	common.SetContextKey(c, appconstant.ContextKeyChannelStatusCodeMapping, channel.GetStatusCodeMapping())
	policy := service.RequestPolicy(c)
	policy.BeginAttempt(channel, s.lockedGroup)
	policy.AddEvent(service.PolicyEvent{ChannelID: channel.Id, Decision: service.PolicyDecision{Action: "select", Reason: "pinned_channel", Source: "channel_constraint"}})
	return nil
}

func buildResponsesWSCreatePayload(c *gin.Context, info *relaycommon.RelayInfo, req dto.OpenAIResponsesRequest, generate common.RawMessage, streamID string) ([]byte, *types.NewAPIError) {
	_, body, closer, apiErr := PrepareResponsesRequest(c, info, &req)
	if apiErr != nil {
		return nil, apiErr
	}
	defer closer.Close()
	jsonData, err := io.ReadAll(body)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeReadRequestBodyFailed, types.ErrOptionWithSkipRetry())
	}
	event, err := buildResponsesWSCreateEvent(jsonData, generate, streamID)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}
	return event, nil
}

func (s *responsesWSSession) startTargetReader(target *websocket.Conn) {
	limit := int64(helper.DefaultMaxScannerBufferSize)
	if appconstant.StreamScannerMaxBufferMB > 0 {
		limit = int64(appconstant.StreamScannerMaxBufferMB) << 20
	}
	target.SetReadLimit(limit)
	s.workers.Go(func() {
		for {
			kind, body, err := target.ReadMessage()
			if !s.isTarget(target) {
				return
			}
			incoming := responsesWSMessage{target: target, kind: kind, body: body, err: err}
			if state := s.getCurrent(); state != nil {
				select {
				case state.inbox <- incoming:
				case <-state.done:
					if err == nil {
						if writeErr := s.writeClient(kind, body); writeErr != nil {
							s.shutdown()
							return
						}
					} else {
						s.shutdown()
					}
				case <-s.ctx.Done():
					return
				}
			} else if err == nil {
				if writeErr := s.writeClient(kind, body); writeErr != nil {
					s.shutdown()
					return
				}
			} else {
				var closeErr *websocket.CloseError
				if errors.As(err, &closeErr) && closeErr.Code != websocket.CloseAbnormalClosure && closeErr.Code != websocket.CloseNoStatusReceived && closeErr.Code != websocket.CloseTLSHandshake {
					s.closeWithCode(closeErr.Code, closeErr.Text)
				} else {
					s.shutdown()
				}
			}
			if err != nil {
				return
			}
		}
	})
}

func (s *responsesWSSession) getCurrent() *responsesWSCallState {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	return s.current
}

func (s *responsesWSSession) tryReserveCurrent(state *responsesWSCallState) bool {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	if s.current != nil {
		return false
	}
	if !s.activityState.CompareAndSwap(responsesWSSessionIdle, responsesWSSessionActive) {
		return false
	}
	s.current = state
	return true
}

func (s *responsesWSSession) getTarget() *websocket.Conn {
	s.connectionMu.Lock()
	defer s.connectionMu.Unlock()
	return s.target
}

func (s *responsesWSSession) setTarget(target *websocket.Conn) bool {
	s.connectionMu.Lock()
	defer s.connectionMu.Unlock()
	if s.ctx.Err() != nil {
		_ = target.Close()
		return false
	}
	s.target = target
	return true
}

func (s *responsesWSSession) writeTarget(kind int, message []byte) error {
	s.targetWriteMu.Lock()
	defer s.targetWriteMu.Unlock()
	target := s.getTarget()
	if target == nil {
		return errors.New("responses websocket upstream is not connected")
	}
	if err := target.SetWriteDeadline(time.Now().Add(responsesWSWriteTimeout)); err != nil {
		return err
	}
	return target.WriteMessage(kind, message)
}

func (s *responsesWSSession) writeClient(messageType int, message []byte) error {
	s.clientWriteMu.Lock()
	defer s.clientWriteMu.Unlock()
	if err := s.client.SetWriteDeadline(time.Now().Add(responsesWSWriteTimeout)); err != nil {
		return err
	}
	// Compression state and the write must share the lock. Gorilla only compresses
	// when the peer negotiated permessage-deflate during the handshake.
	s.client.EnableWriteCompression(len(message) >= responsesWSCompressionMinBytes)
	// Keep terminal errors written outside the session uncompressed by default.
	defer s.client.EnableWriteCompression(false)
	return s.client.WriteMessage(messageType, message)
}

func (s *responsesWSSession) sendError(eventID, streamID string, apiErr *types.NewAPIError) {
	if apiErr == nil {
		return
	}
	payload, err := buildResponsesWSErrorPayload(eventID, streamID, apiErr)
	if err == nil {
		_ = s.writeClient(websocket.TextMessage, payload)
	}
}

func (s *responsesWSSession) closeTarget() {
	s.connectionMu.Lock()
	target, unregister := s.target, s.unregister
	s.target, s.unregister = nil, nil
	s.connectionMu.Unlock()
	if unregister != nil {
		unregister()
	}
	if target != nil {
		_ = target.Close()
	}
}

func (s *responsesWSSession) shutdown() {
	s.cancel()
	s.closeTarget()
	_ = s.client.Close()
}

func (s *responsesWSSession) registerChannelClose(channelID int) {
	unregister := wsmanager.Register(channelID, wsmanager.KindResponses, s.closeForPolicy)
	s.connectionMu.Lock()
	if s.ctx.Err() != nil {
		s.connectionMu.Unlock()
		unregister()
		return
	}
	s.unregister = unregister
	s.connectionMu.Unlock()
}

// closeForPolicy tells both peers why the connection ends, like the realtime
// relay does; WriteControl is safe alongside a blocked data writer.
func (s *responsesWSSession) closeForPolicy(reason string) {
	s.closeWithCode(websocket.ClosePolicyViolation, reason)
}
func parseResponsesWSEnvelope(message []byte) (responsesWSCreateEvent, string, error) {
	var event responsesWSCreateEvent
	if err := common.Unmarshal(message, &event); err != nil {
		return event, "", fmt.Errorf("invalid websocket event json: %w", err)
	}
	streamRaw := event.StreamID
	if len(streamRaw) == 0 && len(event.Request) > 0 {
		var wrapped struct {
			StreamID common.RawMessage `json:"stream_id"`
		}
		if err := common.Unmarshal(event.Request, &wrapped); err == nil {
			streamRaw = wrapped.StreamID
		}
	}
	var streamID string
	if len(streamRaw) > 0 {
		if err := common.Unmarshal(streamRaw, &streamID); err != nil || len(streamID) < 1 || len(streamID) > 256 {
			return event, "", errors.New("stream_id must contain 1-256 ASCII letters, digits, underscores, hyphens, or periods")
		}
		for _, char := range streamID {
			if !(char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' || char >= '0' && char <= '9' || char == '_' || char == '-' || char == '.') {
				return event, "", errors.New("stream_id must contain only ASCII letters, digits, underscores, hyphens, or periods")
			}
		}
	}
	if strings.TrimSpace(event.Type) == "" {
		return event, streamID, errors.New("websocket event type is required")
	}
	return event, streamID, nil
}

func newResponsesWSInvalidRequestError(err error) *types.NewAPIError {
	return types.NewErrorWithStatusCode(err, types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
}

// normalizeResponsesWSCreateEvent builds the HTTP-shaped request body from a
// response.create whose envelope the read loop already parsed and validated.
// The message is decoded once more as a raw map (the body source) and once as
// the typed request; the envelope is not parsed again.
func normalizeResponsesWSCreateEvent(message []byte, event responsesWSCreateEvent, streamID string) (responsesWSCreateRequest, error) {
	create := responsesWSCreateRequest{StreamID: streamID, Generate: event.Generate}
	// Decode the wrapped request on its own so outer fields cannot enter the HTTP body.
	source := message
	if len(event.Request) > 0 {
		source = event.Request
	}
	var raw map[string]common.RawMessage
	if err := common.Unmarshal(source, &raw); err != nil {
		return create, err
	}
	if len(event.Request) > 0 {
		if len(create.Generate) == 0 {
			create.Generate = raw["generate"]
		}
	} else {
		for _, key := range []string{"type", "event_id", "background", "stream", "stream_options"} {
			delete(raw, key)
		}
	}
	delete(raw, "generate")
	delete(raw, "stream_id")
	payload, err := common.Marshal(raw)
	if err != nil {
		return create, err
	}
	if err := common.Unmarshal(payload, &create.Request); err != nil {
		return create, err
	}
	if helper.ExceedsMaxTokensLimit(create.Request.MaxOutputTokens) {
		return create, errors.New("max_output_tokens is invalid")
	}
	create.Request.Stream = nil
	create.Request.StreamOptions = nil
	create.Body = payload
	return create, nil
}

func buildResponsesWSCreateEvent(jsonData []byte, generate common.RawMessage, streamID string) ([]byte, error) {
	var event map[string]common.RawMessage
	if err := common.Unmarshal(jsonData, &event); err != nil {
		return nil, err
	}
	typeData, err := common.Marshal(responsesWSEventTypeResponseCreate)
	if err != nil {
		return nil, err
	}
	event["type"] = typeData
	// The normalized body never carries stream_id; a channel parameter
	// override may inject one, and it must not shadow the envelope's value.
	delete(event, "stream_id")
	// stream_id is local routing metadata; Codex CPA does not accept it upstream.

	delete(event, "event_id")
	delete(event, "background")
	delete(event, "stream")
	delete(event, "stream_options")
	if len(generate) > 0 {
		event["generate"] = generate
	}
	return common.Marshal(event)
}

func buildResponsesWSErrorPayload(eventID, streamID string, apiErr *types.NewAPIError) ([]byte, error) {
	if apiErr == nil {
		return nil, errors.New("api error is nil")
	}
	status := apiErr.StatusCode
	if status == 0 {
		status = http.StatusInternalServerError
	}
	openaiErr := apiErr.ToOpenAIError()
	return common.Marshal(&responsesWSErrorEvent{
		Type:     "error",
		Status:   status,
		EventID:  eventID,
		StreamID: streamID,
		Error:    &openaiErr,
	})
}

// checkResponsesWSModelAccess applies the token model limit with the same name
// matching as the HTTP distributor. Unlike HTTP, it also runs for requests
// pinned to a channel: the check is stricter there on purpose, because a
// persistent connection keeps serving the model after the pin was resolved.
func checkResponsesWSModelAccess(c *gin.Context, modelName string) *types.NewAPIError {
	if !common.GetContextKeyBool(c, appconstant.ContextKeyTokenModelLimitEnabled) {
		return nil
	}
	raw, ok := common.GetContextKey(c, appconstant.ContextKeyTokenModelLimit)
	if !ok {
		return types.NewErrorWithStatusCode(errors.New("token has no model access"), types.ErrorCodeAccessDenied, http.StatusForbidden, types.ErrOptionWithSkipRetry())
	}
	tokenModelLimit, ok := raw.(map[string]bool)
	if !ok {
		tokenModelLimit = map[string]bool{}
	}
	if !middleware.TokenModelLimitAllows(tokenModelLimit, modelName) {
		return types.NewErrorWithStatusCode(fmt.Errorf("token is not allowed to use model %s", modelName), types.ErrorCodeAccessDenied, http.StatusForbidden, types.ErrOptionWithSkipRetry())
	}
	return nil
}

// selectResponsesWSChannel narrows the shared HTTP selection to channels that
// speak the Responses WebSocket protocol and renders its outcome as a
// non-retryable NewAPIError.
func selectResponsesWSChannel(c *gin.Context, modelName string, retryParam *service.RetryParam, previousChannelIDs ...int) (*appmodel.Channel, *types.NewAPIError) {
	constraints := service.GetChannelConstraints(c)
	if !slices.ContainsFunc(constraints.Filters, func(filter appdto.ChannelFilter) bool {
		return filter.Kind == appdto.FilterResponsesWebSocket
	}) {
		constraints.AddFilter(appdto.ChannelFilter{Kind: appdto.FilterResponsesWebSocket})
	}
	if len(previousChannelIDs) > 0 && previousChannelIDs[0] > 0 && retryParam.GetRetry() == 0 {
		_, pinned, _ := constraints.ResolvedPin()
		if !pinned && service.RequestPolicy(c).SessionMode != "strict" {
			previous, err := appmodel.CacheGetChannel(previousChannelIDs[0])
			if err == nil && previous != nil && previous.Status == common.ChannelStatusEnabled {
				ok, _ := appmodel.ChannelSatisfiesFilters(previous, modelName, constraints.Filters)
				groups := []string{retryParam.TokenGroup}
				if retryParam.TokenGroup == "auto" {
					groups = service.GetRequestAutoGroups(c, common.GetContextKeyString(c, appconstant.ContextKeyUserGroup))
				}
				for _, group := range groups {
					if ok && appmodel.IsChannelEnabledForGroupModel(group, modelName, previous.Id) {
						if retryParam.TokenGroup == "auto" {
							common.SetContextKey(c, appconstant.ContextKeyAutoGroup, group)
						}
						if apiErr := middleware.SetupContextForSelectedChannel(c, previous, modelName); apiErr != nil {
							return nil, apiErr
						}
						return previous, nil
					}
				}
			}
		}
	}
	channel, _, selectErr := service.SelectChannelForRequest(c, modelName, retryParam)
	if selectErr != nil {
		message := selectErr.Message
		if selectErr.MessageID != "" {
			message = i18n.T(c, selectErr.MessageID, selectErr.Params)
		}
		code := selectErr.Code
		if code == "" {
			code = types.ErrorCodeGetChannelFailed
		}
		return nil, types.NewErrorWithStatusCode(errors.New(message), code, selectErr.StatusCode, types.ErrOptionWithSkipRetry())
	}
	if err := middleware.SetupContextForSelectedChannel(c, channel, modelName); err != nil {
		return nil, err
	}
	return channel, nil
}

func (s *responsesWSSession) startHeartbeat(config responsesWSHeartbeatConfig) error {
	if s == nil || s.client == nil {
		return errors.New("websocket connection is nil")
	}
	s.heartbeat = config
	if s.lastActivity.Load() == 0 {
		s.touchActivity()
	}
	if s.lastPong.Load() == 0 {
		s.lastPong.Store(time.Now().UnixNano())
	}

	previousPongHandler := s.client.PongHandler()
	s.client.SetPongHandler(func(data string) error {
		if err := previousPongHandler(data); err != nil {
			return err
		}
		s.lastPong.Store(time.Now().UnixNano())
		return s.refreshClientReadDeadline()
	})
	if err := s.refreshClientReadDeadline(); err != nil {
		return err
	}

	if config.pingInterval <= 0 || config.pongTimeout <= 0 {
		close(s.heartbeatDone)
		return nil
	}
	go func() {
		defer close(s.heartbeatDone)
		ticker := time.NewTicker(config.pingInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				deadline := time.Now().Add(responsesWSWriteTimeout)
				if err := s.client.WriteControl(websocket.PingMessage, nil, deadline); err != nil {
					s.heartbeatFailed.Store(true)
					_ = s.client.Close()
					return
				}
			case <-s.heartbeatStop:
				return
			}
		}
	}()
	return nil
}

func (s *responsesWSSession) stopHeartbeat() {
	if s == nil || s.heartbeatStop == nil || s.heartbeatDone == nil {
		return
	}
	s.heartbeatOnce.Do(func() {
		close(s.heartbeatStop)
	})
	<-s.heartbeatDone
}

func (s *responsesWSSession) markBusinessActivity() error {
	s.touchActivity()
	return s.refreshClientReadDeadline()
}

func (s *responsesWSSession) refreshClientReadDeadline() error {
	if s == nil || s.client == nil {
		return errors.New("websocket connection is nil")
	}
	var deadline time.Time
	if s.heartbeat.idleTimeout > 0 {
		deadline = time.Unix(0, s.lastActivity.Load()).Add(s.heartbeat.idleTimeout)
	}
	if s.heartbeat.pingInterval > 0 && s.heartbeat.pongTimeout > 0 {
		pongDeadline := time.Unix(0, s.lastPong.Load()).Add(s.heartbeat.pongTimeout)
		if deadline.IsZero() || pongDeadline.Before(deadline) {
			deadline = pongDeadline
		}
	}
	return s.client.SetReadDeadline(deadline)
}

func (s *responsesWSSession) businessIdleExpired(now time.Time) bool {
	return s != nil && s.heartbeat.idleTimeout > 0 &&
		!now.Before(time.Unix(0, s.lastActivity.Load()).Add(s.heartbeat.idleTimeout))
}

func (s *responsesWSSession) heartbeatExpired(now time.Time) bool {
	return s != nil && s.heartbeat.pingInterval > 0 && s.heartbeat.pongTimeout > 0 &&
		!now.Before(time.Unix(0, s.lastPong.Load()).Add(s.heartbeat.pongTimeout))
}

func (s *responsesWSSession) touchActivity() {
	s.lastActivity.Store(time.Now().UnixNano())
}

func (s *responsesWSSession) markIdle() {
	s.touchActivity()
	s.activityState.CompareAndSwap(responsesWSSessionActive, responsesWSSessionIdle)
}

func acquireResponsesWSSlot(userId int, session *responsesWSSession) (*responsesWSSession, bool) {
	if responsesWSMaxPerUser <= 0 || userId == 0 {
		return nil, true
	}
	if session == nil {
		return nil, false
	}
	if session.lastActivity.Load() == 0 {
		session.touchActivity()
	}
	responsesWSSlotMu.Lock()
	defer responsesWSSlotMu.Unlock()
	sessions := responsesWSSlots[userId]
	if len(sessions) < responsesWSMaxPerUser {
		responsesWSSlots[userId] = append(sessions, session)
		return nil, true
	}

	for {
		victimIndex := -1
		var victimActivity int64
		for i, candidate := range sessions {
			if candidate == nil || candidate.activityState.Load() != responsesWSSessionIdle {
				continue
			}
			lastActivity := candidate.lastActivity.Load()
			if victimIndex == -1 || lastActivity < victimActivity {
				victimIndex = i
				victimActivity = lastActivity
			}
		}
		if victimIndex == -1 {
			return nil, false
		}

		victim := sessions[victimIndex]
		if !victim.activityState.CompareAndSwap(responsesWSSessionIdle, responsesWSSessionEvicting) {
			continue
		}
		sessions = append(sessions[:victimIndex], sessions[victimIndex+1:]...)
		responsesWSSlots[userId] = append(sessions, session)
		return victim, true
	}
}

func releaseResponsesWSSlot(userId int, session *responsesWSSession) {
	if userId == 0 || session == nil {
		return
	}
	responsesWSSlotMu.Lock()
	defer responsesWSSlotMu.Unlock()
	sessions := responsesWSSlots[userId]
	for i, candidate := range sessions {
		if candidate != session {
			continue
		}
		sessions = append(sessions[:i], sessions[i+1:]...)
		if len(sessions) == 0 {
			delete(responsesWSSlots, userId)
		} else {
			responsesWSSlots[userId] = sessions
		}
		session.activityState.Store(responsesWSSessionEvicting)
		return
	}
}

func (s *responsesWSSession) closeForIdleTimeout() {
	s.closeWithCode(websocket.CloseGoingAway, relaycommon.WebSocketIdleCloseReason)
}

func (s *responsesWSSession) closeForHeartbeatTimeout() {
	s.closeWithCode(websocket.CloseGoingAway, relaycommon.WebSocketHeartbeatCloseReason)
}

func (s *responsesWSSession) closeForReplacement() {
	s.closeWithCode(websocket.CloseGoingAway, responsesWSReplacedCloseReason)
}

func removeResponsesWSTransportFields(jsonData []byte) ([]byte, error) {
	var data map[string]any
	if err := common.Unmarshal(jsonData, &data); err != nil {
		return jsonData, err
	}
	delete(data, "stream")
	delete(data, "stream_options")
	delete(data, "background")
	delete(data, "stream_id")
	return common.Marshal(data)
}

func (s *responsesWSSession) isTarget(target *websocket.Conn) bool {
	s.connectionMu.Lock()
	defer s.connectionMu.Unlock()
	return target != nil && s.target == target
}

func (s *responsesWSSession) resetTargetForModelChange(model string) int {
	if s.lockedModel == "" || s.lockedModel == model {
		return 0
	}
	previous := s.lockedChannelID
	s.closeTarget()
	s.lockedModel, s.lockedGroup, s.lockedKey, s.lastResponseID, s.lastControlEventID = "", "", "", "", ""
	s.lockedChannelID, s.lockedKeyIndex = 0, 0
	s.lockedContext = nil
	s.lockedRoute = dto.AdvancedCustomRoute{}
	return previous
}

func (s *responsesWSSession) writeControlEvent(kind int, message []byte) error {
	payload, err := removeResponsesWSTransportFields(message)
	if err != nil {
		return err
	}
	return s.writeTarget(kind, payload)
}

func (s *responsesWSSession) closeWithCode(code int, reason string) {
	s.closeOnce.Do(func() {
		deadline := time.Now().Add(time.Second)
		message := websocket.FormatCloseMessage(code, reason)
		_ = s.client.WriteControl(websocket.CloseMessage, message, deadline)
		if target := s.getTarget(); target != nil {
			_ = target.WriteControl(websocket.CloseMessage, message, deadline)
		}
		s.shutdown()
	})
}
