package controller

import (
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

// Only catalog display fields are exposed. Provider product IDs, account data,
// upgrade groups and internal billing configuration remain authenticated.
type PlansPageSubscription struct {
	ID                      int     `json:"id"`
	Title                   string  `json:"title"`
	Subtitle                string  `json:"subtitle"`
	PriceAmount             float64 `json:"price_amount"`
	DurationUnit            string  `json:"duration_unit"`
	DurationValue           int     `json:"duration_value"`
	CustomSeconds           int64   `json:"custom_seconds"`
	TotalAmount             int64   `json:"total_amount"`
	QuotaResetPeriod        string  `json:"quota_reset_period"`
	QuotaResetCustomSeconds int64   `json:"quota_reset_custom_seconds"`
	QuotaWindows            string  `json:"quota_windows"`
	MaxPurchasePerUser      int     `json:"max_purchase_per_user"`
	AllowRenewal            bool    `json:"allow_renewal"`
}

// Amount remains in the wallet API's configured request units; Credits is
// the USD balance credited by the existing settlement conversion.
type PlansPageTopup struct {
	Amount  int64   `json:"amount"`
	Credits float64 `json:"credits"`
	Money   string  `json:"money"`
}

type plansPageAccess struct {
	Enabled     bool `json:"enabled"`
	RequireAuth bool `json:"requireAuth"`
}

func currentPlansPageAccess() plansPageAccess {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap["HeaderNavModules"]
	common.OptionMapRWMutex.RUnlock()
	access := plansPageAccess{Enabled: true}
	if strings.TrimSpace(raw) == "" {
		return access
	}
	var modules map[string]any
	if common.UnmarshalJsonStr(raw, &modules) != nil {
		return plansPageAccess{RequireAuth: true}
	}
	value, exists := modules["plans"]
	if !exists {
		return access
	}
	switch v := value.(type) {
	case bool:
		access.Enabled = v
	case map[string]any:
		if rawEnabled, ok := v["enabled"]; ok {
			enabled, valid := rawEnabled.(bool)
			if !valid {
				return plansPageAccess{RequireAuth: true}
			}
			access.Enabled = enabled
		}
		if rawAuth, ok := v["requireAuth"]; ok {
			required, valid := rawAuth.(bool)
			if !valid {
				return plansPageAccess{RequireAuth: true}
			}
			access.RequireAuth = required
		}
	default:
		return plansPageAccess{RequireAuth: true}
	}
	return access
}

func GetPlansPageCatalog(c *gin.Context) {
	access := currentPlansPageAccess()
	if !access.Enabled {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}
	if access.RequireAuth || c.GetHeader("Authorization") != "" {
		middleware.UserAuth()(c)
		if c.IsAborted() {
			return
		}
	}
	catalog := struct {
		Subscriptions []PlansPageSubscription `json:"subscriptions"`
		TopupAmounts  []int                   `json:"topup_amounts"`
		TopupOptions  []PlansPageTopup        `json:"topup_options"`
	}{Subscriptions: []PlansPageSubscription{}, TopupAmounts: []int{}, TopupOptions: []PlansPageTopup{}}
	if !operation_setting.IsPaymentComplianceConfirmed() {
		common.ApiSuccess(c, catalog)
		return
	}
	var plans []model.SubscriptionPlan
	if err := model.DB.Where("enabled = ?", true).Order("sort_order desc, id desc").Find(&plans).Error; err != nil {
		common.ApiError(c, err)
		return
	}
	for _, plan := range plans {
		plan.NormalizeDefaults()
		catalog.Subscriptions = append(catalog.Subscriptions, PlansPageSubscription{
			ID: plan.Id, Title: plan.Title, Subtitle: plan.Subtitle, PriceAmount: plan.PriceAmount,
			DurationUnit: plan.DurationUnit, DurationValue: plan.DurationValue, CustomSeconds: plan.CustomSeconds,
			TotalAmount: plan.TotalAmount, QuotaResetPeriod: plan.QuotaResetPeriod, QuotaResetCustomSeconds: plan.QuotaResetCustomSeconds, QuotaWindows: plan.QuotaWindows,
			MaxPurchasePerUser: plan.MaxPurchasePerUser, AllowRenewal: plan.AllowRenewal != nil && *plan.AllowRenewal,
		})
	}
	catalog.TopupAmounts = append(catalog.TopupAmounts, operation_setting.GetPaymentSetting().AmountOptions...)
	// Never accept a group from the request. Signed-in prices use the group
	// validated by UserAuth; visitors see the standard default-group quote.
	group := c.GetString("group")
	if group == "" {
		group = "default"
	}
	seen := make(map[int]bool)
	for _, amount := range operation_setting.GetPaymentSetting().AmountOptions {
		if seen[amount] || int64(amount) < getMinTopup() {
			continue
		}
		seen[amount] = true
		quota, err := getTopUpQuota(int64(amount))
		if err != nil || quota <= 0 {
			continue
		}
		money := getPayMoney(int64(amount), group)
		if math.IsNaN(money) || math.IsInf(money, 0) || money <= 0.01 {
			continue
		}
		catalog.TopupOptions = append(catalog.TopupOptions, PlansPageTopup{
			Amount: int64(amount), Credits: float64(quota) / common.QuotaPerUnit,
			Money: strconv.FormatFloat(money, 'f', 2, 64),
		})
	}
	common.ApiSuccess(c, catalog)
}
