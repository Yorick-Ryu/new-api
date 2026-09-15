package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/auto_ban"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const AutoBanRequestKey = "auto_ban_request_key"
const autoBanEnforcedKey = "auto_ban_enforced"

var violationListPattern = regexp.MustCompile(`(?i)\bsafety_violations\s*=\s*\[([^\]]{0,512})\]`)

// IsResponsesFailure uses the relay's already decoded event. Normal output
// requires no body scan, copy, JSON decoding or settings access for auto-ban.
func IsResponsesFailure(event *dto.ResponsesStreamResponse) bool {
	switch event.Type {
	case "error", "response.failed", "response.error":
		return true
	case "response.completed", "response.done", "response":
		return event.Response != nil && event.Response.Error != nil
	default:
		return false
	}
}

// ParseUpstreamFailure accepts error envelopes only. In particular, an error
// quoted in a successful completion or a text delta is not a failure. Called
// only from upstream error branches and the administrator's dry-run endpoint.
func ParseUpstreamFailure(body []byte, httpStatus int) (auto_ban.Evidence, bool) {
	e := auto_ban.Evidence{HTTPStatus: httpStatus}
	var envelope struct {
		Type             string            `json:"type"`
		Error            common.RawMessage `json:"error"`
		SafetyViolations []string          `json:"safety_violations"`
		Body             *struct {
			Error common.RawMessage `json:"error"`
		} `json:"body"`
		Response *struct {
			Status string            `json:"status"`
			Error  common.RawMessage `json:"error"`
		} `json:"response"`
	}
	decoded := common.Unmarshal(body, &envelope) == nil
	var errorBody []byte
	if decoded {
		if httpStatus < 400 && envelope.Type != "" && envelope.Type != "error" && envelope.Type != "upstream_error" && envelope.Type != "response.error" && envelope.Type != "response.failed" && envelope.Type != "response.done" && envelope.Type != "response.completed" && envelope.Type != "response" {
			return e, false
		}
		errorBody = envelope.Error
		if envelope.Body != nil && (envelope.Type == "error" || httpStatus >= 400) && len(errorBody) == 0 {
			errorBody = envelope.Body.Error
		}
		if (envelope.Type == "error" || envelope.Type == "upstream_error") && (len(errorBody) == 0 || string(errorBody) == "null") {
			errorBody = body
		}
		if envelope.Response != nil && (envelope.Type == "response.failed" || envelope.Type == "response.error" || envelope.Response.Status == "failed") {
			errorBody = envelope.Response.Error
		}
		e.Violations = envelope.SafetyViolations
	}
	if len(errorBody) == 0 || string(errorBody) == "null" {
		if httpStatus < 400 {
			return e, false
		}
		errorBody = body
	}
	var detail struct {
		Code             common.RawMessage `json:"code"`
		Message          string            `json:"message"`
		SafetyViolations []string          `json:"safety_violations"`
	}
	if common.Unmarshal(errorBody, &detail) == nil {
		_ = common.Unmarshal(detail.Code, &e.Code)
		e.Message = detail.Message
		e.Violations = append(e.Violations, detail.SafetyViolations...)
	} else if common.Unmarshal(errorBody, &e.Message) != nil {
		// Plain text is considered only for a failing HTTP response.
		if httpStatus < 400 {
			return e, false
		}
		e.Message = string(errorBody)
	}
	if len(e.Message) > 65536 {
		e.Message = e.Message[:65536]
	}
	if match := violationListPattern.FindStringSubmatch(e.Message); len(match) > 1 {
		for _, v := range strings.FieldsFunc(match[1], func(r rune) bool { return r == ',' || r == ' ' || r == '\t' || r == '\n' || r == '\'' || r == '"' }) {
			e.Violations = append(e.Violations, v)
		}
	}
	return e, e.Code != "" || e.Message != "" || len(e.Violations) > 0
}

func BeginAutoBanRequest(c *gin.Context) {
	c.Set(AutoBanRequestKey, uuid.NewString())
	c.Set(autoBanEnforcedKey, false)
}

func AutoBanEnforced(c *gin.Context) bool {
	return c != nil && c.GetBool(autoBanEnforcedKey)
}

// ObserveUpstreamFailure runs only after the relay identifies an upstream
// failure, before error masking or status-code remapping.
// No raw error body, prompt, credential or generated content is persisted.
func ObserveUpstreamFailure(ctx context.Context, body []byte, httpStatus int) bool {
	c, ok := ctx.(*gin.Context)
	if !ok || c == nil || c.GetInt("id") <= 0 {
		return false
	}
	settings := auto_ban.CurrentSnapshot()
	if settings.Mode() == "off" {
		return false
	}
	evidence, failed := ParseUpstreamFailure(body, httpStatus)
	if !failed {
		return false
	}
	rules := settings.Match(evidence, c.GetInt("channel_id"), c.GetString("original_model"))
	if len(rules) == 0 {
		return false
	}
	if settings.Mode() == "ban" {
		c.Set(autoBanEnforcedKey, true)
	}
	snapshot, err := common.Marshal(rules)
	if err != nil {
		return false
	}
	requestKey := c.GetString(AutoBanRequestKey)
	if requestKey == "" {
		requestKey = c.GetString(common.RequestIdKey)
		if requestKey == "" {
			requestKey = uuid.NewString()
		}
		c.Set(AutoBanRequestKey, requestKey)
	}
	digest := sha256.Sum256([]byte(fmt.Sprintf("%d:%s:%s", c.GetInt("id"), requestKey, settings.Version())))
	event := model.AutoBanEvent{
		EventKey: hex.EncodeToString(digest[:]), UserID: c.GetInt("id"),
		RequestID: c.GetString(common.RequestIdKey), UpstreamRequestID: c.GetString(common.UpstreamRequestIdKey),
		ChannelID: c.GetInt("channel_id"), Model: c.GetString("original_model"), TokenID: c.GetInt("token_id"),
		Version: settings.Version(), Mode: settings.Mode(), Reason: rules[0].Reason, Rules: string(snapshot), HTTPStatus: httpStatus,
		ErrorSummary: fmt.Sprintf("Upstream failure matched %d configured rule(s); HTTP status %d", len(rules), httpStatus),
	}
	if err := model.ApplyAutoBanEvent(&event); err != nil {
		// Error text can contain SQL bindings; log only the incident identifiers.
		common.SysError(fmt.Sprintf("automatic ban processing failed for user %d, request %s", event.UserID, event.RequestID))
	}
	return settings.Mode() == "ban"
}
