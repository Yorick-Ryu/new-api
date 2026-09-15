package service

import (
	"github.com/QuantumNous/new-api/setting/system_setting"
)

func PaymentReturnURL(suffix string) string {
	base := system_setting.GetSiteAddress()
	return base + suffix
}
