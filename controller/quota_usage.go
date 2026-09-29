package controller

import (
	"net"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

// GetQuotaUsage returns only the authenticated key owner's quota snapshot.
// It intentionally does not reset counters, update tokens, or consume quota.
func GetQuotaUsage(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	userID, tokenID := c.GetInt("id"), c.GetInt("token_id")
	if userID <= 0 || tokenID <= 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": common.TranslateMessage(c, i18n.MsgTokenInvalid)})
		return
	}
	token, err := model.GetTokenByIds(tokenID, userID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": common.TranslateMessage(c, i18n.MsgTokenInvalid)})
		return
	}
	now := common.GetTimestamp()
	// Exhaustion does not revoke a key; it must still be able to show zero balance.
	if (token.Status != common.TokenStatusEnabled && token.Status != common.TokenStatusExhausted) || (token.ExpiredTime != -1 && token.ExpiredTime <= now) {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": common.TranslateMessage(c, i18n.MsgTokenStatusUnavailable)})
		return
	}
	if ips := token.GetIpLimits(); len(ips) > 0 && !common.IsIpInCIDRList(net.ParseIP(c.ClientIP()), ips) {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": common.TranslateMessage(c, i18n.MsgTokenStatusUnavailable)})
		return
	}
	user, err := model.GetUserById(userID, false)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgDatabaseError)
		return
	}
	if user.Status != common.UserStatusEnabled {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": common.TranslateMessage(c, i18n.MsgAuthUserBanned)})
		return
	}
	subscriptions, err := model.GetAllActiveUserSubscriptions(userID)
	if err != nil {
		common.ApiErrorI18n(c, i18n.MsgDatabaseError)
		return
	}
	planIDs := make([]int, 0, len(subscriptions))
	for _, summary := range subscriptions {
		planIDs = append(planIDs, summary.Subscription.PlanId)
	}
	var plans []model.SubscriptionPlan
	if len(planIDs) > 0 {
		if err := model.DB.Select("id", "title", "quota_reset_period", "quota_reset_custom_seconds").Where("id IN ?", planIDs).Find(&plans).Error; err != nil {
			common.ApiErrorI18n(c, i18n.MsgDatabaseError)
			return
		}
	}
	planByID := make(map[int]model.SubscriptionPlan, len(plans))
	for _, plan := range plans {
		planByID[plan.Id] = plan
	}
	items := make([]gin.H, 0, len(subscriptions))
	for _, summary := range subscriptions {
		sub := summary.Subscription
		plan := planByID[sub.PlanId]
		periodUnit, periodValue := "never", int64(0)
		switch model.NormalizeResetPeriod(plan.QuotaResetPeriod) {
		case model.SubscriptionResetDaily:
			periodUnit, periodValue = "day", 1
		case model.SubscriptionResetWeekly:
			periodUnit, periodValue = "week", 1
		case model.SubscriptionResetMonthly:
			periodUnit, periodValue = "month", 1
		case model.SubscriptionResetCustom:
			periodUnit, periodValue = "second", plan.QuotaResetCustomSeconds
		}
		windows := make([]quotaUsageWindow, 0, 1+len(summary.QuotaWindows))
		windows = append(windows, newQuotaUsageWindow("primary", "主额度", periodUnit, periodValue, sub.AmountTotal, sub.AmountUsed, sub.NextResetTime, now))
		for _, w := range summary.QuotaWindows {
			windows = append(windows, newQuotaUsageWindow(w.WindowKey, w.Name, w.PeriodUnit, int64(w.PeriodValue), w.AmountTotal, w.AmountUsed, w.NextResetTime, now))
		}
		items = append(items, gin.H{"id": sub.Id, "name": plan.Title, "expires_at": sub.EndTime, "windows": windows})
	}
	var tokenRemaining any
	if !token.UnlimitedQuota {
		tokenRemaining = token.RemainQuota
	}
	common.ApiSuccess(c, gin.H{
		"object": "quota_snapshot", "as_of": now,
		"unit":          gin.H{"type": "quota", "quota_per_unit": common.QuotaPerUnit, "display_type": operation_setting.GetQuotaDisplayType(), "usd_exchange_rate": operation_setting.USDExchangeRate},
		"wallet":        gin.H{"remaining": user.Quota},
		"token":         gin.H{"remaining": tokenRemaining, "used": token.UsedQuota, "unlimited": token.UnlimitedQuota, "expires_at": token.ExpiredTime},
		"subscriptions": items,
	})
}

// quotaUsageWindow uses the same contract for primary and additional limits.
// Amounts are raw quota units; percentages describe usage, not remaining quota.
type quotaUsageWindow struct {
	Key                   string   `json:"key"`
	Name                  string   `json:"name"`
	PeriodUnit            string   `json:"period_unit"`
	PeriodValue           int64    `json:"period_value"`
	WindowDurationSeconds *int64   `json:"window_duration_seconds"`
	Total                 int64    `json:"total"`
	Used                  int64    `json:"used"`
	Remaining             *int64   `json:"remaining"`
	UsedPercent           *float64 `json:"used_percent"`
	Unlimited             bool     `json:"unlimited"`
	ResetsAt              *int64   `json:"resets_at"`
	ResetPending          bool     `json:"reset_pending"`
}

func newQuotaUsageWindow(key, name, periodUnit string, periodValue, total, used, resetsAt, now int64) quotaUsageWindow {
	window := quotaUsageWindow{Key: key, Name: name, PeriodUnit: periodUnit, PeriodValue: periodValue, Total: total, Used: used, Unlimited: total == 0}
	if total > 0 {
		remaining := max(int64(0), total-used)
		percent := float64(used) / float64(total) * 100
		window.Remaining = &remaining
		window.UsedPercent = &percent
	}
	var secondsPerUnit int64
	switch periodUnit {
	case "second":
		secondsPerUnit = 1
	case "hour":
		secondsPerUnit = 3600
	case "day":
		secondsPerUnit = 86400
	case "week":
		secondsPerUnit = 604800
	}
	// Calendar months have no fixed duration. Never invent a 30-day duration.
	if secondsPerUnit > 0 && periodValue > 0 && periodValue <= int64(^uint64(0)>>1)/secondsPerUnit {
		duration := periodValue * secondsPerUnit
		window.WindowDurationSeconds = &duration
	}
	if resetsAt > 0 {
		window.ResetsAt = &resetsAt
		window.ResetPending = resetsAt <= now
	}
	return window
}
