package controller

import (
	"net/url"

	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
)

func paymentReturnPath(suffix string) string {
	base := system_setting.GetSiteAddress()
	return base + suffix
}

// Browser returns belong to the site that started checkout. Payment notifications
// continue to use the separately configured callback address.
func paymentReturnURLForRequest(c *gin.Context, suffix string) (*url.URL, error) {
	origin, err := system_setting.BrowserSiteOrigin(c.Request)
	if err != nil {
		return nil, err
	}
	return url.Parse(origin + suffix)
}
