package service

import (
	"crypto/sha256"
	_ "embed"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
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

const codexFallbackProfileJSON = `{
				"description":"Custom Responses model; capabilities are not yet profiled.",
				"supported_reasoning_levels":[],"shell_type":"shell_command",
				"priority":1000,"availability_nux":null,"upgrade":null,
				"support_verbosity":false,"default_verbosity":null,
				"apply_patch_tool_type":null,"truncation_policy":{"mode":"tokens","limit":10000},
				"experimental_supported_tools":[],"input_modalities":["text"],
				"supports_reasoning_summary_parameter":false,"use_responses_lite":false,
				"base_instructions":"You are a coding assistant. Help the user complete their task."
			}`

// BuildCodexModelCatalog renders only available models with a bundled, official,
// or saved Codex profile. A profile never grants channel, group or token access.
func BuildCodexModelCatalog(available []dto.OpenAIModels, displayOrder []string) ([]byte, string, error) {
	profiles, err := GetEffectiveCodexModelProfiles()
	if err != nil {
		return nil, "", fmt.Errorf("load Codex capability profiles: %w", err)
	}
	overrides, err := GetCodexModelProfileOverrides()
	if err != nil {
		return nil, "", err
	}
	entries := make([]map[string]json.RawMessage, 0, len(available))
	ranks := make(map[string]int, len(displayOrder))
	for i, name := range displayOrder {
		ranks[name] = i + 1
	}
	seen := make(map[string]bool, len(available))
	for _, availableModel := range available {
		name := availableModel.Id
		if seen[name] || strings.TrimSpace(name) == "" || strings.ContainsAny(name, "*?") ||
			strings.HasSuffix(name, "-openai-compact") {
			continue
		}
		seen[name] = true
		profile, known := profiles[name]
		_, configured := overrides[name]
		if !known && !configured {
			continue
		}
		if !known {
			// Supply conservative defaults only for explicitly saved custom profiles;
			// endpoint metadata alone never enrolls a model in the Codex catalog.
			if err := common.Unmarshal([]byte(codexFallbackProfileJSON), &profile); err != nil {
				return nil, "", err
			}
		}
		entry := make(map[string]json.RawMessage, len(profile)+4)
		for key, value := range profile {
			entry[key] = value
		}
		for key, value := range overrides[name] {
			entry[key] = value
		}
		// Explicit remote catalogs arrived after Codex moved instructions into
		// model_messages. Promote legacy-only saved profiles, then emit one copy.
		var messages map[string]json.RawMessage
		if raw := entry["model_messages"]; len(raw) > 0 {
			if err := common.Unmarshal(raw, &messages); err != nil {
				return nil, "", fmt.Errorf("decode Codex model messages for %s: %w", name, err)
			}
		}
		template := messages["instructions_template"]
		if len(template) == 0 || strings.TrimSpace(string(template)) == "null" {
			if legacy := entry["base_instructions"]; len(legacy) > 0 && strings.TrimSpace(string(legacy)) != "null" {
				if messages == nil {
					messages = make(map[string]json.RawMessage)
				}
				messages["instructions_template"] = legacy
				entry["model_messages"], err = common.Marshal(messages)
				if err != nil {
					return nil, "", fmt.Errorf("encode Codex model messages for %s: %w", name, err)
				}
			}
		}
		delete(entry, "base_instructions")
		if len(ranks) > 0 {
			priority, ordered := ranks[name]
			if !ordered {
				// Unlisted models retain their relative profile order after the saved list.
				_ = common.Unmarshal(entry["priority"], &priority)
				priority += len(displayOrder) + 1
			}
			// Clients may sort by priority, so the field must match the response order.
			entry["priority"] = json.RawMessage(strconv.Itoa(priority))
		}
		slug, err := common.Marshal(name)
		if err != nil {
			return nil, "", err
		}
		entry["slug"] = slug
		if !known && entry["display_name"] == nil {
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

// BuildCodexSetupModelCatalog uses the same profile and availability rules as
// client discovery.
func BuildCodexSetupModelCatalog(available []dto.OpenAIModels, displayOrder []string) ([]byte, string, error) {
	return BuildCodexModelCatalog(available, displayOrder)
}
