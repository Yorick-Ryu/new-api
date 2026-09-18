package relay

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	appconstant "github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
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
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

const responsesWSEventTypeResponseCreate = "response.create"

// responsesWSWriteTimeout bounds a single blocked write so a peer that stops
// reading cannot pin a connection forever. Without it the write never returns,
// and idle timeout, channel disable and shutdown all block behind it.
const responsesWSWriteTimeout = 30 * time.Second

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

// responsesWSCallOutcome decides how a finished call is billed.
type responsesWSCallOutcome int

const (
	// responsesWSCallAborted means upstream never accepted the request payload,
	// so nothing was generated and the pre-consumed quota is returned in full.
	responsesWSCallAborted responsesWSCallOutcome = iota
	// responsesWSCallSettled means upstream accepted the request: bill what was
	// observed, whether the stream ended normally, failed, or was cut short by a
	// disconnect. This matches the HTTP and realtime relays, which also settle
	// on mid-stream client disconnect rather than refunding generated output.
	responsesWSCallSettled
)

type responsesWSCreateEvent struct {
	Type     string            `json:"type"`
	EventID  string            `json:"event_id,omitempty"`
	StreamID common.RawMessage `json:"stream_id,omitempty"`
	Request  common.RawMessage `json:"response,omitempty"`
}

type responsesWSCreateRequest struct {
	StreamID string
	Request  dto.OpenAIResponsesRequest
	Generate common.RawMessage
	// Preserve original JSON fields for configurable affinity key paths.
	Body common.RawMessage
}

type responsesWSErrorEvent struct {
	Type       string             `json:"type"`
	Status     int                `json:"status"`
	EventID    string             `json:"event_id,omitempty"`
	StreamID   string             `json:"stream_id,omitempty"`
	ResponseID string             `json:"response_id,omitempty"`
	Error      *types.OpenAIError `json:"error"`
}

type responsesWSCallState struct {
	info       *relaycommon.RelayInfo
	commitRate middleware.ModelRequestRateLimitCommit

	// mu serializes accounting with settlement on client disconnect.
	mu          sync.Mutex
	accumulator *service.ResponsesUsageAccumulator
	usage       *dto.Usage
	streamID    string
	responseID  string
	accepted    bool
	control     []byte
	controlSent bool
	finished    bool
}

type responsesWSSession struct {
	c              *gin.Context
	client         *websocket.Conn
	target         *websocket.Conn
	unregister     func()
	lockedModel    string
	lockedChannel  *appmodel.Channel
	lockedRoute    dto.AdvancedCustomRoute
	nextEventIndex int
	closeOnce      sync.Once

	clientWriteMu sync.Mutex
	// targetMu guards target and unregister. It is never held across network
	// I/O, so closing the session cannot block behind an in-flight write.
	targetMu sync.Mutex
	// targetWriteMu only serializes writes, as gorilla allows a single writer.
	targetWriteMu      sync.Mutex
	stateMu            sync.Mutex
	current            *responsesWSCallState
	lastResponseID     string
	lastControlEventID string
	activityState      atomic.Uint32
	lastActivity       atomic.Int64
	lastPong           atomic.Int64
	heartbeat          responsesWSHeartbeatConfig
	heartbeatStop      chan struct{}
	heartbeatDone      chan struct{}
	heartbeatOnce      sync.Once
	heartbeatFailed    atomic.Bool
}

func ResponsesWebSocketHelper(c *gin.Context, client *websocket.Conn) *types.NewAPIError {
	return responsesWebSocketHelper(c, client, responsesWSHeartbeatConfig{
		idleTimeout:  relaycommon.GetWebSocketIdleTimeout(),
		pingInterval: relaycommon.GetWebSocketPingInterval(),
		pongTimeout:  relaycommon.GetWebSocketPongTimeout(),
	})
}

type responsesWSHeartbeatConfig struct {
	idleTimeout  time.Duration
	pingInterval time.Duration
	pongTimeout  time.Duration
}

func responsesWebSocketHelper(c *gin.Context, client *websocket.Conn, heartbeat responsesWSHeartbeatConfig) *types.NewAPIError {
	userId := common.GetContextKeyInt(c, appconstant.ContextKeyUserId)
	session := &responsesWSSession{
		c:             c,
		client:        client,
		heartbeat:     heartbeat,
		heartbeatStop: make(chan struct{}),
		heartbeatDone: make(chan struct{}),
	}
	session.touchActivity()
	session.lastPong.Store(time.Now().UnixNano())
	evicted, acquired := acquireResponsesWSSlot(userId, session)
	if !acquired {
		return types.NewErrorWithStatusCode(
			fmt.Errorf("too many concurrent responses websocket connections (limit %d)", responsesWSMaxPerUser),
			types.ErrorCodeInvalidRequest,
			http.StatusTooManyRequests,
			types.ErrOptionWithSkipRetry(),
		)
	}
	defer releaseResponsesWSSlot(userId, session)
	if evicted != nil {
		evicted.closeForReplacement()
	}
	defer session.closeTarget()
	defer func() {
		session.endCurrent(relaycommon.StreamEndReasonClientGone, nil)
		session.settleCurrent()
	}()
	maxMessageBytes := responsesWSMaxMessageBytes()
	client.SetReadLimit(maxMessageBytes)
	if err := session.startHeartbeat(heartbeat); err != nil {
		return types.NewError(err, types.ErrorCodeBadResponse, types.ErrOptionWithSkipRetry())
	}
	defer session.stopHeartbeat()

	for {
		messageType, reader, err := client.NextReader()
		var message []byte
		if err == nil {
			// NextReader decompresses transparently. Read one extra byte to distinguish
			// an exactly-at-limit message from an oversized one without draining it.
			message, err = io.ReadAll(io.LimitReader(reader, maxMessageBytes+1))
			if int64(len(message)) > maxMessageBytes {
				err = websocket.ErrReadLimit
			}
		}
		if err != nil {
			if errors.Is(err, websocket.ErrReadLimit) {
				_ = client.WriteControl(websocket.CloseMessage,
					websocket.FormatCloseMessage(websocket.CloseMessageTooBig, "websocket message exceeds size limit"),
					time.Now().Add(responsesWSWriteTimeout))
				return nil
			}
			if session.activityState.Load() == responsesWSSessionEvicting {
				return nil
			}
			if session.heartbeatFailed.Load() {
				logger.LogInfo(c, "responses websocket closed after heartbeat write failure")
				return nil
			}
			if relaycommon.IsWebSocketIdleTimeout(err) {
				now := time.Now()
				if session.businessIdleExpired(now) {
					logger.LogInfo(c, "responses websocket closed after idle timeout")
					session.closeForIdleTimeout()
					return nil
				}
				if session.heartbeatExpired(now) {
					logger.LogInfo(c, "responses websocket closed after heartbeat timeout")
					session.closeForHeartbeatTimeout()
					return nil
				}
			}
			if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				return nil
			}
			return types.NewError(err, types.ErrorCodeBadRequestBody, types.ErrOptionWithSkipRetry())
		}
		if err := session.markBusinessActivity(); err != nil {
			return types.NewError(err, types.ErrorCodeBadResponse, types.ErrOptionWithSkipRetry())
		}

		envelope, streamID, eventErr := parseResponsesWSEnvelope(message)
		if eventErr != nil {
			session.sendError(envelope.EventID, streamID, newResponsesWSInvalidRequestError(eventErr))
			continue
		}
		if envelope.Type != responsesWSEventTypeResponseCreate {
			if !session.hasTarget() {
				session.sendError(envelope.EventID, streamID, newResponsesWSInvalidRequestError(errors.New("first responses websocket event must be response.create")))
				continue
			}
			if apiErr := session.handleControlEvent(messageType, message, envelope.Type); apiErr != nil {
				session.sendError(envelope.EventID, streamID, apiErr)
			}
			continue
		}
		create, eventID, err := normalizeResponsesWSCreateEvent(message)
		if err != nil {
			session.sendError(eventID, create.StreamID, newResponsesWSInvalidRequestError(err))
			continue
		}
		if err := helper.ValidateResponsesRequest(&create.Request); err != nil {
			session.sendError(eventID, create.StreamID, newResponsesWSInvalidRequestError(err))
			continue
		}
		if err := session.handleResponseCreate(create, eventID); err != nil {
			session.sendError(eventID, create.StreamID, err)
		}
	}
}

