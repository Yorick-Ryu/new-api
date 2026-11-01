package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/Calcium-Ion/go-epay/epay"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupEpayReturnSettings(t *testing.T) {
	t.Helper()
	address, id, key := operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey
	callback, server := operation_setting.CustomCallbackAddress, system_setting.ServerAddress
	methods := operation_setting.PayMethods
	site, allowed := system_setting.SiteAddress, system_setting.SiteAllowedOrigins
	system_setting.SiteAddress = "https://beiapi.cn"
	system_setting.SiteAllowedOrigins = "https://www.beiapi.cn,https://novapi.cn,http://localhost:3000"
	operation_setting.PayAddress = "https://pay.example.com"
	operation_setting.EpayId = "test-merchant"
	operation_setting.EpayKey = "test-only-signing-key"
	operation_setting.CustomCallbackAddress = "https://notify.example.com"
	system_setting.ServerAddress = "https://api.example.com"
	operation_setting.PayMethods = []map[string]string{{"type": "alipay", "name": "Alipay"}}
	t.Cleanup(func() {
		operation_setting.PayAddress, operation_setting.EpayId, operation_setting.EpayKey = address, id, key
		operation_setting.CustomCallbackAddress, system_setting.ServerAddress = callback, server
		operation_setting.PayMethods = methods
		system_setting.SiteAddress, system_setting.SiteAllowedOrigins = site, allowed
	})
}

func TestSubscriptionEpayCheckoutReturnsToPurchasingOrigin(t *testing.T) {
	for _, origin := range []string{"https://beiapi.cn", "https://www.beiapi.cn", "https://novapi.cn", "http://localhost:3000"} {
		t.Run(origin, func(t *testing.T) {
			db, user, plan, sub := setupSubscriptionRenewalControllerTest(t)
			setupEpayReturnSettings(t)
			writer := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(writer)
			ctx.Set("id", user.Id)
			ctx.Request = httptest.NewRequest(http.MethodPost, origin+"/api/subscription/epay/pay", strings.NewReader(fmt.Sprintf(`{"plan_id":%d,"renewal_subscription_id":%d,"payment_method":"alipay"}`, plan.Id, sub.Id)))
			ctx.Request.Header.Set("Content-Type", "application/json")
			ctx.Request.Header.Set("Origin", "https://unrelated.example")
			ctx.Request.Header.Set("X-Forwarded-Host", "unrelated.example")
			SubscriptionRequestEpay(ctx)
			var response struct {
				Message string            `json:"message"`
				Data    map[string]string `json:"data"`
			}
			require.NoError(t, common.Unmarshal(writer.Body.Bytes(), &response))
			require.Equal(t, "success", response.Message)
			assert.Equal(t, origin+"/api/subscription/epay/return", response.Data["return_url"])
			assert.Equal(t, "https://notify.example.com/api/subscription/epay/notify", response.Data["notify_url"])
			var order model.SubscriptionOrder
			require.NoError(t, db.First(&order).Error)
			assert.Equal(t, sub.Id, order.RenewalSubscriptionId)
		})
	}
}

