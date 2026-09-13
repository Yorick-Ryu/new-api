package controller

import (
	"net/url"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
)

func paymentReturnPath(suffix string) string {
	base := strings.TrimRight(system_setting.ServerAddress, "/")
	return base + suffix
}

// Browser returns belong to the site that started checkout. Payment notifications
// continue to use the separately configured callback address.
func paymentReturnURLForRequest(c *gin.Context, suffix string) (*url.URL, error) {
	scheme := "http"
	if c.Request.TLS != nil {
		scheme = "https"
	} else if forwardedProto := c.GetHeader("X-Forwarded-Proto"); forwardedProto != "" {
		scheme = strings.ToLower(strings.TrimSpace(strings.Split(forwardedProto, ",")[0]))
	}
	origin, err := common.NormalizeOrigin(scheme + "://" + c.Request.Host)
	if err != nil {
		return nil, err
	}
	return url.Parse(origin + suffix)
}
