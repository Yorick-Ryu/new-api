package system_setting

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBusinessAddressDefaultsAndUpdatesAreIndependentOfAPI(t *testing.T) {
	api, site := ServerAddress, SiteAddress
	t.Cleanup(func() { ServerAddress, SiteAddress = api, site })
	ServerAddress, SiteAddress = "https://api.example.com/", ""
	assert.Equal(t, "https://api.example.com", GetSiteAddress())
	SiteAddress = "https://example.com/"
	assert.Equal(t, "https://example.com", GetSiteAddress())
	assert.Equal(t, "https://api.example.com", GetAPIAddress())
	ServerAddress = "https://api.other.example"
	assert.Equal(t, "https://example.com", GetSiteAddress())
	SiteAddress = "https://www.example.com"
	assert.Equal(t, "https://www.example.com", GetSiteAddress())
	assert.Equal(t, "https://api.other.example", GetAPIAddress())
}

func TestBrowserSiteOriginUsesExactBusinessOrigins(t *testing.T) {
	site, allowed := SiteAddress, SiteAllowedOrigins
	t.Cleanup(func() { SiteAddress, SiteAllowedOrigins = site, allowed })
	SiteAddress = "https://beiapi.cn"
	SiteAllowedOrigins = "https://www.beiapi.cn\nhttps://novapi.cn,https://www.novapi.cn"
	for _, tc := range []struct {
		request, forwarded, want string
		invalid                  bool
	}{
		{"https://beiapi.cn/pay", "", "https://beiapi.cn", false},
		{"http://www.beiapi.cn/pay", "https, http", "https://www.beiapi.cn", false},
		{"https://novapi.cn/pay", "", "https://novapi.cn", false},
		{"https://www.novapi.cn/pay", "", "https://www.novapi.cn", false},
		{"https://api.beiapi.cn/pay", "", "https://beiapi.cn", false},
		{"https://www.beiapi.cn.evil.example/pay", "", "https://beiapi.cn", false},
		{"https://www.beiapi.cn:8443/pay", "", "https://beiapi.cn", false},
		{"http://www.beiapi.cn/pay", "", "https://beiapi.cn", false},
		{"http://beiapi.cn/pay", "javascript", "", true},
	} {
		t.Run(tc.request+tc.forwarded, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, tc.request, nil)
			request.Header.Set("X-Forwarded-Proto", tc.forwarded)
			request.Header.Set("Origin", "https://evil.example")
			request.Header.Set("X-Forwarded-Host", "evil.example")
			got, err := BrowserSiteOrigin(request)
			if tc.invalid {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestSiteOriginsRejectPathsCredentialsAndWildcards(t *testing.T) {
	for _, value := range []string{"https://site.example/path", "https://user:pass@site.example", "https://*.example", "javascript:alert(1)", "https://example.com?token=x"} {
		_, err := ParseSiteOrigins(value)
		require.Error(t, err, value)
	}
	origins, err := ParseSiteOrigins("https://WWW.example.com:443/\n https://novapi.cn")
	require.NoError(t, err)
	assert.Equal(t, []string{"https://www.example.com", "https://novapi.cn"}, origins)
}

func TestPasskeyDefaultsFollowSiteUpdatesWithoutOverwritingExplicitSettings(t *testing.T) {
	api, site, settings := ServerAddress, SiteAddress, defaultPasskeySettings
	t.Cleanup(func() { ServerAddress, SiteAddress, defaultPasskeySettings = api, site, settings })
	ServerAddress, SiteAddress = "https://api.example.com", "https://example.com"
	defaultPasskeySettings = PasskeySettings{}
	assert.Equal(t, "example.com", GetPasskeySettings().RPID)
	SiteAddress = "https://www.other.example:8443"
	assert.Equal(t, "www.other.example", GetPasskeySettings().RPID)
	assert.Equal(t, SiteAddress, GetPasskeySettings().Origins)
	assert.Empty(t, defaultPasskeySettings.RPID)
	defaultPasskeySettings = PasskeySettings{RPID: "example.com", Origins: "https://example.com,https://www.example.com"}
	assert.Equal(t, "example.com", GetPasskeySettings().RPID)
	assert.Equal(t, "https://example.com,https://www.example.com", GetPasskeySettings().Origins)
}