func responsesWSEventType(message []byte) (string, error) {
	envelope, _, err := parseResponsesWSEnvelope(message)
	return envelope.Type, err
}

func newResponsesWSInvalidRequestError(err error) *types.NewAPIError {
	return types.NewErrorWithStatusCode(err, types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
}

func normalizeResponsesWSCreateEvent(message []byte) (responsesWSCreateRequest, string, error) {
	event, streamID, err := parseResponsesWSEnvelope(message)
	create := responsesWSCreateRequest{StreamID: streamID}
	if err != nil {
		return create, event.EventID, err
	}
	if event.Type != responsesWSEventTypeResponseCreate {
		return create, event.EventID, fmt.Errorf("unsupported event type %q", event.Type)
	}
	var raw map[string]common.RawMessage
	if err := common.Unmarshal(message, &raw); err != nil {
		return create, event.EventID, err
	}
	create.Generate = raw["generate"]
	if len(event.Request) > 0 {
		// Unmarshal into a fresh map so outer fields cannot enter the HTTP body.
		raw = nil
		if err := common.Unmarshal(event.Request, &raw); err != nil {
			return create, event.EventID, err
		}
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
		return create, event.EventID, err
	}
	if err := common.Unmarshal(payload, &create.Request); err != nil {
		return create, event.EventID, err
	}
	create.Request.Stream = nil
	create.Request.StreamOptions = nil
	create.Body = payload
	return create, event.EventID, nil
}

func (s *responsesWSSession) handleResponseCreate(create responsesWSCreateRequest, eventID string) (resultErr *types.NewAPIError) {
	req := create.Request
	if s.hasCurrent() {
		return types.NewErrorWithStatusCode(
			errors.New("another response.create is already in progress on this websocket connection"),
			types.ErrorCodeInvalidRequest,
			http.StatusConflict,
			types.ErrOptionWithSkipRetry(),
		)
	}

	started := time.Now()
	defer func() {
		if resultErr != nil {
			perfmetrics.RecordRelayResult(s.c.Request.Context(), &relaycommon.RelayInfo{
				OriginModelName: req.Model, UsingGroup: common.GetContextKeyString(s.c, appconstant.ContextKeyUsingGroup), StartTime: started,
			}, resultErr)
		}
	}()
	if apiErr := checkResponsesWSModelAccess(s.c, req.Model); apiErr != nil {
		return apiErr
	}

	// TokenAuth checks account status when the client establishes the socket.
	// Existing connections do not re-check account status on subsequent turns.
	service.BeginAutoBanRequest(s.c)

	commitRate, apiErr := middleware.CheckModelRequestRateLimit(s.c)
	if apiErr != nil {
		return apiErr
	}
	previousChannelID := s.resetTargetForModelChange(req.Model)

	if !s.hasTarget() {
		return s.connectAndSendFirst(create, commitRate, previousChannelID)
	}

	if apiErr := s.validateLockedChannel(req.Model); apiErr != nil {
		commitRate(false)
		return apiErr
	}

	// Keep the existing upstream connection (and its credential), but refresh
	// per-request affinity metadata and templates from this frame's key.
	usingGroup := common.GetContextKeyString(s.c, appconstant.ContextKeyUsingGroup)
	if usingGroup == "" {
		usingGroup = common.GetContextKeyString(s.c, appconstant.ContextKeyTokenGroup)
	}
	if _, specific := common.GetContextKey(s.c, appconstant.ContextKeyTokenSpecificChannelId); !specific {
		preferredID, found := service.GetPreferredChannelByAffinityWithBody(s.c, req.Model, usingGroup, create.Body)
		if found && preferredID == s.lockedChannel.Id {
			selectedGroup := usingGroup
			if usingGroup == "auto" {
				selectedGroup = common.GetContextKeyString(s.c, appconstant.ContextKeyAutoGroup)
			}
			service.MarkChannelAffinityUsed(s.c, selectedGroup, preferredID)
		}
	}
	paramOverride, _ := service.ApplyChannelAffinityOverrideTemplate(s.c, s.lockedChannel.GetParamOverride())
	common.SetContextKey(s.c, appconstant.ContextKeyChannelParamOverride, paramOverride)

	state, payload, apiErr := s.prepareCall(create, commitRate)
	if apiErr != nil {
		commitRate(false)
		return apiErr
	}
	if !s.tryReserveCurrent(state) {
		state.refund(s.c)
		commitRate(false)
		return types.NewErrorWithStatusCode(
			errors.New("another response.create is already in progress on this websocket connection"),
			types.ErrorCodeInvalidRequest,
			http.StatusConflict,
			types.ErrOptionWithSkipRetry(),
		)
	}
	if err := s.writeTarget(websocket.TextMessage, payload); err != nil {
		return s.handleTargetWriteFailureWithState(state, err)
	}
	return nil
}

// validateLockedChannel rejects a stale native route before a later turn can
// send credentials or a Responses frame through the old upstream connection.
func (s *responsesWSSession) validateLockedChannel(modelName string) *types.NewAPIError {
	if s.lockedChannel == nil {
		return newResponsesWSInvalidRequestError(errors.New("missing locked channel"))
	}
	channel, err := appmodel.CacheGetChannel(s.lockedChannel.Id)
	if err != nil || channel == nil || channel.Status != common.ChannelStatusEnabled ||
		!channel.SupportsResponsesTransport(appconstant.ResponsesTransportWebSocket, modelName) {
		return types.NewErrorWithStatusCode(errors.New("Responses WebSocket is disabled for this channel or route"), types.ErrorCodeAccessDenied, http.StatusForbidden, types.ErrOptionWithSkipRetry())
	}
	route, _ := channel.GetOtherSettings().AdvancedCustom.MatchPathForModel("/v1/responses", modelName)
	if channel.Type != s.lockedChannel.Type || channel.GetBaseURL() != s.lockedChannel.GetBaseURL() ||
		channel.GetSetting().Proxy != s.lockedChannel.GetSetting().Proxy ||
		strings.TrimSpace(route.UpstreamPath) != strings.TrimSpace(s.lockedRoute.UpstreamPath) ||
		route.IsNative() != s.lockedRoute.IsNative() || !reflect.DeepEqual(route.Auth, s.lockedRoute.Auth) {
		return types.NewErrorWithStatusCode(errors.New("upstream route changed; reconnect required"), types.ErrorCodeAccessDenied, http.StatusForbidden, types.ErrOptionWithSkipRetry())
	}
	return nil
}

// endCurrent distinguishes a lost client from a truncated upstream response.
func (s *responsesWSSession) endCurrent(reason relaycommon.StreamEndReason, err error) {
	state := s.getCurrent()
	if state == nil {
		return
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.finished || state.info == nil || state.info.StreamStatus == nil {
		return
	}
	state.info.StreamStatus.SetEndReason(reason, err)
}

func (s *responsesWSSession) resetTargetForModelChange(model string) int {
	if s.lockedModel == "" || model == s.lockedModel {
		return 0
	}
	previousChannelID := 0
	if s.lockedChannel != nil {
		previousChannelID = s.lockedChannel.Id
	}
	s.closeTarget()
	s.lockedModel = ""
	s.lockedChannel = nil
	return previousChannelID
}

func (s *responsesWSSession) handleControlEventWriteFailure(err error) *types.NewAPIError {
	apiErr := s.handleTargetWriteFailure(err)
	s.sendError("", "", apiErr)
	return nil
}

func (s *responsesWSSession) handleTargetWriteFailure(err error) *types.NewAPIError {
	s.closeTarget()
	apiErr := types.NewError(err, types.ErrorCodeBadResponse)
	apiErr, _ = s.processChannelError(s.lockedChannel, apiErr, nil)
	return apiErr
}

func (s *responsesWSSession) handleTargetWriteFailureWithState(state *responsesWSCallState, err error) *types.NewAPIError {
	s.finishCall(state, responsesWSCallAborted, true)
	return s.handleTargetWriteFailure(err)
}

func (s *responsesWSSession) connectAndSendFirst(create responsesWSCreateRequest, commitRate middleware.ModelRequestRateLimitCommit, previousChannelID int) *types.NewAPIError {
	req := create.Request
	if err := checkResponsesWSModelAccess(s.c, req.Model); err != nil {
		commitRate(false)
		return err
	}

	retryParam := &service.RetryParam{
		Ctx:                s.c,
		TokenGroup:         common.GetContextKeyString(s.c, appconstant.ContextKeyUsingGroup),
		ModelName:          req.Model,
		RequestPath:        s.c.Request.URL.Path,
		ResponsesTransport: appconstant.ResponsesTransportWebSocket,
		Retry:              common.GetPointer(0),
	}
	if retryParam.TokenGroup == "" {
		retryParam.TokenGroup = common.GetContextKeyString(s.c, appconstant.ContextKeyTokenGroup)
	}

	var lastErr *types.NewAPIError
	for ; retryParam.GetRetry() <= common.RetryTimes; retryParam.IncreaseRetry() {
		channel, apiErr := selectResponsesWSChannel(s.c, req.Model, retryParam, previousChannelID, create.Body)
		if apiErr != nil {
			lastErr = apiErr
			break
		}
		addResponsesWSUsedChannel(s.c, channel.Id)

		if !channel.SupportsResponsesTransport(appconstant.ResponsesTransportWebSocket, req.Model) {
			lastErr = types.NewErrorWithStatusCode(
				fmt.Errorf("channel type %d or its selected route does not support Responses WebSocket", channel.Type),
				types.ErrorCodeInvalidRequest,
				http.StatusBadRequest,
				types.ErrOptionWithSkipRetry(),
			)
			continue
		}

		state, payload, apiErr := s.prepareCall(create, commitRate)
		if apiErr != nil {
			commitRate(false)
			return apiErr
		}

		adaptor := GetAdaptor(state.info.ApiType)
		if adaptor == nil {
			state.refund(s.c)
			apiErr = types.NewError(fmt.Errorf("invalid api type: %d", state.info.ApiType), types.ErrorCodeInvalidApiType, types.ErrOptionWithSkipRetry())
			var shouldRetry bool
			lastErr, shouldRetry = s.processChannelError(channel, apiErr, retryParam)
			if !shouldRetry {
				break
			}
			continue
		}
		adaptor.Init(state.info)
		target, apiErr := dialResponsesWebSocketUpstream(s.c, adaptor, state.info)
		if apiErr != nil {
			state.refund(s.c)
			var shouldRetry bool
			lastErr, shouldRetry = s.processChannelError(channel, apiErr, retryParam)
			if !shouldRetry {
				break
			}
			continue
		}

		s.setTarget(target)
		if !s.tryReserveCurrent(state) {
			s.closeTarget()
			state.refund(s.c)
			commitRate(false)
			return types.NewErrorWithStatusCode(errors.New("another response.create is already in progress on this websocket connection"), types.ErrorCodeInvalidRequest, http.StatusConflict, types.ErrOptionWithSkipRetry())
		}
		if err := s.writeTarget(websocket.TextMessage, payload); err != nil {
			s.finishCall(state, responsesWSCallAborted, true)
			s.closeTarget()
			apiErr = types.NewError(err, types.ErrorCodeBadResponse)
			var shouldRetry bool
			lastErr, shouldRetry = s.processChannelError(channel, apiErr, retryParam)
			if !shouldRetry {
				break
			}
			continue
		}

		s.lockedModel = req.Model
		s.lockedChannel = channel
		s.lockedRoute, _ = channel.GetOtherSettings().AdvancedCustom.MatchPathForModel("/v1/responses", req.Model)
		s.registerChannelClose(channel.Id)
		s.startTargetReader()
		return nil
	}

	if lastErr == nil {
		lastErr = types.NewError(errors.New("failed to connect responses websocket upstream"), types.ErrorCodeDoRequestFailed, types.ErrOptionWithSkipRetry())
	}
	commitRate(false)
	return lastErr
}

func (s *responsesWSSession) processChannelError(channel *appmodel.Channel, apiErr *types.NewAPIError, retryParam *service.RetryParam) (*types.NewAPIError, bool) {
	if apiErr == nil {
		return nil, false
	}
	apiErr = service.NormalizeViolationFeeError(apiErr)
	statusCodeMapping := ""
	if s.c != nil {
		statusCodeMapping = s.c.GetString("status_code_mapping")
	}
	service.ResetStatusCode(apiErr, statusCodeMapping)
	if channel != nil && s.c != nil {
		service.ProcessChannelError(s.c, *types.NewChannelError(
			channel.Id,
			channel.Type,
			channel.Name,
			channel.ChannelInfo.IsMultiKey,
			common.GetContextKeyString(s.c, appconstant.ContextKeyChannelKey),
			channel.GetAutoBan(),
		), apiErr, nil)
	}
	if retryParam == nil {
		return apiErr, false
	}
	return apiErr, service.ShouldRetryRelayError(s.c, apiErr, common.RetryTimes-retryParam.GetRetry())
}

func (s *responsesWSSession) prepareCall(create responsesWSCreateRequest, commitRate middleware.ModelRequestRateLimitCommit) (*responsesWSCallState, []byte, *types.NewAPIError) {
	req := create.Request
	common.SetContextKey(s.c, appconstant.ContextKeyRequestStartTime, time.Now())
	relayInfo := relaycommon.GenRelayInfoResponses(s.c, &req)
	// The stream field is stripped from the frame before parsing, so
	// GenRelayInfoResponses sees stream=nil and would record the call as
	// non-stream, which also hides first-response time in the usage-log UI.
	// WebSocket delivery is inherently incremental; mark it streaming like the
	// realtime relay does.
	relayInfo.IsStream = true
	relayInfo.StreamStatus = relaycommon.NewStreamStatus()
	relayInfo.StreamStatus.RequireTerminal()
	s.c.Set(string(appconstant.ContextKeyIsStream), true)
	relayInfo.RequestId = fmt.Sprintf("%s-ws-%d", relayInfo.RequestId, s.nextEventIndex)
	s.nextEventIndex++

	meta := req.GetTokenCountMeta()
	if setting.ShouldCheckPromptSensitive() && meta != nil {
		contains, words := service.CheckSensitiveText(meta.CombineText)
		if contains {
			return nil, nil, types.NewError(fmt.Errorf("user sensitive words detected: %s", strings.Join(words, ", ")), types.ErrorCodeSensitiveWordsDetected, types.ErrOptionWithSkipRetry())
		}
	}

	tokens, err := service.EstimateRequestToken(s.c, meta, relayInfo)
	if err != nil {
		return nil, nil, types.NewError(err, types.ErrorCodeCountTokenFailed)
	}
	relayInfo.SetEstimatePromptTokens(tokens)

	priceData, err := helper.ModelPriceHelper(s.c, relayInfo, tokens, meta)
	if err != nil {
		return nil, nil, types.NewError(err, types.ErrorCodeModelPriceError, types.ErrOptionWithStatusCode(http.StatusBadRequest))
	}
	if !priceData.FreeModel {
		if apiErr := service.PreConsumeBilling(s.c, priceData.QuotaToPreConsume, relayInfo); apiErr != nil {
			return nil, nil, apiErr
		}
	}

	payload, apiErr := buildResponsesWSCreatePayload(s.c, relayInfo, req, create.Generate)
	if apiErr != nil {
		if relayInfo.Billing != nil {
			relayInfo.Billing.Refund(s.c)
		}
		return nil, nil, apiErr
	}

	relayInfo.ClientWs = s.client

	return &responsesWSCallState{
		info:        relayInfo,
		accumulator: service.NewResponsesUsageAccumulator(relayInfo),
		streamID:    create.StreamID,
		commitRate:  commitRate,
	}, payload, nil
}

func buildResponsesWSCreatePayload(c *gin.Context, relayInfo *relaycommon.RelayInfo, req dto.OpenAIResponsesRequest, generate common.RawMessage) ([]byte, *types.NewAPIError) {
	relayInfo.InitChannelMeta(c)
	request, err := common.DeepCopy(&req)
	if err != nil {
		return nil, types.NewError(fmt.Errorf("failed to copy responses request: %w", err), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}
	if err := helper.ModelMappedHelper(c, relayInfo, request); err != nil {
		return nil, types.NewError(err, types.ErrorCodeChannelModelMappedError, types.ErrOptionWithSkipRetry())
	}

	adaptor := GetAdaptor(relayInfo.ApiType)
	if adaptor == nil {
		return nil, types.NewError(fmt.Errorf("invalid api type: %d", relayInfo.ApiType), types.ErrorCodeInvalidApiType, types.ErrOptionWithSkipRetry())
	}
	adaptor.Init(relayInfo)
	convertedRequest, err := adaptor.ConvertOpenAIResponsesRequest(c, relayInfo, *request)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}
	relaycommon.AppendRequestConversionFromRequest(relayInfo, convertedRequest)
	jsonData, err := common.Marshal(convertedRequest)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}
	jsonData, err = relaycommon.RemoveDisabledFields(jsonData, relayInfo.ChannelOtherSettings, relayInfo.ChannelSetting.PassThroughBodyEnabled)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}
	jsonData, err = removeResponsesWSTransportFields(jsonData)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}
	if len(relayInfo.ParamOverride) > 0 {
		jsonData, err = relaycommon.ApplyParamOverrideWithRelayInfo(jsonData, relayInfo)
		if err != nil {
			return nil, newAPIErrorFromParamOverride(err)
		}
	}

	event, err := buildResponsesWSCreateEvent(jsonData, generate)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeConvertRequestFailed, types.ErrOptionWithSkipRetry())
	}
	return event, nil
}

