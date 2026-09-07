package model

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

const ServiceStatusSettingsOptionKey = "ServiceStatusSettings"

type ServiceStatusModelSetting struct {
	Model  string `json:"model"`
	Hidden bool   `json:"hidden"`
}

type ServiceStatusGroupSetting struct {
	Group  string                      `json:"group"`
	Hidden bool                        `json:"hidden"`
	Models []ServiceStatusModelSetting `json:"models"`
}

// Array order is the display order. Unconfigured entries remain visible and
// follow configured entries in the normal model/group order.
type ServiceStatusSettings struct {
	Groups []ServiceStatusGroupSetting `json:"groups"`
}

func ParseServiceStatusSettings(raw string) (ServiceStatusSettings, error) {
	var settings ServiceStatusSettings
	if len(raw) > 2*1024*1024 {
		return settings, fmt.Errorf("service status settings are too large")
	}
	if err := common.UnmarshalJsonStr(raw, &settings); err != nil || settings.Groups == nil {
		return settings, fmt.Errorf("service status settings must contain a groups array")
	}
	if len(settings.Groups) > 1000 {
		return settings, fmt.Errorf("too many service status groups")
	}
	groups := map[string]bool{}
	total := 0
	for index, group := range settings.Groups {
		if group.Models == nil {
			settings.Groups[index].Models = []ServiceStatusModelSetting{}
		}
		if !validServiceStatusName(group.Group, 64) || groups[group.Group] {
			return settings, fmt.Errorf("invalid or duplicate service status group")
		}
		groups[group.Group] = true
		models := map[string]bool{}
		for _, entry := range group.Models {
			total++
			if total > 10000 || !validServiceStatusName(entry.Model, 255) || models[entry.Model] {
				return settings, fmt.Errorf("invalid or duplicate service status model")
			}
			models[entry.Model] = true
		}
	}
	return settings, nil
}

func validServiceStatusName(name string, limit int) bool {
	return name != "" && strings.TrimSpace(name) == name && len(name) <= limit && !strings.ContainsAny(name, "\r\n\x00")
}

func GetServiceStatusSettings() ServiceStatusSettings {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap[ServiceStatusSettingsOptionKey]
	common.OptionMapRWMutex.RUnlock()
	settings, err := ParseServiceStatusSettings(raw)
	if err != nil {
		return ServiceStatusSettings{Groups: []ServiceStatusGroupSetting{}}
	}
	return settings
}
