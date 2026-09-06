package model

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

const ModelDisplayOrderOptionKey = "ModelDisplayOrder"

func ParseModelDisplayOrder(raw string) ([]string, error) {
	var names []string
	if err := common.UnmarshalJsonStr(raw, &names); err != nil || names == nil {
		return nil, fmt.Errorf("model display order must be an array of model names")
	}
	if len(names) > 10000 {
		return nil, fmt.Errorf("too many models in display order")
	}
	seen := make(map[string]bool, len(names))
	for _, name := range names {
		if strings.TrimSpace(name) != name || name == "" || len(name) > 256 || strings.ContainsAny(name, "\r\n\x00") {
			return nil, fmt.Errorf("invalid model name in display order")
		}
		if seen[name] {
			return nil, fmt.Errorf("duplicate model in display order")
		}
		seen[name] = true
	}
	return names, nil
}

func GetModelDisplayOrder() []string {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap[ModelDisplayOrderOptionKey]
	common.OptionMapRWMutex.RUnlock()
	names, err := ParseModelDisplayOrder(raw)
	if err != nil {
		return []string{}
	}
	return names
}

// Copy the response so display changes never mutate the shared pricing cache.
// Only attach ranks to visible models; hidden model names stay private.
func WithModelDisplayOrder(pricing []Pricing, names []string) []Pricing {
	ranks := make(map[string]int, len(names))
	for i, name := range names {
		ranks[name] = i + 1
	}
	result := make([]Pricing, len(pricing))
	for i, item := range pricing {
		item.DisplayOrder = ranks[item.ModelName]
		result[i] = item
	}
	return result
}