func buildResponsesWSCreateEvent(jsonData []byte, generate common.RawMessage) ([]byte, error) {
	var event map[string]common.RawMessage
	if err := common.Unmarshal(jsonData, &event); err != nil {
		return nil, err
	}
	typeData, err := common.Marshal(responsesWSEventTypeResponseCreate)
	if err != nil {
		return nil, err
	}
	event["type"] = typeData
	// Keep stream identity in the gateway call state. HTTP-bridged Responses
	// upstreams can reject stream_id as an unsupported request parameter; the
	// upstream connection still has only one active generation to correlate.
	delete(event, "stream_id")
	delete(event, "event_id")
	delete(event, "background")
	delete(event, "stream")
	delete(event, "stream_options")
	if len(generate) > 0 {
		event["generate"] = generate
	}
	return common.Marshal(event)
}

func removeResponsesWSTransportFields(jsonData []byte) ([]byte, error) {
	var data map[string]any
	if err := common.Unmarshal(jsonData, &data); err != nil {
		return jsonData, err
	}
	delete(data, "stream")
	delete(data, "stream_options")
	delete(data, "background")
	return common.Marshal(data)
}

func dialResponsesWebSocketUpstream(c *gin.Context, adaptor relaychannel.Adaptor, info *relaycommon.RelayInfo) (*websocket.Conn, *types.NewAPIError) {
	fullRequestURL, err := adaptor.GetRequestURL(info)
	if err != nil {
		return nil, types.NewError(fmt.Errorf("get request url failed: %w", err), types.ErrorCodeDoRequestFailed)
	}
	fullRequestURL = toWebSocketURL(fullRequestURL)

	targetHeader := http.Header{}
	if err := adaptor.SetupRequestHeader(c, &targetHeader, info); err != nil {
		return nil, types.NewError(fmt.Errorf("setup request header failed: %w", err), types.ErrorCodeDoRequestFailed)
	}
	headerOverride, err := relaychannel.ResolveHeaderOverride(info, c)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeChannelHeaderOverrideInvalid)
	}
	for key, value := range headerOverride {
		targetHeader.Set(key, value)
	}

	dialer := *websocket.DefaultDialer
	if info.ChannelSetting.Proxy != "" {
		proxyURL, _, proxyErr := common.ParseProxyURLRuntime(info.ChannelSetting.Proxy)
		if proxyErr != nil {
			return nil, types.NewError(proxyErr, types.ErrorCodeDoRequestFailed)
		}
		dialer.Proxy = http.ProxyURL(proxyURL)
	}
	targetConn, resp, err := dialer.DialContext(c.Request.Context(), fullRequestURL, targetHeader)
	if err != nil {
		statusCode := http.StatusInternalServerError
		if resp != nil {
			statusCode = resp.StatusCode
			if resp.Body != nil {
				body, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
				service.CloseResponseBodyGracefully(resp)
				if readErr == nil {
					service.ObserveUpstreamFailure(c, body, statusCode)
				}
			}
		}
		return nil, types.NewErrorWithStatusCode(fmt.Errorf("dial failed to %s: %w", relaycommon.SanitizeURLForLog(fullRequestURL), err), types.ErrorCodeDoRequestFailed, statusCode)
	}
	targetConn.SetReadLimit(responsesWSMaxMessageBytes())
	return targetConn, nil
}

