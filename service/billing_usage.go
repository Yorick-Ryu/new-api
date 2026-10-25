package service

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
)

// estimatedCacheBillingUsage applies the missing-usage pricing policy to a
// private billing copy. It never claims that the provider reported a cache hit.
func estimatedCacheBillingUsage(c *gin.Context, info *relaycommon.RelayInfo, usage *dto.Usage) (*dto.Usage, int) {
	if c == nil || c.Request == nil || info == nil || !info.IsStream || usage == nil || usage.PromptTokens <= 0 ||
		!common.GetContextKeyBool(c, constant.ContextKeyMissingStreamUsage) ||
		usage.BillingUsage != nil || usage.UsageSource != "" || usage.Cost != nil {
		return usage, 0
	}
	// Use the original inbound UA, before any upstream header overrides. This
	// is a discount eligibility signal, not authenticated client identity.
	product, _, _ := strings.Cut(strings.ToLower(strings.TrimSpace(c.Request.UserAgent())), "/")
	switch product {
	case "codex", "codex desktop", "codex-tui", "codex_cli_rs", "codex-cli", "codex_vscode":
	default:
		return usage, 0
	}
	if info.RelayMode != relayconstant.RelayModeChatCompletions && info.RelayMode != relayconstant.RelayModeResponses {
		return usage, 0
	}
	format := info.GetFinalRequestRelayFormat()
	if format != types.RelayFormatOpenAI && format != types.RelayFormatOpenAIResponses {
		return usage, 0
	}
	if usage.UsageSemantic != "" && usage.UsageSemantic != dto.BillingUsageSemanticOpenAI ||
		usage.PromptTokensDetails != (dto.InputTokenDetails{}) || usage.InputTokensDetails != nil ||
		usage.CompletionTokenDetails.AudioTokens != 0 || usage.CompletionTokenDetails.ImageTokens != 0 || usage.OutputTokensDetails != nil ||
		usage.ClaudeCacheCreation5mTokens != 0 || usage.ClaudeCacheCreation1hTokens != 0 {
		return usage, 0
	}
	if info.PriceData.UsePrice || info.TieredBillingSnapshot != nil &&
		billingexpr.UsesFixedPricingByHash(info.TieredBillingSnapshot.ExprString, info.TieredBillingSnapshot.ExprHash) {
		return usage, 0
	}
	// floor(input * 9 / 10), without multiplying an unbounded int by nine.
	input := usage.PromptTokens
	cached := input/10*9 + input%10*9/10
	if cached == 0 {
		return usage, 0
	}
	billing := *usage
	billing.PromptTokensDetails.CachedTokens = cached
	return &billing, cached
}

const (
	usageBillingPathLocal              = "local"
	usageBillingPathUpstream           = "upstream"
	usageBillingPathOpenAI             = "billing-usage-openai"
	usageBillingPathOpenAIEstimated    = "billing-usage-openai-estimated"
	usageBillingPathAnthropic          = "billing-usage-anthropic"
	usageBillingPathAnthropicEstimated = "billing-usage-anthropic-estimated"
	usageBillingPathGemini             = "billing-usage-gemini"
	usageBillingPathGeminiEstimated    = "billing-usage-gemini-estimated"
)

func effectiveBillingUsage(usage *dto.Usage) *dto.Usage {
	if billingUsage, ok := usageFromBillingUsage(usage); ok {
		return billingUsage
	}
	return usage
}

func usageBillingPathForLog(isLocalCountTokens bool, usage *dto.Usage) string {
	effectiveUsage, ok := usageFromBillingUsage(usage)
	if !ok {
		if isLocalCountTokens {
			return usageBillingPathLocal
		}
		return usageBillingPathUpstream
	}

	switch effectiveUsage.UsageSemantic {
	case dto.BillingUsageSemanticOpenAI:
		if usage.BillingUsage.Estimated {
			return usageBillingPathOpenAIEstimated
		}
		return usageBillingPathOpenAI
	case dto.BillingUsageSemanticAnthropic:
		if usage.BillingUsage.Estimated {
			return usageBillingPathAnthropicEstimated
		}
		return usageBillingPathAnthropic
	case dto.BillingUsageSemanticGemini:
		if usage.BillingUsage.Estimated {
			return usageBillingPathGeminiEstimated
		}
		return usageBillingPathGemini
	}

	return usageBillingPathUpstream
}

func appendUsageBillingPathForLog(other *model.LogOther, isLocalCountTokens bool, usage *dto.Usage) {
	if other == nil {
		return
	}
	other.SetAdmin("usage_billing_path", usageBillingPathForLog(isLocalCountTokens, usage))
}

func usageFromBillingUsage(usage *dto.Usage) (*dto.Usage, bool) {
	if usage == nil || usage.BillingUsage == nil {
		return nil, false
	}
	return usage.BillingUsage.CanonicalUsage()
}
