package service

import (
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"testing"

	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/stretchr/testify/assert"
)

func TestPaymentReturnURLUsesSuppliedDefaultDashboardPath(t *testing.T) {
	previousAddress := system_setting.ServerAddress
	system_setting.ServerAddress = "https://dashboard.example.com/"
	t.Cleanup(func() { system_setting.ServerAddress = previousAddress })

	assert.Equal(t, "https://dashboard.example.com/wallet", PaymentReturnURL("/wallet"))
}

func TestBusinessNotificationsAndPaymentOverridesDoNotUseAPIAddress(t *testing.T) {
	api, site, callback := system_setting.ServerAddress, system_setting.SiteAddress, operation_setting.CustomCallbackAddress
	t.Cleanup(func() {
		system_setting.ServerAddress, system_setting.SiteAddress, operation_setting.CustomCallbackAddress = api, site, callback
	})
	system_setting.ServerAddress, system_setting.SiteAddress = "https://api.example.com", "https://example.com"
	operation_setting.CustomCallbackAddress = ""
	assert.Equal(t, "https://example.com/wallet", PaymentReturnURL("/wallet"))
	assert.Equal(t, "https://example.com", GetCallbackAddress())
	operation_setting.CustomCallbackAddress = "https://notify.example.com"
	assert.Equal(t, "https://notify.example.com", GetCallbackAddress())
}
