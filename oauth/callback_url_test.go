package oauth

import (
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOAuthCallbacksPreserveAllowedBusinessSitesForEveryProvider(t *testing.T) {
	api, site, allowed := system_setting.ServerAddress, system_setting.SiteAddress, system_setting.SiteAllowedOrigins
	t.Cleanup(func() {
		system_setting.ServerAddress, system_setting.SiteAddress, system_setting.SiteAllowedOrigins = api, site, allowed
	})
	system_setting.ServerAddress = "https://api.beiapi.cn"
	system_setting.SiteAddress = "https://beiapi.cn"
	system_setting.SiteAllowedOrigins = "https://www.beiapi.cn,https://novapi.cn"
	for _, slug := range []string{"github", "discord", "oidc", "linuxdo", "custom-provider"} {
		for _, host := range []string{"beiapi.cn", "www.beiapi.cn", "novapi.cn"} {
			t.Run(host+"/"+slug, func(t *testing.T) {
				ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
				ctx.Request = httptest.NewRequest(http.MethodGet, "http://"+host+"/api/oauth/"+slug, nil)
				ctx.Request.Header.Set("X-Forwarded-Proto", "https")
				got, err := callbackURL(ctx, slug)
				require.NoError(t, err)
				assert.Equal(t, "https://"+host+"/oauth/"+slug, got)
			})
		}
	}
}
