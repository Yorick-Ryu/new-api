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
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSubscriptionEpayRecordsTopupAuditOnce(t *testing.T) {
	for _, tc := range []struct {
		name    string
		method  string
		renewal bool
		handler gin.HandlerFunc
	}{
		{"notify-purchase", http.MethodGet, false, SubscriptionEpayNotify},
		{"notify-renewal", http.MethodPost, true, SubscriptionEpayNotify},
		{"return-purchase", http.MethodGet, false, SubscriptionEpayReturn},
		{"return-renewal", http.MethodPost, true, SubscriptionEpayReturn},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, user, plan, sub := setupSubscriptionRenewalControllerTest(t)
			setupEpayReturnSettings(t)
			require.NoError(t, db.AutoMigrate(&model.TopUp{}))
			require.NoError(t, db.Model(&plan).Update("max_purchase_per_user", 0).Error)
			order := model.SubscriptionOrder{UserId: user.Id, PlanId: plan.Id, TradeNo: "audit-" + tc.name, Money: plan.PriceAmount, PaymentProvider: model.PaymentProviderEpay, PaymentMethod: "alipay", Status: common.TopUpStatusPending}
			if tc.renewal {
				order.RenewalSubscriptionId = sub.Id
			}
			require.NoError(t, order.Insert())
			params := epay.GenerateParams(map[string]string{"pid": operation_setting.EpayId, "out_trade_no": order.TradeNo, "trade_no": "audit-gateway-order", "trade_status": epay.StatusTradeSuccess, "type": "wxpay", "money": "1.00", "sign_type": "MD5"}, operation_setting.EpayKey)
			values := url.Values{}
			for key, value := range params {
				values.Set(key, value)
			}
			for _, callerIP := range []string{"203.0.113.10", "203.0.113.11"} {
				writer := httptest.NewRecorder()
				ctx, _ := gin.CreateTestContext(writer)
				ctx.Request = httptest.NewRequest(tc.method, "https://pay.example.com/callback?"+values.Encode(), nil)
				if tc.method == http.MethodPost {
					ctx.Request = httptest.NewRequest(tc.method, "https://pay.example.com/callback", strings.NewReader(values.Encode()))
					ctx.Request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
				}
				ctx.Request.RemoteAddr = callerIP + ":443"
				tc.handler(ctx)
				assert.Equal(t, common.TopUpStatusSuccess, model.GetSubscriptionOrderByTradeNo(order.TradeNo).Status)
			}
			var logs []model.Log
			require.NoError(t, db.Where("user_id = ? AND type = ?", user.Id, model.LogTypeTopup).Find(&logs).Error)
			require.Len(t, logs, 1)
			assert.Equal(t, "203.0.113.10", logs[0].Ip)
			assert.Contains(t, logs[0].Content, "支付方式: wxpay")
			if tc.renewal {
				assert.Contains(t, logs[0].Content, "订阅续费成功")
			} else {
				assert.Contains(t, logs[0].Content, "订阅购买成功")
			}
			var details struct {
				AdminInfo map[string]string `json:"admin_info"`
			}
			require.NoError(t, common.UnmarshalJsonStr(logs[0].Other, &details))
			assert.Equal(t, map[string]string{
				"server_ip": common.GetIp(), "node_name": common.NodeName, "version": common.Version,
				"caller_ip": "203.0.113.10", "payment_method": "wxpay", "callback_payment_method": model.PaymentProviderEpay,
			}, details.AdminInfo)
		})
	}
}

func TestSubscriptionBalanceRecordsBuyerAudit(t *testing.T) {
	for _, renewal := range []bool{false, true} {
		t.Run(fmt.Sprintf("renewal=%t", renewal), func(t *testing.T) {
			db, user, plan, sub := setupSubscriptionRenewalControllerTest(t)
			require.NoError(t, db.Model(&plan).Update("max_purchase_per_user", 0).Error)
			model.InvalidateSubscriptionPlanCache(plan.Id)
			renewalID := 0
			if renewal {
				renewalID = sub.Id
			}
			writer := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(writer)
			ctx.Set("id", user.Id)
			ctx.Request = httptest.NewRequest(http.MethodPost, "/api/subscription/balance/pay", strings.NewReader(fmt.Sprintf(`{"plan_id":%d,"renewal_subscription_id":%d}`, plan.Id, renewalID)))
			ctx.Request.Header.Set("Content-Type", "application/json")
			ctx.Request.RemoteAddr = "203.0.113.20:443"
			SubscriptionRequestBalancePay(ctx)
			var response struct {
				Success bool `json:"success"`
			}
			require.NoError(t, common.Unmarshal(writer.Body.Bytes(), &response))
			require.True(t, response.Success, writer.Body.String())
			var logs []model.Log
			require.NoError(t, db.Where("user_id = ? AND type = ?", user.Id, model.LogTypeTopup).Find(&logs).Error)
			require.Len(t, logs, 1)
			assert.Equal(t, "203.0.113.20", logs[0].Ip)
			var details struct {
				AdminInfo map[string]string `json:"admin_info"`
			}
			require.NoError(t, common.UnmarshalJsonStr(logs[0].Other, &details))
			assert.Equal(t, "203.0.113.20", details.AdminInfo["caller_ip"])
			assert.Equal(t, model.PaymentMethodBalance, details.AdminInfo["payment_method"])
			assert.Equal(t, model.PaymentProviderBalance, details.AdminInfo["callback_payment_method"])
		})
	}
}