func toWebSocketURL(raw string) string {
	switch {
	case strings.HasPrefix(raw, "https://"):
		return "wss://" + strings.TrimPrefix(raw, "https://")
	case strings.HasPrefix(raw, "http://"):
		return "ws://" + strings.TrimPrefix(raw, "http://")
	default:
		return raw
	}
}

func (s *responsesWSSession) startTargetReader() {
	target := s.getTarget()
	if target == nil {
		return
	}
	go func() {
		for {
			messageType, message, err := target.ReadMessage()
			if err != nil {
				if !s.isTarget(target) {
					// The session already replaced or closed this upstream
					// connection; do not tear down the client for a stale reader.
					return
				}
				if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
					logger.LogError(s.c, "responses websocket upstream read failed: "+err.Error())
				}
				s.endCurrent(relaycommon.StreamEndReasonScannerErr, err)
				var closeErr *websocket.CloseError
				if errors.As(err, &closeErr) && closeErr.Code != websocket.CloseAbnormalClosure && closeErr.Code != websocket.CloseTLSHandshake {
					// Preserve the upstream close handshake for the client. In
					// particular, retry signals such as 1012 and size errors such
					// as 1009 must not collapse into a local 1006/EOF.
					s.closeWithCode(closeErr.Code, closeErr.Text)
					return
				}
				s.settleCurrent()
				_ = s.client.Close()
				return
			}
			if !s.isTarget(target) {
				return
			}
			_ = s.markBusinessActivity()
			finished, forward, closeAfter := s.observeUpstreamMessage(message)
			if !forward {
				continue
			}
			if err := s.writeClient(messageType, message); err != nil {
				if finished {
					s.markIdle()
				}
				s.endCurrent(relaycommon.StreamEndReasonClientGone, err)
				logger.LogError(s.c, "responses websocket client write failed: "+err.Error())
				s.settleCurrent()
				s.closeTarget()
				return
			}
			if closeAfter {
				s.closeWithCode(websocket.CloseInternalServerErr, "upstream response state is uncertain")
				return
			}
			if finished {
				s.markIdle()
			}
			// Upstream traffic also counts as activity: a long generation can
			// stream for minutes while the client only listens, and that must
			// not trip the client idle timeout.
			//
			// Calling this from the reader goroutine while the client goroutine
			// blocks in ReadMessage is safe despite gorilla listing
			// SetReadDeadline as a read method: it is a bare passthrough to
			// net.Conn.SetReadDeadline (conn.go:1105), which is documented to be
			// callable concurrently with a blocked Read.
		}
	}()
}

