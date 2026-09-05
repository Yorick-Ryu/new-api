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
	body, _, err := BuildCodexModelCatalog([]dto.OpenAIModels{{Id: "gpt-6-astra"}})
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
	})
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
	one, first, err := BuildCodexModelCatalog([]dto.OpenAIModels{{Id: "gpt-6-astra"}, {Id: "gpt-5.6-sol"}})
	require.NoError(t, err)
	two, reordered, err := BuildCodexModelCatalog([]dto.OpenAIModels{{Id: "gpt-5.6-sol"}, {Id: "gpt-6-astra"}})
	require.NoError(t, err)
	assert.Equal(t, one, two)
	assert.Equal(t, first, reordered)
	_, removed, err := BuildCodexModelCatalog([]dto.OpenAIModels{{Id: "gpt-5.6-sol"}})
	require.NoError(t, err)
	assert.NotEqual(t, first, removed)
	empty, _, err := BuildCodexModelCatalog(nil)
	require.NoError(t, err)
	assert.JSONEq(t, `{"models":[]}`, string(empty))
}
