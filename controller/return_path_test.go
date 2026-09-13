package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPaymentReturnPathUsesDefaultDashboardRoutes(t *testing.T) {
	previousAddress := system_setting.ServerAddress
	system_setting.ServerAddress = "https://dashboard.example.com/"
	t.Cleanup(func() { system_setting.ServerAddress = previousAddress })

	assert.Equal(
		t,
		"https://dashboard.example.com/wallet?pay=success",
		paymentReturnPath("/wallet?pay=success"),
	)
	assert.Equal(
		t,
		"https://dashboard.example.com/usage-logs",
		paymentReturnPath("/usage-logs"),
	)
}

func TestPaymentReturnURLPreservesRequestOriginThroughTLSProxy(t *testing.T) {
	for _, test := range []struct {
		name, requestURL, forwardedProto, want string
		invalid                                bool
	}{
		{name: "TLS", requestURL: "https://www.beiapi.cn/pay", want: "https://www.beiapi.cn/wallet"},
		{name: "HTTPS proxy", requestURL: "http://beiapi.cn/pay", forwardedProto: "https", want: "https://beiapi.cn/wallet"},
		{name: "proxy list", requestURL: "http://novapi.cn/pay", forwardedProto: "https, http", want: "https://novapi.cn/wallet"},
		{name: "local port", requestURL: "http://localhost:3000/pay", want: "http://localhost:3000/wallet"},
		{name: "invalid scheme", requestURL: "http://beiapi.cn/pay", forwardedProto: "javascript", invalid: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Request = httptest.NewRequest(http.MethodPost, test.requestURL, nil)
			ctx.Request.Header.Set("X-Forwarded-Proto", test.forwardedProto)
			ctx.Request.Header.Set("Origin", "https://unrelated.example")
			ctx.Request.Header.Set("X-Forwarded-Host", "unrelated.example")
			got, err := paymentReturnURLForRequest(ctx, "/wallet")
			if test.invalid {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, test.want, got.String())
		})
	}
}
