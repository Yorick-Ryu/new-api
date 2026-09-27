package service

import (
	"fmt"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	hosttypes "github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

const (
	BillingSourceWallet       = "wallet"
	BillingSourceSubscription = "subscription"
)

// PreConsumeBilling 根据用户计费偏好创建 BillingSession 并执行预扣费。
// 会话存储在 relayInfo.Billing 上，供后续 Settle / Refund 使用。
func PreConsumeBilling(c *gin.Context, preConsumedQuota int, relayInfo *relaycommon.RelayInfo) *types.NewAPIError {
	if relayInfo != nil && relayInfo.QuotaClamp != nil {
		return types.NewErrorWithStatusCode(
			relayInfo.QuotaClamp,
			types.ErrorCodeModelPriceError,
			http.StatusBadRequest,
			types.ErrOptionWithSkipRetry(),
		)
	}
	if preConsumedQuota < 0 {
		return types.NewErrorWithStatusCode(
			fmt.Errorf("pre-consume quota cannot be negative: %d", preConsumedQuota),
			types.ErrorCodeModelPriceError,
			http.StatusBadRequest,
			types.ErrOptionWithSkipRetry(),
		)
	}
	session, apiErr := NewBillingSession(c, relayInfo, preConsumedQuota)
	if apiErr != nil {
		return apiErr
	}
	relayInfo.Billing = session
	return nil
}

// PrepareBillingForSelectedGroup reselects funding before a retry sends anything
// upstream. Legacy unrestricted subscriptions retain their existing snapshot.
func PrepareBillingForSelectedGroup(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	if info == nil {
		return nil
	}
	session, ok := info.Billing.(*BillingSession)
	if info.Billing != nil {
		if !ok || !session.groupRestricted || session.billingGroup == info.UsingGroup {
			return nil
		}
	} else {
		if !info.PriceData.FreeModel {
			return nil
		}
		eligibility, err := model.GetSubscriptionBillingEligibility(info.UserId, info.UsingGroup)
		if err != nil {
			return types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
		}
		if !eligibility.HasRestrictions {
			return nil
		}
	}
	groupRatio := hosttypes.GroupRatioInfo{GroupRatio: ratio_setting.GetGroupRatio(info.UsingGroup), GroupSpecialRatio: -1}
	if ratio, exists := ratio_setting.GetGroupGroupRatio(info.UserGroup, info.UsingGroup); exists {
		groupRatio.GroupRatio, groupRatio.GroupSpecialRatio, groupRatio.HasSpecialRatio = ratio, ratio, true
	}
	var quota int
	var beforeGroup float64
	var clamp *common.QuotaClamp
	if snap := info.TieredBillingSnapshot; snap != nil {
		beforeGroup = snap.EstimatedQuotaBeforeGroup
		quota, clamp = common.QuotaRoundChecked(beforeGroup * groupRatio.GroupRatio)
	} else if info.PriceData.QuotaBeforeGroup != nil {
		beforeGroup = info.PriceData.ApplyOtherRatiosToFloat(*info.PriceData.QuotaBeforeGroup)
		quota, clamp = common.QuotaFromFloatChecked(beforeGroup * groupRatio.GroupRatio)
	} else {
		return types.NewError(fmt.Errorf("group retry requires an unrounded billing estimate"), types.ErrorCodeModelPriceError, types.ErrOptionWithSkipRetry())
	}
	if clamp != nil {
		info.QuotaClamp = clamp
		return types.NewError(clamp, types.ErrorCodeModelPriceError, types.ErrOptionWithSkipRetry())
	}
	freeModel := beforeGroup == 0 || groupRatio.GroupRatio == 0
	pref := common.NormalizeBillingPreference(info.UserSetting.BillingPreference)
	if freeModel && pref != "wallet_only" && pref != "wallet_first" {
		hasOverride, err := model.HasActiveSubscriptionModelOverride(info.UserId, info.GetBillingModelName(), info.UsingGroup)
		if err != nil {
			return types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
		}
		freeModel = !hasOverride
	}
	attempt := 0
	if session != nil {
		if err := session.releaseForGroupRetry(); err != nil {
			return types.NewError(err, types.ErrorCodeUpdateDataError, types.ErrOptionWithSkipRetry())
		}
		attempt = session.billingAttempt + 1
	}
	info.Billing = nil
	info.BillingSource = ""
	info.FinalPreConsumedQuota = 0
	info.SubscriptionId, info.SubscriptionPlanId = 0, 0
	info.SubscriptionPlanTitle = ""
	info.SubscriptionPreConsumed, info.SubscriptionPostDelta = 0, 0
	info.SubscriptionAmountTotal, info.SubscriptionAmountUsedAfterPreConsume = 0, 0
	info.SubscriptionModelMultiplier, info.SubscriptionGroupRatio = 0, 0
	info.SubscriptionOriginalGroupRatio = nil
	info.PriceData.GroupRatioInfo = groupRatio
	info.PriceData.Quota, info.PriceData.QuotaToPreConsume = quota, quota
	info.PriceData.FreeModel = freeModel
	if snap := info.TieredBillingSnapshot; snap != nil {
		snap.GroupRatio, snap.EstimatedQuotaAfterGroup = groupRatio.GroupRatio, quota
	}
	next, apiErr := newBillingSession(c, info, quota, attempt)
	if apiErr != nil {
		return apiErr
	}
	info.Billing = next
	return nil
}

// ---------------------------------------------------------------------------
// SettleBilling — 后结算辅助函数
// ---------------------------------------------------------------------------

// SettleBilling 执行计费结算。如果 RelayInfo 上有 BillingSession 则通过 session 结算，
// 否则回退到旧的 PostConsumeQuota 路径（兼容按次计费等场景）。
func SettleBilling(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, actualQuota int) error {
	if relayInfo.Billing != nil {
		preConsumed := relayInfo.Billing.GetPreConsumedQuota()
		delta := actualQuota - preConsumed

		if delta > 0 {
			logger.LogInfo(ctx, fmt.Sprintf("预扣费后补扣费：%s（实际消耗：%s，预扣费：%s）",
				logger.FormatQuota(delta),
				logger.FormatQuota(actualQuota),
				logger.FormatQuota(preConsumed),
			))
		} else if delta < 0 {
			logger.LogInfo(ctx, fmt.Sprintf("预扣费后返还扣费：%s（实际消耗：%s，预扣费：%s）",
				logger.FormatQuota(-delta),
				logger.FormatQuota(actualQuota),
				logger.FormatQuota(preConsumed),
			))
		} else {
			logger.LogInfo(ctx, fmt.Sprintf("预扣费与实际消耗一致，无需调整：%s（按次计费）",
				logger.FormatQuota(actualQuota),
			))
		}

		if err := relayInfo.Billing.Settle(actualQuota); err != nil {
			return err
		}

		// 发送额度通知（订阅计费使用订阅剩余额度）
		if actualQuota != 0 {
			if relayInfo.BillingSource == BillingSourceSubscription {
				checkAndSendSubscriptionQuotaNotify(relayInfo)
			} else {
				checkAndSendQuotaNotify(relayInfo, actualQuota-preConsumed, preConsumed)
			}
		}
		return nil
	}

	// 回退：无 BillingSession 时使用旧路径
	quotaDelta := actualQuota - relayInfo.FinalPreConsumedQuota
	if quotaDelta != 0 {
		return PostConsumeQuota(relayInfo, quotaDelta, relayInfo.FinalPreConsumedQuota, true)
	}
	return nil
}