// observeUpstreamMessage returns whether a call finished, whether to forward the
// frame, and whether an ambiguous upstream error requires closing the socket.
func (s *responsesWSSession) observeUpstreamMessage(message []byte) (bool, bool, bool) {
	s.stateMu.Lock()
	state, lastResponseID, lastControlEventID := s.current, s.lastResponseID, s.lastControlEventID
	s.stateMu.Unlock()
	var event struct {
		dto.ResponsesStreamResponse
		StreamID   string `json:"stream_id"`
		ResponseID string `json:"response_id"`
		EventID    string `json:"event_id"`
	}
	if err := common.Unmarshal(message, &event); err != nil {
		return false, true, false
	}
	responseID := event.ResponseID
	if event.Response != nil && event.Response.ID != "" {
		responseID = event.Response.ID
	}
	isError := event.Type == "error" || event.Type == "response.error"
	if responseID != "" && responseID == lastResponseID ||
		isError && event.EventID != "" && event.EventID == lastControlEventID {
		// A duplicate terminal/error from the previous turn must not end the next.
		return false, false, false
	}
	if state == nil {
		return false, true, false
	}
	state.mu.Lock()
	if state.finished {
		state.mu.Unlock()
		return false, false, false
	}
	ambiguous := false
	if isError {
		var rejection responsesWSErrorEvent
		_ = common.Unmarshal(message, &rejection)
		rejection.ResponseID = responseID
		var sentControl []byte
		if state.controlSent {
			sentControl = state.control
		}
		terminal, uncertain, controlError := responsesWSErrorEndsRequest(rejection, state.streamID, state.responseID, sentControl)
		if !terminal {
			if controlError {
				state.control = nil
				state.controlSent = false
			}
			state.mu.Unlock()
			return false, true, false
		}
		ambiguous = uncertain
	} else if event.StreamID != "" && event.StreamID != state.streamID ||
		responseID != "" && state.responseID != "" && responseID != state.responseID {
		state.mu.Unlock()
		return false, true, false
	}
	if responseID != "" {
		state.responseID = responseID
	}
	if strings.HasPrefix(event.Type, "response.") && !isError {
		state.accepted = true
	}
	state.info.SetFirstResponseTime()
	if state.accumulator == nil {
		state.accumulator = service.NewResponsesUsageAccumulator(state.info)
	}
	state.accumulator.Observe(&event.ResponsesStreamResponse)
	var pendingControl []byte
	terminal := false
	switch event.Type {
	case "response.completed", "response.done", "response.incomplete", "response.failed", "response.cancelled", "response.canceled", "error", "response.error":
		terminal = true
		state.info.StreamStatus.SetEndReason(relaycommon.StreamEndReasonDone, nil)
	}
	if !terminal && state.accepted && len(state.control) > 0 && !state.controlSent {
		pendingControl = state.control
		state.controlSent = true
	}
	state.mu.Unlock()
	if service.IsResponsesFailure(&event.ResponsesStreamResponse) {
		service.ObserveUpstreamFailure(s.c, message, http.StatusSwitchingProtocols)
	}
	if terminal {
		if (event.Type == "response.completed" || event.Type == "response.done") &&
			event.Response != nil && event.Response.Error == nil && !relaycommon.IsNonBillableResponsesStatus(event.Response.Status) {
			service.RecordChannelAffinity(s.c, state.info.ChannelId)
		}
		return s.finishCall(state, responsesWSCallSettled, false), true, ambiguous
	}
	if pendingControl != nil {
		if err := s.writeControlEvent(websocket.TextMessage, pendingControl); err != nil {
			return s.finishCall(state, responsesWSCallSettled, false), true, true
		}
	}
	return false, true, false
}

