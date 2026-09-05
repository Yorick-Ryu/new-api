package service

import (
	"crypto/sha256"
	_ "embed"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

// These are capability defaults, never an availability list. Membership is
// supplied by ListModels after channel, group, token and billing filtering.
// Keep unknown fields and model instructions for forward-compatible clients.
//
//go:embed codex_catalog_profiles.json
var codexCatalogProfilesJSON []byte

var codexCatalogProfiles = sync.OnceValues(func() (map[string]map[string]json.RawMessage, error) {
	var profiles map[string]map[string]json.RawMessage
	err := common.Unmarshal(codexCatalogProfilesJSON, &profiles)
	return profiles, err
})

// BuildCodexModelCatalog renders the authenticated user's available models as
// Codex ModelInfo entries. It does not fetch upstreams or change routing.
func BuildCodexModelCatalog(available []dto.OpenAIModels) ([]byte, string, error) {
	profiles, err := codexCatalogProfiles()
	if err != nil {
		return nil, "", fmt.Errorf("load Codex capability profiles: %w", err)
	}
	entries := make([]map[string]json.RawMessage, 0, len(available))
	seen := make(map[string]bool, len(available))
	for _, availableModel := range available {
		name := availableModel.Id
		if seen[name] || strings.TrimSpace(name) == "" || strings.ContainsAny(name, "*?") ||
			strings.HasSuffix(name, ratio_setting.CompactModelSuffix) {
			continue
		}
		seen[name] = true
		profile, known := profiles[name]
		if !known {
			// Do not infer Responses support or image/reasoning capabilities from
			// a similar model name. Unknown models need an explicit Responses route.
			responses := false
			media := false
			for _, endpoint := range availableModel.SupportedEndpointTypes {
				switch endpoint {
				case constant.EndpointTypeOpenAIResponse:
					responses = true
				case constant.EndpointTypeImageGeneration, constant.EndpointTypeEmbeddings,
					constant.EndpointTypeJinaRerank, constant.EndpointTypeOpenAIVideo:
					media = true
				}
			}
			if !responses || media {
				continue
			}
			// Complete, conservative fallback for explicitly Responses-capable
			// custom models; no vendor-specific tools or guessed context window.
			if err := common.Unmarshal([]byte(`{
				"description":"Custom Responses model; capabilities are not yet profiled.",
				"supported_reasoning_levels":[],"shell_type":"shell_command",
				"priority":1000,"availability_nux":null,"upgrade":null,
				"support_verbosity":false,"default_verbosity":null,
				"apply_patch_tool_type":null,"truncation_policy":{"mode":"tokens","limit":10000},
				"experimental_supported_tools":[],"input_modalities":["text"],
				"supports_reasoning_summary_parameter":false,"use_responses_lite":false,
				"base_instructions":"You are a coding assistant. Help the user complete their task."
			}`), &profile); err != nil {
				return nil, "", err
			}
		}
		entry := make(map[string]json.RawMessage, len(profile)+4)
		for key, value := range profile {
			entry[key] = value
		}
		slug, err := common.Marshal(name)
		if err != nil {
			return nil, "", err
		}
		entry["slug"] = slug
		if !known {
			entry["display_name"] = slug
		}
		entry["supported_in_api"] = json.RawMessage(`true`)
		entry["visibility"] = json.RawMessage(`"list"`)
		if strings.HasPrefix(name, "codex-auto-") {
			entry["visibility"] = json.RawMessage(`"hide"`)
		}
		entries = append(entries, entry)
	}
	// Stable order makes ETags independent of database/channel enumeration order.
	sort.Slice(entries, func(i, j int) bool {
		var left, right int
		_ = common.Unmarshal(entries[i]["priority"], &left)
		_ = common.Unmarshal(entries[j]["priority"], &right)
		if left != right {
			return left < right
		}
		return string(entries[i]["slug"]) < string(entries[j]["slug"])
	})
	body, err := common.Marshal(struct {
		Models []map[string]json.RawMessage `json:"models"`
	}{Models: entries})
	if err != nil {
		return nil, "", err
	}
	etag := fmt.Sprintf(`"%x"`, sha256.Sum256(body))
	return body, etag, nil
}
