package service

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
)

// ResponsesUsageAccumulator shares accounting between HTTP SSE and WebSocket.
// The stream owner must serialize Observe and Finish. Finish freezes the usage
// so a late event cannot change a request that has already been settled.
type ResponsesUsageAccumulator struct {
	info           *relaycommon.RelayInfo
	usage          *dto.Usage
	outputText     strings.Builder
	imageCounter   relaycommon.ImageGenerationCallCounter
	imageCommitted bool
	started        bool
	reportedUsage  bool
	failed         bool
	finished       bool
}

func NewResponsesUsageAccumulator(info *relaycommon.RelayInfo) *ResponsesUsageAccumulator {
	return &ResponsesUsageAccumulator{info: info, usage: &dto.Usage{}}
}

func (a *ResponsesUsageAccumulator) Observe(event *dto.ResponsesStreamResponse) {
	if a == nil || event == nil || a.finished {
		return
	}
	a.started = true
	var status string
	if event.Response != nil {
		a.info.ObserveResponseModel(event.Response.Model)
		_ = common.Unmarshal(event.Response.Status, &status)
	}
	a.failed = a.failed || IsResponsesFailure(event) || status == "failed"
	ObserveResponsesOutcome(a.info, event)
	switch event.Type {
	case "response.completed", "response.done", "response.failed", "response.incomplete", "response.cancelled", "response.canceled", "error", "response.error":
		if event.Response != nil {
			if event.Response.Usage != nil {
				// A provider's explicit zero is authoritative too.
				a.usage = &dto.Usage{}
				ApplyResponsesUsage(a.usage, event.Response.Usage)
				a.reportedUsage = true
			}
			if a.outputText.Len() == 0 {
				for _, output := range event.Response.Output {
					if output.Type == dto.BuildInCallFunctionCall {
						a.outputText.WriteString(output.ArgumentsString())
					}
					for _, content := range output.Content {
						a.outputText.WriteString(content.Text)
					}
				}
			}
		}
		if !a.imageCommitted {
			if a.failed || (event.Type != "response.completed" && event.Type != "response.done") ||
				(event.Response != nil && relaycommon.IsNonBillableResponsesStatus(event.Response.Status)) {
				a.imageCounter.Reset()
			} else if event.Response != nil {
				for i := range event.Response.Output {
					a.imageCounter.Observe(&event.Response.Output[i], &i)
				}
			}
			a.imageCounter.Commit(a.info)
			a.imageCommitted = true
		}
	case "response.output_text.delta", "response.function_call_arguments.delta",
		"response.reasoning_summary_text.delta", "response.reasoning_text.delta", "response.refusal.delta":
		a.outputText.WriteString(event.Delta)
	case dto.ResponsesOutputTypeItemDone:
		if event.Item == nil {
			return
		}
		switch event.Item.Type {
		case dto.BuildInCallWebSearchCall, dto.BuildInCallFileSearchCall, dto.BuildInCallFunctionCall:
			a.info.CountBillableToolCall(event.Item.Type, event.Item.Name)
		case dto.ResponsesOutputTypeImageGenerationCall:
			if !a.imageCommitted {
				a.imageCounter.Observe(event.Item, event.OutputIndex)
			}
		}
	}
}

func (a *ResponsesUsageAccumulator) Finish() *dto.Usage {
	if a.finished {
		return a.usage
	}
	a.finished = true
	if !a.imageCommitted {
		a.imageCounter.Commit(a.info)
		a.imageCommitted = true
	}
	// Explicit failures settle only provider usage. An ordinary disconnect may
	// still owe input and generated tool/reasoning/text output tokens.
	if !a.failed && !a.reportedUsage {
		if output := a.outputText.String(); output != "" {
			a.usage.CompletionTokens = CountTextToken(output, a.info.UpstreamModelName)
		}
		if a.started {
			a.usage.PromptTokens = a.info.GetEstimatePromptTokens()
		}
	}
	if a.usage.TotalTokens == 0 {
		a.usage.TotalTokens = a.usage.PromptTokens + a.usage.CompletionTokens
	}
	return a.usage
}

// ObserveResponsesOutcome records the protocol outcome of one Responses event
// on the stream status for health classification. Only codes and types are
// kept; messages never leave the event.
func ObserveResponsesOutcome(info *relaycommon.RelayInfo, event *dto.ResponsesStreamResponse) {
	if info == nil || info.StreamStatus == nil || event == nil {
		return
	}
	var responseStatus string
	if event.Response != nil {
		_ = common.Unmarshal(event.Response.Status, &responseStatus)
	}
	switch {
	case event.Type == "error" || event.Type == "response.failed" || event.Type == "response.error" || responseStatus == "failed":
		code, errorType := event.Code, ""
		oaiErr := dto.GetOpenAIError(event.Error)
		if event.Response != nil && event.Response.Error != nil {
			oaiErr = event.Response.GetOpenAIError()
		}
		if oaiErr != nil {
			if oaiErr.Code != nil {
				code = fmt.Sprint(oaiErr.Code)
			}
			errorType = oaiErr.Type
		}
		info.StreamStatus.MarkFailed(code, errorType, 0)
	case event.Type == "response.incomplete" || responseStatus == "incomplete":
		reason := ""
		if event.Response != nil && event.Response.IncompleteDetails != nil {
			reason = event.Response.IncompleteDetails.Reason
		}
		info.StreamStatus.MarkIncomplete(reason)
	case event.Type == "response.cancelled" || event.Type == "response.canceled" || responseStatus == "cancelled":
		info.StreamStatus.MarkCancelled()
	case event.Type == "response.completed" || event.Type == "response.done" || responseStatus == "completed":
		info.StreamStatus.MarkCompleted()
	}
}

func ApplyResponsesUsage(dst *dto.Usage, src *dto.Usage) {
	if dst == nil || src == nil {
		return
	}
	if src.InputTokens != 0 {
		dst.PromptTokens = src.InputTokens
		dst.InputTokens = src.InputTokens
	}
	if src.OutputTokens != 0 {
		dst.CompletionTokens = src.OutputTokens
		dst.OutputTokens = src.OutputTokens
	}
	if src.TotalTokens != 0 {
		dst.TotalTokens = src.TotalTokens
	}
	if src.InputTokensDetails != nil {
		inputDetails := *src.InputTokensDetails
		dst.InputTokensDetails = &inputDetails
		dst.PromptTokensDetails = inputDetails
	}
	outputDetails := src.CompletionTokenDetails
	if src.OutputTokensDetails != nil {
		outputDetails = *src.OutputTokensDetails
	}
	if !isZeroOutputTokenDetails(outputDetails) {
		dst.CompletionTokenDetails = outputDetails
		dst.OutputTokensDetails = &outputDetails
	}
	dst.PromptCacheHitTokens = src.PromptCacheHitTokens
	dst.UsageSemantic = src.UsageSemantic
	dst.UsageSource = src.UsageSource
}

func isZeroOutputTokenDetails(details dto.OutputTokenDetails) bool {
	return details.TextTokens == 0 &&
		details.AudioTokens == 0 &&
		details.ImageTokens == 0 &&
		details.ReasoningTokens == 0
}
