package system_setting

import (
	"net/url"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

type PasskeySettings struct {
	Enabled              bool   `json:"enabled"`
	RPDisplayName        string `json:"rp_display_name"`
	RPID                 string `json:"rp_id"`
	Origins              string `json:"origins"`
	AllowInsecureOrigin  bool   `json:"allow_insecure_origin"`
	UserVerification     string `json:"user_verification"`
	AttachmentPreference string `json:"attachment_preference"`
}

var defaultPasskeySettings = PasskeySettings{
	Enabled:              false,
	RPDisplayName:        common.SystemName,
	RPID:                 "",
	Origins:              "",
	AllowInsecureOrigin:  false,
	UserVerification:     "preferred",
	AttachmentPreference: "",
}

func init() {
	config.GlobalConfig.Register("passkey", &defaultPasskeySettings)
}

func GetPasskeySettings() *PasskeySettings {
	resolved := defaultPasskeySettings
	if resolved.RPID == "" && GetSiteAddress() != "" {
		// Derive defaults from the business site without persisting them.
		// The address may be "https://newapi.pro".
		serverAddr := strings.TrimSpace(GetSiteAddress())
		if parsed, err := url.Parse(serverAddr); err == nil && parsed.Host != "" {
			resolved.RPID = parsed.Hostname()
		} else {
			resolved.RPID = serverAddr
		}
	}
	if resolved.Origins == "" || resolved.Origins == "[]" {
		resolved.Origins = GetSiteAddress()
	}
	return &resolved
}