// Only one cancel may be outstanding. A cancel sent before response.created is
// held until upstream has accepted the generation, as in the upstream relay.
func (s *responsesWSSession) handleControlEvent(messageType int, message []byte, eventType string) *types.NewAPIError {
	if eventType == "response.cancel" {
		state := s.getCurrent()
		if state == nil {
			return newResponsesWSInvalidRequestError(errors.New("there is no active response to cancel"))
		}
		state.mu.Lock()
		if state.finished {
			state.mu.Unlock()
			return newResponsesWSInvalidRequestError(errors.New("response has already finished"))
		}
		if len(state.control) > 0 {
			state.mu.Unlock()
			return newResponsesWSInvalidRequestError(errors.New("a response control event is already pending"))
		}
		state.control = append([]byte(nil), message...)
		if !state.accepted {
			state.mu.Unlock()
			return nil
		}
		state.controlSent = true
		state.mu.Unlock()
	}
	if err := s.writeControlEvent(messageType, message); err != nil {
		s.settleCurrent()
		return s.handleTargetWriteFailure(err)
	}
	return nil
}

// Client stream metadata is retained for error attribution, but cannot leak
// into a cancel sent to an upstream that rejects stream_id on create.
func (s *responsesWSSession) writeControlEvent(messageType int, message []byte) error {
	var envelope map[string]common.RawMessage
	if err := common.Unmarshal(message, &envelope); err != nil {
		return err
	}
	if _, exists := envelope["stream_id"]; exists {
		delete(envelope, "stream_id")
		var err error
		message, err = common.Marshal(envelope)
		if err != nil {
			return err
		}
	}
	return s.writeTarget(messageType, message)
}

