package controller

import (
	"fmt"
	"github.com/Calcium-Ion/go-epay/epay"
	"github.com/QuantumNous/new-api/service"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	cp "github.com/QuantumNous/new-api/pkg/campuspartner"
	"github.com/gin-gonic/gin"
)

// Host is supplied by the same-origin business ingress, which must preserve
// the original site. Never use a return URL, callback host or body parameter.
func CampusMainSite(c *gin.Context) bool {
	host := strings.ToLower(c.Request.Host)
	if parsed, _, err := net.SplitHostPort(host); err == nil {
		host = parsed
	}
	if host == "beiapi.cn" || host == "www.beiapi.cn" {
		return true
	}
	return os.Getenv("CAMPUS_PARTNER_LOCAL") == "1" && (host == "localhost" || host == "127.0.0.1" || host == "::1")
}
func CampusSiteGuard(c *gin.Context) {
	if !CampusMainSite(c) {
		c.AbortWithStatus(http.StatusNotFound)
		return
	}
	c.Next()
}

// CampusStatus exposes only campaign availability to unauthenticated registration.
func CampusStatus(c *gin.Context) {
	config, err := model.CampusGetConfig()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"enabled": config.Enabled})
}
func CampusInvite(c *gin.Context) {
	name, err := model.CampusValidateCode(strings.TrimSpace(c.Param("code")))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"inviter": name})
}
func CampusOverview(c *gin.Context) {
	result, err := model.CampusGetOverview(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}
func CampusJoin(c *gin.Context) {
	member, err := model.CampusJoin(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, member)
}
func CampusBind(c *gin.Context) {
	var req struct {
		Code string `json:"code"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, model.ErrCampusBinding)
		return
	}
	if err := model.CampusBind(c.GetInt("id"), req.Code); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
func CampusReminder(c *gin.Context) {
	show, err := model.CampusReminder(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"show": show})
}
func CampusList(c *gin.Context)      { campusList(c, false) }
func CampusAdminList(c *gin.Context) { campusList(c, true) }
func campusList(c *gin.Context, admin bool) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("size", "20"))
	if page < 1 || page > 100000 || size < 1 || size > 100 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	var rows any
	var total int64
	var err error
	if admin && c.Param("kind") == "invitations" {
		var filter model.CampusInvitationFilter
		if err := c.ShouldBindQuery(&filter); err != nil || (filter.StartTimestamp != nil && filter.EndTimestamp != nil && *filter.StartTimestamp > *filter.EndTimestamp) {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
		rows, total, err = model.CampusListAdminInvitations(filter, page, size)
	} else {
		var filter model.CampusRecordFilter
		if err := c.ShouldBindQuery(&filter); err != nil || (filter.StartTimestamp != nil && filter.EndTimestamp != nil && *filter.StartTimestamp > *filter.EndTimestamp) {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
		rows, total, err = model.CampusList(c.GetInt("id"), admin, c.Param("kind"), page, size, filter)
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"items": rows, "total": total, "page": page, "size": size})
}
func CampusWithdraw(c *gin.Context) {
	var req struct {
		RequestID string `json:"request_id"`
		Amount    string `json:"amount"`
		Account   string `json:"account"`
		Name      string `json:"name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	amount, err := cp.ParseMoney(req.Amount)
	if err != nil {
		common.ApiErrorT(c, "Enter a valid amount with at most two decimal places")
		return
	}
	row, err := model.CampusRequestWithdrawal(c.GetInt("id"), req.RequestID, req.Account, req.Name, amount)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, row)
}
func CampusConfig(c *gin.Context) {
	if c.Request.Method == http.MethodPut {
		var req struct {
			Enabled bool `json:"enabled"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
		if err := model.CampusConfigure(req.Enabled, c.GetInt("id")); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	config, err := model.CampusGetConfig()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, config)
}
func CampusConfigureTiers(c *gin.Context) {
	var req struct {
		Tiers    []cp.TierRule `json:"tiers"`
		Revision *int64        `json:"tier_revision"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Revision == nil || *req.Revision < 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := model.CampusConfigureTiers(req.Tiers, *req.Revision, c.GetInt("id")); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
func CampusConfigurePlanRates(c *gin.Context) {
	var req struct {
		Plans    []cp.PlanRate `json:"plan_rates"`
		Revision *int64        `json:"plan_revision"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Revision == nil || *req.Revision < 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := model.CampusConfigurePlanRates(req.Plans, *req.Revision, c.GetInt("id")); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
func CampusWithdrawalAction(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id < 1 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	var req struct {
		Action  string `json:"action"`
		Reason  string `json:"reason"`
		Receipt string `json:"receipt"`
		PaidAt  int64  `json:"paid_at"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err := model.CampusActWithdrawal(id, c.GetInt("id"), req.Action, req.Reason, req.Receipt, req.PaidAt); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
func CampusRefund(c *gin.Context) {
	var req struct {
		Trade     string    `json:"trade_no"`
		Reference string    `json:"reference"`
		Reason    string    `json:"reason"`
		Amount    string    `json:"amount"`
		Preview   bool      `json:"preview"`
		Expected  *cp.Money `json:"expected_refunded_cents"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	amount, err := cp.ParseMoney(req.Amount)
	if err != nil {
		common.ApiErrorT(c, "Enter a valid amount with at most two decimal places")
		return
	}
	var expected []cp.Money
	if !req.Preview {
		if req.Expected == nil {
			common.ApiError(c, model.ErrCampusState)
			return
		}
		expected = append(expected, *req.Expected)
	}
	result, err := model.CampusRegisterRefund(req.Trade, req.Reference, req.Reason, amount, c.GetInt("id"), req.Preview, expected...)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}

func CampusEpayReturn(c *gin.Context) {
	if err := c.Request.ParseForm(); err != nil {
		c.Redirect(http.StatusFound, "/wallet?pay=fail")
		return
	}
	params := map[string]string{}
	values := c.Request.URL.Query()
	if c.Request.Method == http.MethodPost {
		values = c.Request.PostForm
	}
	for key, value := range values {
		if len(value) != 1 {
			c.Redirect(http.StatusFound, "/wallet?pay=fail")
			return
		}
		params[key] = value[0]
	}
	client := GetEpayClient()
	if client == nil {
		c.Redirect(http.StatusFound, "/wallet?pay=fail")
		return
	}
	proof, err := client.Verify(params)
	if err != nil || !proof.VerifyStatus || proof.TradeStatus != "TRADE_SUCCESS" {
		c.Redirect(http.StatusFound, "/wallet?pay=fail")
		return
	}
	if _, err := model.RechargeEpay(proof.ServiceTradeNo, proof.Type, c.ClientIP(), model.CampusPaymentProof{Amount: proof.Money, Transaction: proof.TradeNo}); err != nil {
		c.Redirect(http.StatusFound, "/wallet?pay=fail")
		return
	}
	c.Redirect(http.StatusFound, "/wallet?pay=success")
}

func CampusReconcile(c *gin.Context) {
	var req struct {
		Trade     string `json:"trade_no"`
		Result    string `json:"result"`
		Evidence  string `json:"evidence"`
		Reference string `json:"reference"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || len(req.Evidence) < 5 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	var err error
	switch req.Result {
	case "paid":
		err = model.CampusReconcilePayment(req.Trade, req.Reference, req.Evidence, c.GetInt("id"), c.ClientIP())
	case "closed":
		err = model.CampusConfirmClosedOrder(req.Trade, c.GetInt("id"), req.Evidence)
	default:
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func CampusResumeCoupon(c *gin.Context) {
	var member model.CampusMember
	if err := model.DB.First(&member, "user_id = ?", c.GetInt("id")).Error; err != nil || member.CouponState != "reserved" {
		common.ApiError(c, model.ErrCampusCoupon)
		return
	}
	order := model.GetTopUpByTradeNo(member.CouponTrade)
	if order == nil || order.UserId != c.GetInt("id") || order.PaymentProvider != model.PaymentProviderEpay || order.Status != common.TopUpStatusPending {
		common.ApiError(c, model.ErrCampusCoupon)
		return
	}
	client := GetEpayClient()
	if client == nil {
		common.ApiErrorT(c, "Payment information has not been configured by administrator")
		return
	}
	callback, err := paymentReturnURLForRequest(c, "/api/user/epay/return")
	if err != nil {
		common.ApiErrorT(c, "Callback URL configuration error")
		return
	}
	notify, err := url.Parse(service.GetCallbackAddress() + "/api/user/epay/notify")
	if err != nil {
		common.ApiErrorT(c, "Callback URL configuration error")
		return
	}
	uri, params, err := client.Purchase(&epay.PurchaseArgs{Type: order.PaymentMethod, ServiceTradeNo: order.TradeNo, Name: fmt.Sprintf("TUC%d", order.Amount), Money: strconv.FormatFloat(order.Money, 'f', 2, 64), Device: epay.PC, NotifyUrl: notify, ReturnUrl: callback})
	if err != nil {
		common.ApiErrorT(c, "Failed to start payment")
		return
	}
	common.ApiSuccess(c, gin.H{"url": uri, "params": params})
}

func CampusMemberTier(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	if c.Request.Method == http.MethodPut {
		var req struct {
			Level          *int   `json:"level"`
			Revision       *int64 `json:"revision"`
			ConfigRevision *int64 `json:"config_revision"`
			Reason         string `json:"reason"`
		}
		if err := c.ShouldBindJSON(&req); err != nil || req.Level == nil || req.Revision == nil || req.ConfigRevision == nil {
			common.ApiErrorT(c, "Invalid parameters")
			return
		}
		if err := model.CampusSetMemberTier(id, *req.Level, *req.Revision, *req.ConfigRevision, req.Reason, c.GetInt("id")); err != nil {
			common.ApiError(c, err)
			return
		}
		common.ApiSuccess(c, nil)
		return
	}
	result, err := model.CampusGetMemberTier(id)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, result)
}