func TestSubscriptionEpaySuccessfulReturnPreservesOriginAndOrderIdempotency(t *testing.T) {
	db, user, plan, sub := setupSubscriptionRenewalControllerTest(t)
	setupEpayReturnSettings(t)
	require.NoError(t, db.AutoMigrate(&model.TopUp{}))
	order := model.SubscriptionOrder{UserId: user.Id, PlanId: plan.Id, RenewalSubscriptionId: sub.Id, TradeNo: "same-origin-renewal", Money: plan.PriceAmount, PaymentProvider: model.PaymentProviderEpay, PaymentMethod: "alipay", Status: common.TopUpStatusPending}
	require.NoError(t, order.Insert())
	params := epay.GenerateParams(map[string]string{"pid": operation_setting.EpayId, "out_trade_no": order.TradeNo, "trade_no": "test-gateway-order", "trade_status": epay.StatusTradeSuccess, "type": "alipay", "money": "1.00", "sign_type": "MD5"}, operation_setting.EpayKey)
	values := url.Values{}
	for key, value := range params {
		values.Set(key, value)
	}
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		t.Run(method, func(t *testing.T) {
			writer := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(writer)
			callback := "https://www.beiapi.cn/api/subscription/epay/return"
			if method == http.MethodGet {
				ctx.Request = httptest.NewRequest(method, callback+"?"+values.Encode(), nil)
			} else {
				ctx.Request = httptest.NewRequest(method, callback, strings.NewReader(values.Encode()))
				ctx.Request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			}
			SubscriptionEpayReturn(ctx)
			ctx.Writer.WriteHeaderNow()
			require.Equal(t, http.StatusFound, writer.Code)
			location, err := url.Parse(writer.Header().Get("Location"))
			require.NoError(t, err)
			assert.Equal(t, "https://www.beiapi.cn/wallet?pay=success", ctx.Request.URL.ResolveReference(location).String())
			var renewed model.UserSubscription
			require.NoError(t, db.First(&renewed, sub.Id).Error)
			assert.Equal(t, sub.EndTime+30*86400, renewed.EndTime)
			var updated model.SubscriptionOrder
			require.NoError(t, db.First(&updated, order.Id).Error)
			assert.Equal(t, common.TopUpStatusSuccess, updated.Status)
		})
	}
}

func TestSubscriptionEpayInvalidReturnStaysOnCallbackOrigin(t *testing.T) {
	setupEpayReturnSettings(t)
	for _, query := range []string{"", "?out_trade_no=missing&sign=invalid"} {
		writer := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(writer)
		ctx.Request = httptest.NewRequest(http.MethodGet, "https://beiapi.cn/api/subscription/epay/return"+query, nil)
		SubscriptionEpayReturn(ctx)
		assert.Equal(t, http.StatusFound, writer.Code)
		assert.Equal(t, "/wallet?pay=fail", writer.Header().Get("Location"))
	}
}

func TestSubscriptionEpayInvalidOriginDoesNotCreateAnOrder(t *testing.T) {
	db, user, plan, sub := setupSubscriptionRenewalControllerTest(t)
	setupEpayReturnSettings(t)
	writer := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(writer)
	ctx.Set("id", user.Id)
	ctx.Request = httptest.NewRequest(http.MethodPost, "http://beiapi.cn/api/subscription/epay/pay", strings.NewReader(fmt.Sprintf(`{"plan_id":%d,"renewal_subscription_id":%d,"payment_method":"alipay"}`, plan.Id, sub.Id)))
	ctx.Request.Header.Set("Content-Type", "application/json")
	ctx.Request.Header.Set("X-Forwarded-Proto", "javascript")
	SubscriptionRequestEpay(ctx)
	var response struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(writer.Body.Bytes(), &response))
	assert.False(t, response.Success)
	var orders int64
	require.NoError(t, db.Model(&model.SubscriptionOrder{}).Count(&orders).Error)
	assert.Zero(t, orders)
}

func TestEpayWalletTopupReturnsToPurchasingOrigin(t *testing.T) {
	// GetUserGroup uses dialect-specific column names initialized at startup.
	previousDB := model.DB
	initModelListColumnNames(t)
	model.DB = previousDB
	db, user, _, _ := setupSubscriptionRenewalControllerTest(t)
	setupEpayReturnSettings(t)
	require.NoError(t, db.AutoMigrate(&model.TopUp{}))
	previousMinimum, previousPrice := operation_setting.MinTopUp, operation_setting.Price
	operation_setting.MinTopUp, operation_setting.Price = 1, 1
	t.Cleanup(func() { operation_setting.MinTopUp, operation_setting.Price = previousMinimum, previousPrice })
	writer := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(writer)
	ctx.Set("id", user.Id)
	ctx.Request = httptest.NewRequest(http.MethodPost, "https://www.beiapi.cn/api/user/epay/pay", strings.NewReader(`{"amount":10,"payment_method":"alipay"}`))
	ctx.Request.Header.Set("Content-Type", "application/json")
	RequestEpay(ctx)
	var response struct {
		Message string            `json:"message"`
		Data    map[string]string `json:"data"`
	}
	require.NoError(t, common.Unmarshal(writer.Body.Bytes(), &response))
	require.Equal(t, "success", response.Message)
	assert.Equal(t, "https://www.beiapi.cn/api/user/epay/return", response.Data["return_url"])
	assert.Equal(t, "https://notify.example.com/api/user/epay/notify", response.Data["notify_url"])
	var topups int64
	require.NoError(t, db.Model(&model.TopUp{}).Count(&topups).Error)
	assert.EqualValues(t, 1, topups)
}