func (s *responsesWSSession) finishCall(state *responsesWSCallState, outcome responsesWSCallOutcome, releaseActivity bool) bool {
	if state == nil {
		return false
	}
	if !s.clearCurrent(state) {
		return false
	}
	state.mu.Lock()
	state.finished = true
	responseID := state.responseID
	var control struct {
		EventID string `json:"event_id"`
	}
	_ = common.Unmarshal(state.control, &control)
	state.mu.Unlock()
	s.stateMu.Lock()
	if responseID != "" {
		s.lastResponseID = responseID
	}
	if control.EventID != "" {
		s.lastControlEventID = control.EventID
	}
	s.stateMu.Unlock()
	if releaseActivity {
		defer s.markIdle()
	}
	if outcome == responsesWSCallSettled {
		ctx := context.Background()
		if s.c != nil && s.c.Request != nil {
			ctx = s.c.Request.Context()
		}
		defer perfmetrics.RecordRelayResult(ctx, state.info, nil)
	}
	// Requests rejected before the upstream write are refunded. Accepted
	// streams share HTTP accounting, including explicit failures and disconnects.
	if outcome == responsesWSCallAborted || !finalizeResponsesWSUsage(state) {
		state.refund(s.c)
		if state.commitRate != nil {
			state.commitRate(false)
		}
		return true
	}

	// Finish freezes the accumulator before this snapshot is billed.
	state.mu.Lock()
	usage := *state.usage
	state.mu.Unlock()
	service.PostTextConsumeQuota(s.c, state.info, &usage, nil)
	if state.commitRate != nil {
		state.commitRate(true)
	}
	return true
}

