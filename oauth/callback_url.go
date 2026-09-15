package oauth

import (
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
)

func callbackURL(c *gin.Context, slug string) (string, error) {
	origin, err := system_setting.BrowserSiteOrigin(c.Request)
	if err != nil {
		return "", err
	}
	return origin + "/oauth/" + slug, nil
}
