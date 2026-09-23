package service

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"maps"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const CodexOfficialModelProfilesOptionKey = "CodexOfficialModelProfiles"

type CodexOfficialSyncInfo struct {
	Revision   string `json:"revision"`
	SyncedAt   int64  `json:"synced_at"`
	ModelCount int    `json:"model_count"`
	SourceURL  string `json:"source_url"`
}

type CodexOfficialSnapshot struct {
	CodexOfficialSyncInfo
	Profiles CodexModelProfiles `json:"profiles"`
}

func GetCodexOfficialSnapshot() (*CodexOfficialSnapshot, error) {
	common.OptionMapRWMutex.RLock()
	raw := common.OptionMap[CodexOfficialModelProfilesOptionKey]
	common.OptionMapRWMutex.RUnlock()
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	var snapshot CodexOfficialSnapshot
	if err := common.UnmarshalJsonStr(raw, &snapshot); err != nil || len(snapshot.Profiles) == 0 {
		return nil, fmt.Errorf("invalid saved official Codex model profiles")
	}
	return &snapshot, nil
}

func GetEffectiveCodexModelProfiles() (CodexModelProfiles, error) {
	builtins, err := codexCatalogProfiles()
	if err != nil {
		return nil, err
	}
	snapshot, err := GetCodexOfficialSnapshot()
	if err != nil {
		return nil, err
	}
	profiles := maps.Clone(builtins)
	if snapshot != nil {
		maps.Copy(profiles, snapshot.Profiles)
	}
	return profiles, nil
}

// Only public JSON from the fixed official repository is downloaded. No local
// credentials are sent and no repository code is executed.
func FetchOfficialCodexModelProfiles(ctx context.Context) (*CodexOfficialSnapshot, error) {
	client := &http.Client{
		Timeout: 25 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	refData, err := fetchCodexRepositoryJSON(ctx, client, "https://api.github.com/repos/openai/codex/git/ref/heads/main")
	if err != nil {
		return nil, err
	}
	var ref struct {
		Object struct {
			SHA string `json:"sha"`
		} `json:"object"`
	}
	if err := common.Unmarshal(refData, &ref); err != nil {
		return nil, fmt.Errorf("invalid official repository revision response")
	}
	sha, err := hex.DecodeString(ref.Object.SHA)
	if err != nil || len(sha) != 20 {
		return nil, fmt.Errorf("invalid official repository revision")
	}
	path := ref.Object.SHA + "/codex-rs/models-manager/models.json"
	raw, err := fetchCodexRepositoryJSON(ctx, client, "https://raw.githubusercontent.com/openai/codex/"+path)
	if err != nil {
		return nil, err
	}
	var catalog struct {
		Models []map[string]json.RawMessage `json:"models"`
	}
	if err := common.Unmarshal(raw, &catalog); err != nil || len(catalog.Models) == 0 {
		return nil, fmt.Errorf("official repository returned an empty or invalid model catalog")
	}
	profiles := make(CodexModelProfiles, len(catalog.Models))
	for _, entry := range catalog.Models {
		var name string
		if err := common.Unmarshal(entry["slug"], &name); err != nil || name == "" {
			return nil, fmt.Errorf("official catalog contains a model without a valid slug")
		}
		if _, exists := profiles[name]; exists {
			return nil, fmt.Errorf("official catalog contains duplicate model %s", name)
		}
		profile := maps.Clone(entry)
		for _, key := range []string{"slug", "visibility", "supported_in_api", "available_in_plans", "minimal_client_version"} {
			delete(profile, key)
		}
		var messages struct {
			Template  string `json:"instructions_template"`
			Variables *struct {
				Personality string `json:"personality_default"`
			} `json:"instructions_variables"`
		}
		if value, ok := profile["model_messages"]; ok {
			if err := common.Unmarshal(value, &messages); err != nil {
				return nil, fmt.Errorf("invalid official model instructions for %s", name)
			}
			if messages.Template != "" {
				instructions := messages.Template
				if messages.Variables != nil {
					instructions = strings.ReplaceAll(instructions, "{{ personality }}", messages.Variables.Personality)
				}
				profile["base_instructions"], err = common.Marshal(instructions)
				if err != nil {
					return nil, err
				}
			}
		}
		profiles[name] = profile
	}
	encoded, err := common.Marshal(profiles)
	if err != nil {
		return nil, err
	}
	if err := ValidateCodexModelProfiles(string(encoded)); err != nil {
		return nil, fmt.Errorf("official catalog validation failed: %w", err)
	}
	return &CodexOfficialSnapshot{
		CodexOfficialSyncInfo: CodexOfficialSyncInfo{
			Revision: ref.Object.SHA, SyncedAt: time.Now().Unix(),
			ModelCount: len(profiles), SourceURL: "https://github.com/openai/codex/blob/" + path,
		},
		Profiles: profiles,
	}, nil
}

func fetchCodexRepositoryJSON(ctx context.Context, client *http.Client, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "new-api-codex-catalog-sync")
	response, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("could not download official Codex model configuration: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("official repository request failed (HTTP %d)", response.StatusCode)
	}
	const maxBytes = 8 * 1024 * 1024
	data, err := io.ReadAll(io.LimitReader(response.Body, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxBytes {
		return nil, fmt.Errorf("official catalog exceeds the download size limit")
	}
	return data, nil
}
