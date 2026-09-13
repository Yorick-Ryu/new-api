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
	assert.Equal(t, "https://www.beiapi.cn/usage-logs", response.Data["return_url"])
	assert.Equal(t, "https://notify.example.com/api/user/epay/notify", response.Data["notify_url"])
	var topups int64
	require.NoError(t, db.Model(&model.TopUp{}).Count(&topups).Error)
	assert.EqualValues(t, 1, topups)
}