func TestCampusEpayVerifiedSettlementIsAtomicAndIsolated(t *testing.T) {
	previousDB := model.DB
	initModelListColumnNames(t)
	model.DB = previousDB
	db, buyer, plan, subscription := setupSubscriptionRenewalControllerTest(t)
	setupEpayReturnSettings(t)
	require.NoError(t, db.AutoMigrate(&model.TopUp{}))
	require.NoError(t, model.InitializeCampusPartner(db))
	inviter := model.User{Username: "campus-inviter", AffCode: "separate-old-code", Status: common.UserStatusEnabled}
	require.NoError(t, db.Create(&inviter).Error)
	ultra := model.SubscriptionPlan{Title: "Ultra", Enabled: true}
	require.NoError(t, db.Create(&ultra).Error)
	require.NoError(t, model.CampusConfigure(true, plan.Id, ultra.Id, inviter.Id))
	member, err := model.CampusJoin(inviter.Id)
	require.NoError(t, err)
	require.NoError(t, model.CampusBind(buyer.Id, member.Code))
	previousMinimum, previousPrice := operation_setting.MinTopUp, operation_setting.Price
	operation_setting.MinTopUp, operation_setting.Price = 1, 1
	t.Cleanup(func() { operation_setting.MinTopUp, operation_setting.Price = previousMinimum, previousPrice })
	writer := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(writer)
	ctx.Set("id", buyer.Id)
	ctx.Request = httptest.NewRequest(http.MethodPost, "https://beiapi.cn/api/user/epay/pay", strings.NewReader(`{"amount":200,"payment_method":"alipay","campus_coupon":true}`))
	ctx.Request.Header.Set("Content-Type", "application/json")
	RequestEpay(ctx)
	var order model.TopUp
	require.NoError(t, db.First(&order).Error)
	assert.Equal(t, 190.0, order.Money)
	var campaign model.CampusPayment
	require.NoError(t, db.Where("trade_no = ?", order.TradeNo).First(&campaign).Error)
	assert.True(t, campaign.MainSite)
	assert.EqualValues(t, 19000, campaign.Paid)
	callback := func(trade, reference, amount string, handler gin.HandlerFunc) *httptest.ResponseRecorder {
		t.Helper()
		params := epay.GenerateParams(map[string]string{"pid": operation_setting.EpayId, "out_trade_no": trade, "trade_no": reference, "trade_status": epay.StatusTradeSuccess, "type": "alipay", "money": amount, "sign_type": "MD5"}, operation_setting.EpayKey)
		values := url.Values{}
		for key, value := range params {
			values.Set(key, value)
		}
		response := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(response)
		c.Request = httptest.NewRequest(http.MethodGet, "https://notify.example.com/callback?"+values.Encode(), nil)
		handler(c)
		return response
	}
	// Even a valid signature cannot underpay the immutable checkout amount.
	response := callback(order.TradeNo, "provider-tx-1", "189.00", CampusEpayReturn)
	assert.Equal(t, "/wallet?pay=fail", response.Header().Get("Location"))
	var current model.User
	require.NoError(t, db.First(&current, buyer.Id).Error)
	assert.Equal(t, buyer.Quota, current.Quota)
	overview, err := model.CampusGetOverview(inviter.Id)
	require.NoError(t, err)
	assert.Zero(t, overview.Net)
	for _, handler := range []gin.HandlerFunc{CampusEpayReturn, EpayNotify, CampusEpayReturn} {
		callback(order.TradeNo, "provider-tx-1", "190.00", handler)
	}
	require.NoError(t, db.First(&current, buyer.Id).Error)
	assert.EqualValues(t, buyer.Quota+int(200*common.QuotaPerUnit), current.Quota)
	overview, err = model.CampusGetOverview(inviter.Id)
	require.NoError(t, err)
	assert.EqualValues(t, 5700, overview.Net)
	assert.EqualValues(t, 19000, overview.Member.Performance)
	buyerOverview, err := model.CampusGetOverview(buyer.Id)
	require.NoError(t, err)
	assert.Equal(t, "used", buyerOverview.Member.CouponState)
	assert.False(t, buyerOverview.CanBind)
	// One actual provider transaction cannot credit a second order.
	duplicate := model.TopUp{UserId: buyer.Id, TradeNo: "duplicate-provider", Money: 190, Amount: 200, Status: common.TopUpStatusPending, PaymentProvider: model.PaymentProviderEpay, PaymentMethod: "alipay"}
	require.NoError(t, model.InsertCampusTopUp(&duplicate, true, "CNY", false))
	response = callback(duplicate.TradeNo, "provider-tx-1", "190.00", CampusEpayReturn)
	assert.Equal(t, "/wallet?pay=fail", response.Header().Get("Location"))
	require.NoError(t, db.First(&current, buyer.Id).Error)
	assert.EqualValues(t, buyer.Quota+int(200*common.QuotaPerUnit), current.Quota)
	require.NoError(t, db.First(&duplicate, duplicate.Id).Error)
	assert.Equal(t, common.TopUpStatusPending, duplicate.Status)
	// A main-site callback cannot change a different brand's checkout origin.
	foreign := model.TopUp{UserId: buyer.Id, TradeNo: "foreign-origin", Money: 100, Amount: 100, Status: common.TopUpStatusPending, PaymentProvider: model.PaymentProviderEpay, PaymentMethod: "alipay"}
	require.NoError(t, model.InsertCampusTopUp(&foreign, false, "CNY", false))
	callback(foreign.TradeNo, "provider-tx-2", "100.00", CampusEpayReturn)
	overview, err = model.CampusGetOverview(inviter.Id)
	require.NoError(t, err)
	assert.EqualValues(t, 19000, overview.Member.Performance)
	// A subscription renewal and its top-up summary count only once at the fixed Plus rate.
	renewal := model.SubscriptionOrder{UserId: buyer.Id, PlanId: plan.Id, RenewalSubscriptionId: subscription.Id, TradeNo: "campus-renewal", Money: 1, PaymentProvider: model.PaymentProviderEpay, PaymentMethod: "alipay", Status: common.TopUpStatusPending}
	require.NoError(t, model.InsertCampusSubscription(&renewal, true, "CNY"))
	callback(renewal.TradeNo, "provider-tx-3", "1.00", SubscriptionEpayReturn)
	callback(renewal.TradeNo, "provider-tx-3", "1.00", SubscriptionEpayNotify)
	overview, err = model.CampusGetOverview(inviter.Id)
	require.NoError(t, err)
	assert.EqualValues(t, 5705, overview.Net)
	assert.EqualValues(t, 19100, overview.Member.Performance)
	var summaries int64
	require.NoError(t, db.Model(&model.TopUp{}).Where("trade_no = ?", renewal.TradeNo).Count(&summaries).Error)
	assert.EqualValues(t, 1, summaries)
}

func TestCampusSiteGuardIgnoresClientOriginAndForwardedHost(t *testing.T) {
	t.Setenv("CAMPUS_PARTNER_LOCAL", "0")
	r := gin.New()
	r.GET("/campus", CampusSiteGuard, func(c *gin.Context) { c.Status(http.StatusOK) })
	for _, host := range []string{"novapi.cn", "beiapi.cn.attacker.test", "localhost"} {
		request := httptest.NewRequest(http.MethodGet, "https://"+host+"/campus", nil)
		request.Header.Set("Origin", "https://beiapi.cn")
		request.Header.Set("X-Forwarded-Host", "beiapi.cn")
		result := httptest.NewRecorder()
		r.ServeHTTP(result, request)
		assert.Equal(t, http.StatusNotFound, result.Code)
	}
	result := httptest.NewRecorder()
	r.ServeHTTP(result, httptest.NewRequest(http.MethodGet, "https://beiapi.cn/campus", nil))
	assert.Equal(t, http.StatusOK, result.Code)
}
