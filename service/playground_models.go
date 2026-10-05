package service

import (
	"cmp"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/model_setting"
)

// GetPlaygroundModels lists chat-capable models in the user's resolved groups.
// Catalog visibility never grants access to another group or changes routing.
func GetPlaygroundModels(groups []string) ([]string, error) {
	names := make([]string, 0)
	if len(groups) == 0 {
		return names, nil
	}
	abilities, err := model.GetAllEnableAbilityWithChannels()
	if err != nil {
		return nil, err
	}
	visible := make(map[string]bool)
	for _, pricing := range model.GetPricing() {
		// Image models can also inherit a generic chat endpoint from their channel.
		if slices.Contains(pricing.SupportedEndpointTypes, constant.EndpointTypeImageGeneration) ||
			slices.Contains(pricing.SupportedEndpointTypes, constant.EndpointTypeOpenAIVideo) {
			continue
		}
		visible[pricing.ModelName] = true
	}
	channels := make(map[int]*model.Channel)
	seen := make(map[string]bool)
	for _, ability := range abilities {
		name := ability.Model
		if !slices.Contains(groups, ability.Group) || seen[name] || !visible[name] || isNonChatPlaygroundModel(name) {
			continue
		}
		channel, ok := channels[ability.ChannelId]
		if !ok {
			channel, err = model.CacheGetChannel(ability.ChannelId)
			if err != nil {
				return nil, err
			}
			channels[ability.ChannelId] = channel
		}
		if channel.Status != common.ChannelStatusEnabled || !channelSupportsPlaygroundChat(channel, name) {
			continue
		}
		seen[name] = true
		names = append(names, name)
	}
	order := model.GetModelDisplayOrder()
	ranks := make(map[string]int, len(order))
	for i, name := range order {
		ranks[name] = i + 1
	}
	slices.SortFunc(names, func(a, b string) int {
		left, right := ranks[a], ranks[b]
		if left == 0 {
			left = len(order) + 1
		}
		if right == 0 {
			right = len(order) + 1
		}
		if left != right {
			return cmp.Compare(left, right)
		}
		return strings.Compare(a, b)
	})
	return names, nil
}

func channelSupportsPlaygroundChat(channel *model.Channel, name string) bool {
	switch channel.Type {
	case constant.ChannelTypeUnknown, constant.ChannelTypeMidjourney, constant.ChannelTypeMidjourneyPlus,
		constant.ChannelTypeSunoAPI, constant.ChannelTypeKling, constant.ChannelTypeJimeng,
		constant.ChannelTypeVidu, constant.ChannelTypeDoubaoVideo, constant.ChannelTypeSora,
		constant.ChannelTypeTaskPlugin:
		return false
	}
	endpoints := common.GetEndpointTypesByChannelType(channel.Type, name)
	var other dto.ChannelOtherSettings
	if channel.OtherSettings != "" && common.UnmarshalJsonStr(channel.OtherSettings, &other) != nil {
		return false
	}
	if channel.Type == constant.ChannelTypeAdvancedCustom {
		endpoints = other.AdvancedCustom.SupportedEndpointTypesForModel(name)
	}
	if slices.Contains(endpoints, constant.EndpointTypeOpenAI) {
		return true
	}
	// Responses-only channels are usable when the same conversion policy used
	// by TextHelper is active; merely supporting Responses is not sufficient.
	var settings dto.ChannelSettings
	if channel.Setting != nil && *channel.Setting != "" && common.UnmarshalJsonStr(*channel.Setting, &settings) != nil {
		return false
	}
	return slices.Contains(endpoints, constant.EndpointTypeOpenAIResponse) &&
		other.SupportsResponsesTransport(constant.ResponsesTransportHTTP) &&
		!model_setting.GetGlobalSettings().PassThroughRequestEnabled && !settings.PassThroughBodyEnabled &&
		ShouldChatCompletionsUseResponsesGlobal(channel.Id, channel.Type, name)
}

// Legacy generic channels advertise chat even for specialized models. Use
// recognized model families as a fallback, not an allowlist of chat vendors.
// Vision and audio-input chat models remain eligible.
func isNonChatPlaygroundModel(name string) bool {
	name = strings.ToLower(name)
	if name == "" || strings.ContainsAny(name, "*?") || common.IsImageGenerationModel(name) ||
		strings.HasSuffix(name, "-openai-compact") ||
		strings.Contains(name, "gemini") && strings.Contains(name, "-image") {
		return true
	}
	for _, part := range strings.FieldsFunc(name, func(r rune) bool {
		return r == '-' || r == '_' || r == '/' || r == '.'
	}) {
		switch part {
		case "embedding", "embeddings", "embed", "bge", "e5", "text2vec", "m3e", "colbert",
			"rerank", "reranker", "whisper", "tts", "speech", "transcribe", "transcription",
			"realtime", "moderation", "sora", "veo", "suno":
			return true
		}
	}
	return strings.Contains(name, "stable-diffusion") || strings.Contains(name, "nano-banana")
}