// finalizeResponsesWSUsage fills in what upstream did not report — the usual
// case for a stream cut short — and reports whether anything is billable.
func finalizeResponsesWSUsage(state *responsesWSCallState) bool {
	if state == nil || state.info == nil {
		return false
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if state.accumulator == nil {
		state.accumulator = service.NewResponsesUsageAccumulator(state.info)
	}
	state.usage = state.accumulator.Finish()
	if state.usage.TotalTokens > 0 {
		return true
	}
	if state.info.ResponsesUsageInfo != nil {
		for _, tool := range state.info.ResponsesUsageInfo.BuiltInTools {
			if tool != nil && tool.CallCount > 0 {
				return true
			}
		}
	}
	return false
}

func (state *responsesWSCallState) refund(c *gin.Context) {
	if state != nil && state.info != nil && state.info.Billing != nil {
		state.info.Billing.Refund(c)
	}
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

func (s *responsesWSSession) hasCurrent() bool {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	return s.current != nil
}

func (s *responsesWSSession) clearCurrent(state *responsesWSCallState) bool {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	if state != nil && s.current != state {
		return false
	}
	s.current = nil
	return true
}

func (s *responsesWSSession) getCurrent() *responsesWSCallState {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	return s.current
}

// settleCurrent ends an in-flight call that was interrupted rather than
// completed — client disconnect, upstream read failure, idle timeout or channel
// shutdown. The payload already reached upstream, so it settles on observed
// usage; finishCall still refunds if nothing was generated.
func (s *responsesWSSession) settleCurrent() {
	state := s.getCurrent()
	if state != nil {
		s.finishCall(state, responsesWSCallSettled, true)
	}
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

func (s *responsesWSSession) hasTarget() bool {
	s.targetMu.Lock()
	defer s.targetMu.Unlock()
	return s.target != nil
}

func (s *responsesWSSession) getTarget() *websocket.Conn {
	s.targetMu.Lock()
	defer s.targetMu.Unlock()
	return s.target
}

func (s *responsesWSSession) isTarget(target *websocket.Conn) bool {
	s.targetMu.Lock()
	defer s.targetMu.Unlock()
	return target != nil && s.target == target
}

func (s *responsesWSSession) setTarget(target *websocket.Conn) {
	s.targetMu.Lock()
	defer s.targetMu.Unlock()
	s.target = target
}

func (s *responsesWSSession) writeTarget(messageType int, message []byte) error {
	// Resolve the target under targetMu, then release it before writing: a slow
	// upstream must not be able to block closeTarget or the idle/policy paths.
	target := s.getTarget()
	if target == nil {
		return errors.New("responses websocket upstream is not connected")
	}
	s.targetWriteMu.Lock()
	defer s.targetWriteMu.Unlock()
	if err := target.SetWriteDeadline(time.Now().Add(responsesWSWriteTimeout)); err != nil {
		return err
	}
	return target.WriteMessage(messageType, message)
}

func (s *responsesWSSession) sendError(eventID, streamID string, apiErr *types.NewAPIError) {
	if apiErr == nil {
		return
	}
	payload, err := buildResponsesWSErrorPayload(eventID, streamID, apiErr)
	if err != nil {
		return
	}
	_ = s.writeClient(websocket.TextMessage, payload)
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

func (s *responsesWSSession) closeTarget() {
	var target *websocket.Conn
	var unregister func()
	s.targetMu.Lock()
	target = s.target
	s.target = nil
	unregister = s.unregister
	s.unregister = nil
	s.targetMu.Unlock()
	if unregister != nil {
		unregister()
	}
	if target != nil {
		_ = target.Close()
	}
}

func (s *responsesWSSession) registerChannelClose(channelID int) {
	unregister := wsmanager.Register(channelID, wsmanager.KindResponses, func(reason string) {
		s.closeForPolicy(reason)
	})
	s.targetMu.Lock()
	if s.unregister != nil {
		s.unregister()
	}
	s.unregister = unregister
	s.targetMu.Unlock()
}

func (s *responsesWSSession) closeForPolicy(reason string) {
	s.endCurrent(relaycommon.StreamEndReasonClientGone, nil)
	s.closeWithCode(websocket.ClosePolicyViolation, reason)
}

func (s *responsesWSSession) closeForIdleTimeout() {
	s.endCurrent(relaycommon.StreamEndReasonTimeout, nil)
	s.closeWithCode(websocket.CloseGoingAway, relaycommon.WebSocketIdleCloseReason)
}

func (s *responsesWSSession) closeForHeartbeatTimeout() {
	s.endCurrent(relaycommon.StreamEndReasonPingFail, nil)
	s.closeWithCode(websocket.CloseGoingAway, relaycommon.WebSocketHeartbeatCloseReason)
}

func (s *responsesWSSession) closeForReplacement() {
	s.closeWithCode(websocket.CloseGoingAway, responsesWSReplacedCloseReason)
}

func (s *responsesWSSession) closeWithCode(code int, reason string) {
	s.closeOnce.Do(func() {
		s.settleCurrent()
		deadline := time.Now().Add(time.Second)
		closeMessage := websocket.FormatCloseMessage(code, reason)
		_ = s.client.WriteControl(websocket.CloseMessage, closeMessage, deadline)
		if target := s.getTarget(); target != nil {
			_ = target.WriteControl(websocket.CloseMessage, closeMessage, deadline)
		}
		s.closeTarget()
		_ = s.client.Close()
	})
}

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
	matchName := ratio_setting.FormatMatchingModelName(modelName)
	if _, ok := tokenModelLimit[matchName]; !ok {
		return types.NewErrorWithStatusCode(fmt.Errorf("token is not allowed to use model %s", modelName), types.ErrorCodeAccessDenied, http.StatusForbidden, types.ErrOptionWithSkipRetry())
	}
	return nil
}

func selectResponsesWSChannel(c *gin.Context, modelName string, retryParam *service.RetryParam, previousChannelID int, body []byte) (*appmodel.Channel, *types.NewAPIError) {
	if channelIdRaw, ok := common.GetContextKey(c, appconstant.ContextKeyTokenSpecificChannelId); ok {
		channelID, ok := channelIdRaw.(string)
		if !ok {
			return nil, types.NewErrorWithStatusCode(errors.New("invalid specified channel id"), types.ErrorCodeGetChannelFailed, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
		}
		id, err := strconv.Atoi(channelID)
		if err != nil {
			return nil, types.NewErrorWithStatusCode(err, types.ErrorCodeGetChannelFailed, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
		}
		channel, err := appmodel.GetChannelById(id, true)
		if err != nil {
			return nil, types.NewErrorWithStatusCode(err, types.ErrorCodeGetChannelFailed, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
		}
		if channel.Status != common.ChannelStatusEnabled {
			return nil, types.NewErrorWithStatusCode(errors.New("specified channel is disabled"), types.ErrorCodeGetChannelFailed, http.StatusForbidden, types.ErrOptionWithSkipRetry())
		}
		if !channel.SupportsResponsesTransport(appconstant.ResponsesTransportWebSocket, modelName) {
			return nil, types.NewErrorWithStatusCode(errors.New("specified channel does not support Responses WebSocket"), types.ErrorCodeGetChannelFailed, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
		}
		if err := middleware.SetupContextForSelectedChannel(c, channel, modelName); err != nil {
			return nil, err
		}
		return channel, nil
	}

	usingGroup := common.GetContextKeyString(c, appconstant.ContextKeyUsingGroup)
	if usingGroup == "" {
		usingGroup = retryParam.TokenGroup
	}

	if retryParam.GetRetry() == 0 {
		affinityChannelID, hasAffinity := service.GetPreferredChannelByAffinityWithBody(c, modelName, usingGroup, body)
		if previousChannelID > 0 {
			previous, err := appmodel.CacheGetChannel(previousChannelID)
			if err == nil && previous != nil && previous.Status == common.ChannelStatusEnabled &&
				previous.SupportsResponsesTransport(appconstant.ResponsesTransportWebSocket, modelName) {
				if usingGroup == "auto" {
					userGroup := common.GetContextKeyString(c, appconstant.ContextKeyUserGroup)
					for _, g := range service.GetUserAutoGroup(userGroup) {
						if !appmodel.IsChannelEnabledForGroupModel(g, modelName, previous.Id) {
							continue
						}
						common.SetContextKey(c, appconstant.ContextKeyAutoGroup, g)
						if setupErr := middleware.SetupContextForSelectedChannel(c, previous, modelName); setupErr == nil {
							return previous, nil
						}
						break
					}
				} else if appmodel.IsChannelEnabledForGroupModel(usingGroup, modelName, previous.Id) {
					if setupErr := middleware.SetupContextForSelectedChannel(c, previous, modelName); setupErr == nil {
						return previous, nil
					}
				}
			}
		}

		if hasAffinity {
			preferredChannelID := affinityChannelID
			preferred, err := appmodel.CacheGetChannel(preferredChannelID)
			if err == nil && preferred != nil && preferred.Status == common.ChannelStatusEnabled &&
				preferred.SupportsResponsesTransport(appconstant.ResponsesTransportWebSocket, modelName) {
				if usingGroup == "auto" {
					userGroup := common.GetContextKeyString(c, appconstant.ContextKeyUserGroup)
					for _, g := range service.GetUserAutoGroup(userGroup) {
						if appmodel.IsChannelEnabledForGroupModel(g, modelName, preferred.Id) {
							common.SetContextKey(c, appconstant.ContextKeyAutoGroup, g)
							service.MarkChannelAffinityUsed(c, g, preferred.Id)
							if err := middleware.SetupContextForSelectedChannel(c, preferred, modelName); err != nil {
								return nil, err
							}
							return preferred, nil
						}
					}
				} else if appmodel.IsChannelEnabledForGroupModel(usingGroup, modelName, preferred.Id) {
					service.MarkChannelAffinityUsed(c, usingGroup, preferred.Id)
					if err := middleware.SetupContextForSelectedChannel(c, preferred, modelName); err != nil {
						return nil, err
					}
					return preferred, nil
				}
			}
		}
	}

	channel, selectGroup, err := service.CacheGetRandomSatisfiedChannel(retryParam)
	if err != nil {
		return nil, types.NewError(fmt.Errorf("获取分组 %s 下模型 %s 的可用渠道失败（retry）: %s", selectGroup, modelName, err.Error()), types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry())
	}
	if channel == nil {
		return nil, types.NewError(fmt.Errorf("分组 %s 下模型 %s 的可用渠道不存在（retry）", selectGroup, modelName), types.ErrorCodeGetChannelFailed, types.ErrOptionWithSkipRetry())
	}
	if err := middleware.SetupContextForSelectedChannel(c, channel, modelName); err != nil {
		return nil, err
	}
	return channel, nil
}

func addResponsesWSUsedChannel(c *gin.Context, channelId int) {
	useChannel := c.GetStringSlice("use_channel")
	useChannel = append(useChannel, fmt.Sprintf("%d", channelId))
	c.Set("use_channel", useChannel)
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
