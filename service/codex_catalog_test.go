package service

import (
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCodexCatalogPreservesCapabilitiesWithoutAddingModels(t *testing.T) {
	body, _, err := BuildCodexModelCatalog([]dto.OpenAIModels{{Id: "gpt-6-astra"}}, nil)
	require.NoError(t, err)
	var catalog struct {
		Models []map[string]json.RawMessage `json:"models"`
	}
	require.NoError(t, common.Unmarshal(body, &catalog))
	require.Len(t, catalog.Models, 1)
	entry := catalog.Models[0]
	assert.JSONEq(t, `"gpt-6-astra"`, string(entry["slug"]))
	assert.JSONEq(t, `"list"`, string(entry["visibility"]))
	assert.JSONEq(t, `true`, string(entry["supported_in_api"]))
	assert.JSONEq(t, `272000`, string(entry["context_window"]))
	assert.Contains(t, string(entry["supported_reasoning_levels"]), `"ultra"`)
	assert.NotEmpty(t, entry["model_messages"])
	// This protects opaque tool flags and instructions during serialization,
	// not only the visible model name.
	profiles, err := codexCatalogProfiles()
	require.NoError(t, err)
	for key, value := range profiles["gpt-6-astra"] {
		assert.JSONEq(t, string(value), string(entry[key]), "capability %s", key)
	}
}

func TestCodexCatalogFiltersMediaAndRequiresExplicitUnknownResponsesRoute(t *testing.T) {
	body, _, err := BuildCodexModelCatalog([]dto.OpenAIModels{
		{Id: "gpt-6-astra"}, {Id: "gpt-6-astra"},
		{Id: "gpt-6-astra-openai-compact"}, {Id: "gpt-*"},
		{Id: "custom-chat", SupportedEndpointTypes: []constant.EndpointType{constant.EndpointTypeOpenAI}},
		{Id: "custom-image", SupportedEndpointTypes: []constant.EndpointType{constant.EndpointTypeOpenAIResponse, constant.EndpointTypeImageGeneration}},
		{Id: "custom-responses", SupportedEndpointTypes: []constant.EndpointType{constant.EndpointTypeOpenAIResponse}},
	}, nil)
	require.NoError(t, err)
	var catalog struct {
		Models []struct {
			Slug             string   `json:"slug"`
			InputModalities  []string `json:"input_modalities"`
			UseResponsesLite bool     `json:"use_responses_lite"`
		} `json:"models"`
	}
	require.NoError(t, common.Unmarshal(body, &catalog))
	require.Len(t, catalog.Models, 2)
	assert.Equal(t, "gpt-6-astra", catalog.Models[0].Slug)
	assert.Equal(t, "custom-responses", catalog.Models[1].Slug)
	assert.Equal(t, []string{"text"}, catalog.Models[1].InputModalities)
	assert.False(t, catalog.Models[1].UseResponsesLite)
}

func TestCodexCatalogETagDependsOnEffectiveModels(t *testing.T) {
	one, first, err := BuildCodexModelCatalog([]dto.OpenAIModels{{Id: "gpt-6-astra"}, {Id: "gpt-5.6-sol"}}, nil)
	require.NoError(t, err)
	two, reordered, err := BuildCodexModelCatalog([]dto.OpenAIModels{{Id: "gpt-5.6-sol"}, {Id: "gpt-6-astra"}}, nil)
	require.NoError(t, err)
	assert.Equal(t, one, two)
	assert.Equal(t, first, reordered)
	_, removed, err := BuildCodexModelCatalog([]dto.OpenAIModels{{Id: "gpt-5.6-sol"}}, nil)
	require.NoError(t, err)
	assert.NotEqual(t, first, removed)
	empty, _, err := BuildCodexModelCatalog(nil, nil)
	require.NoError(t, err)
	assert.JSONEq(t, `{"models":[]}`, string(empty))
}

func TestCodexCatalogUsesSavedDisplayOrderWithoutAddingUnavailableModels(t *testing.T) {
	available := []dto.OpenAIModels{
		{Id: "gpt-5.5"},
		{Id: "gpt-6-luna", SupportedEndpointTypes: []constant.EndpointType{constant.EndpointTypeOpenAIResponse}},
		{Id: "custom-responses", SupportedEndpointTypes: []constant.EndpointType{constant.EndpointTypeOpenAIResponse}},
		{Id: "gpt-5.6-luna"},
		{Id: "gpt-6-sol", SupportedEndpointTypes: []constant.EndpointType{constant.EndpointTypeOpenAIResponse}},
		{Id: "gpt-5.6-terra"},
		{Id: "gpt-6-astra"},
		{Id: "gpt-5.6-sol"},
	}
	displayOrder := []string{
		"gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol",
		"gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "unavailable-model",
	}
	body, etag, err := BuildCodexModelCatalog(available, displayOrder)
	require.NoError(t, err)
	var catalog struct {
		Models []struct {
			Slug     string `json:"slug"`
			Priority int    `json:"priority"`
		} `json:"models"`
	}
	require.NoError(t, common.Unmarshal(body, &catalog))
	names := make([]string, 0, len(catalog.Models))
	for i, entry := range catalog.Models {
		names = append(names, entry.Slug)
		if i > 0 {
			assert.Less(t, catalog.Models[i-1].Priority, entry.Priority, "clients also sort by priority")
		}
	}
	assert.Equal(t, []string{
		"gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol",
		"gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "custom-responses",
	}, names)
	for left, right := 0, len(available)-1; left < right; left, right = left+1, right-1 {
		available[left], available[right] = available[right], available[left]
	}
	reorderedBody, reorderedETag, err := BuildCodexModelCatalog(available, displayOrder)
	require.NoError(t, err)
	assert.Equal(t, body, reorderedBody)
	assert.Equal(t, etag, reorderedETag)

	displayOrder[0], displayOrder[1] = displayOrder[1], displayOrder[0]
	changedBody, changedETag, err := BuildCodexModelCatalog(available, displayOrder)
	require.NoError(t, err)
	assert.NotEqual(t, etag, changedETag, "a saved-order change must invalidate client caches")
	require.NoError(t, common.Unmarshal(changedBody, &catalog))
	assert.Equal(t, "gpt-6-sol", catalog.Models[0].Slug)
	assert.Equal(t, "gpt-6-astra", catalog.Models[1].Slug)

	defaultBody, _, err := BuildCodexModelCatalog(available, nil)
	require.NoError(t, err)
	require.NoError(t, common.Unmarshal(defaultBody, &catalog))
	assert.Equal(t, "gpt-6-astra", catalog.Models[0].Slug)
	assert.Equal(t, 1, catalog.Models[0].Priority, "saved order must not mutate shared profiles")
}

func TestCodexCatalogIncludesConfiguredLegacySpark(t *testing.T) {
	body, _, err := BuildCodexModelCatalog([]dto.OpenAIModels{{
		Id: "gpt-5.3-codex-spark", SupportedEndpointTypes: []constant.EndpointType{constant.EndpointTypeOpenAI},
	}}, nil)
	require.NoError(t, err)
	var catalog struct {
		Models []map[string]json.RawMessage `json:"models"`
	}
	require.NoError(t, common.Unmarshal(body, &catalog))
	require.Len(t, catalog.Models, 1)
	assert.JSONEq(t, `128000`, string(catalog.Models[0]["context_window"]))
	assert.JSONEq(t, `["text"]`, string(catalog.Models[0]["input_modalities"]))
	assert.JSONEq(t, `true`, string(catalog.Models[0]["supported_in_api"]))
	assert.JSONEq(t, `"list"`, string(catalog.Models[0]["visibility"]))
}
