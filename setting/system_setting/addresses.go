package system_setting

import (
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// SiteAddress is the default business origin. Empty preserves existing installs.
var SiteAddress = ""

// SiteAllowedOrigins lists additional business origins, one per line or comma.
// It does not change OAuth provider registrations or Passkey relying parties.
var SiteAllowedOrigins = ""

func GetAPIAddress() string {
	return strings.TrimRight(strings.TrimSpace(ServerAddress), "/")
}

func GetSiteAddress() string {
	if strings.TrimSpace(SiteAddress) != "" {
		return strings.TrimRight(strings.TrimSpace(SiteAddress), "/")
	}
	return GetAPIAddress()
}

func ParseSiteOrigins(value string) ([]string, error) {
	origins := []string{}
	for _, raw := range strings.FieldsFunc(value, func(r rune) bool { return r == ',' || r == '\n' || r == '\r' }) {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		origin, err := common.NormalizeOrigin(raw)
		if err != nil {
			return nil, err
		}
		origins = append(origins, origin)
	}
	return origins, nil
}

func GetSiteOrigins() []string {
	origins, _ := ParseSiteOrigins(SiteAllowedOrigins)
	if origin, err := common.NormalizeOrigin(GetSiteAddress()); err == nil {
		origins = append(origins, origin)
	}
	return origins
}

// BrowserSiteOrigin preserves an explicitly allowed purchasing/login site.
// Proxies must preserve Host and overwrite X-Forwarded-Proto. Origin and
// X-Forwarded-Host cannot choose a return destination.
func BrowserSiteOrigin(request *http.Request) (string, error) {
	scheme := "http"
	if request.TLS != nil {
		scheme = "https"
	} else if forwarded := request.Header.Get("X-Forwarded-Proto"); forwarded != "" {
		scheme = strings.ToLower(strings.TrimSpace(strings.Split(forwarded, ",")[0]))
	}
	origin, err := common.NormalizeOrigin(scheme + "://" + request.Host)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(SiteAddress) == "" {
		return origin, nil
	}
	for _, allowed := range GetSiteOrigins() {
		if origin == allowed {
			return origin, nil
		}
	}
	return GetSiteAddress(), nil
}
