package service

import (
	"encoding/json"
	"fmt"
	"maps"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

const CodexModelProfilesOptionKey = "CodexModelProfiles"

type CodexModelProfiles map[string]map[string]json.RawMessage

func GetCodexModelProfileOverrides() (CodexModelProfiles, error) {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap[CodexModelProfilesOptionKey]
	common.OptionMapRWMutex.RUnlock()
	profiles := make(CodexModelProfiles)
	if strings.TrimSpace(raw) == "" {
		return profiles, nil
	}
	if err := common.UnmarshalJsonStr(raw, &profiles); err != nil || profiles == nil {
		return nil, fmt.Errorf("invalid Codex model profiles")
	}
	return profiles, nil
}

func GetCodexModelProfileDefaults() (CodexModelProfiles, map[string]json.RawMessage, error) {
	builtins, err := GetEffectiveCodexModelProfiles()
	if err != nil {
		return nil, nil, err
	}
	profiles := make(CodexModelProfiles, len(builtins))
	for name, profile := range builtins {
		profiles[name] = maps.Clone(profile)
	}
	var fallback map[string]json.RawMessage
	if err := common.UnmarshalJsonStr(codexFallbackProfileJSON, &fallback); err != nil {
		return nil, nil, err
	}
	return profiles, fallback, nil
}

// Validate Codex capabilities and priorities. Routing, availability and the
// marketplace order remain controlled by their existing NewAPI settings.
func ValidateCodexModelProfiles(raw string) error {
	if len(raw) > 2*1024*1024 {
		return fmt.Errorf("Codex model profiles must be smaller than 2 MiB")
	}
	var overrides CodexModelProfiles
	if err := common.UnmarshalJsonStr(raw, &overrides); err != nil || overrides == nil {
		return fmt.Errorf("Codex model profiles must be a JSON object keyed by model name")
	}
	defaults, fallback, err := GetCodexModelProfileDefaults()
	if err != nil {
		return err
	}
	for name, override := range overrides {
		if name == "" || strings.TrimSpace(name) != name || len(name) > 256 || strings.ContainsAny(name, "*?\r\n\x00") || override == nil {
			return fmt.Errorf("invalid Codex model profile name or object")
		}
		for _, key := range []string{"slug", "visibility", "supported_in_api", "available_in_plans", "minimal_client_version"} {
			if _, exists := override[key]; exists {
				return fmt.Errorf("%s: %s is managed by model availability or display order", name, key)
			}
		}
		profile := maps.Clone(defaults[name])
		if profile == nil {
			profile = maps.Clone(fallback)
		}
		maps.Copy(profile, override)
		encoded, err := common.Marshal(profile)
		if err != nil {
			return err
		}
		var fields struct {
			Priority              *int     `json:"priority"`
			DisplayName           string   `json:"display_name"`
			Description           string   `json:"description"`
			ShellType             string   `json:"shell_type"`
			ApplyPatchToolType    *string  `json:"apply_patch_tool_type"`
			SupportVerbosity      bool     `json:"support_verbosity"`
			UseResponsesLite      bool     `json:"use_responses_lite"`
			SupportsSearchTool    bool     `json:"supports_search_tool"`
			PreferWebsockets      bool     `json:"prefer_websockets"`
			DefaultReasoningLevel string   `json:"default_reasoning_level"`
			InputModalities       []string `json:"input_modalities"`
			ContextWindow         *int     `json:"context_window"`
			MaxContextWindow      *int     `json:"max_context_window"`
			BaseInstructions      string   `json:"base_instructions"`
			ReasoningLevels       []struct {
				Effort      string `json:"effort"`
				Description string `json:"description"`
			} `json:"supported_reasoning_levels"`
			ModelMessages *struct {
				Template string `json:"instructions_template"`
			} `json:"model_messages"`
		}
		if err := common.Unmarshal(encoded, &fields); err != nil {
			return fmt.Errorf("%s: invalid capability field type", name)
		}
		if fields.Priority == nil || *fields.Priority < 0 || *fields.Priority > 1000000 {
			return fmt.Errorf("%s: priority must be an integer between 0 and 1000000", name)
		}
		seen := make(map[string]bool)
		for _, level := range fields.ReasoningLevels {
			if !slices.Contains([]string{"none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"}, level.Effort) || seen[level.Effort] {
				return fmt.Errorf("%s: invalid or duplicate reasoning effort", name)
			}
			seen[level.Effort] = true
		}
		if fields.DefaultReasoningLevel != "" && !seen[fields.DefaultReasoningLevel] {
			return fmt.Errorf("%s: default reasoning effort must be included in supported_reasoning_levels", name)
		}
		if len(fields.InputModalities) == 0 || (fields.ContextWindow != nil && *fields.ContextWindow <= 0) || (fields.MaxContextWindow != nil && *fields.MaxContextWindow <= 0) {
			return fmt.Errorf("%s: input modalities and context window must be valid", name)
		}
		for _, modality := range fields.InputModalities {
			if !slices.Contains([]string{"text", "image"}, modality) {
				return fmt.Errorf("%s: input_modalities must contain text or image", name)
			}
		}
		if fields.BaseInstructions == "" && (fields.ModelMessages == nil || fields.ModelMessages.Template == "") {
			return fmt.Errorf("%s: model instructions cannot be empty", name)
		}
	}
	return nil
}
