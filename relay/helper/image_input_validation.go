package helper

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
)

// validateImageURL rejects empty images without downloading remote URLs or
// decoding/copying non-empty base64 payloads. Image formats remain upstream-owned.
func validateImageURL(imageURL, param string) error {
	imageURL = strings.TrimSpace(imageURL)
	empty := imageURL == ""
	if len(imageURL) >= 5 && strings.EqualFold(imageURL[:5], "data:") {
		_, payload, _ := strings.Cut(imageURL, ",")
		empty = strings.TrimSpace(payload) == ""
	}
	if !empty {
		return nil
	}
	return types.WithOpenAIError(types.OpenAIError{
		Message: fmt.Sprintf("Invalid '%s': image URL or image data is empty. Remove the image attachment and upload it again before retrying.", param),
		Type:    "invalid_request_error",
		Param:   param,
		Code:    "invalid_image_url",
	}, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
}

func validateChatImageInputs(messages []dto.Message) error {
	for messageIndex, message := range messages {
		// Inspect client content directly: ParseContent can omit unknown blocks,
		// which would make the error's content index point to the wrong attachment.
		content, _ := message.Content.([]any)
		for contentIndex, value := range content {
			part, ok := value.(map[string]any)
			if !ok || part["type"] != dto.ContentTypeImageURL {
				continue
			}
			param := fmt.Sprintf("messages[%d].content[%d].image_url", messageIndex, contentIndex)
			imageURL, _ := part["image_url"].(string)
			if image, ok := part["image_url"].(map[string]any); ok {
				imageURL, _ = image["url"].(string)
				param += ".url"
			}
			if err := validateImageURL(imageURL, param); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateResponsesImageInputs(input json.RawMessage) error {
	if len(input) == 0 || common.GetJsonType(input) != "array" {
		return nil
	}
	var items []any
	if err := common.Unmarshal(input, &items); err != nil {
		return err
	}
	for inputIndex, value := range items {
		item, ok := value.(map[string]any)
		if !ok {
			continue
		}
		path := fmt.Sprintf("input[%d]", inputIndex)
		var content any
		switch item["type"] {
		case nil, "", "message":
			content = item["content"]
			path += ".content"
		case "function_call_output", "computer_call_output":
			content = item["output"]
			path += ".output"
		case "input_image":
			content = item
		default:
			continue
		}
		if err := validateResponsesImageContent(content, path); err != nil {
			return err
		}
	}
	return nil
}

func validateResponsesImageContent(content any, path string) error {
	switch value := content.(type) {
	case []any:
		for index, part := range value {
			if err := validateResponsesImageContent(part, fmt.Sprintf("%s[%d]", path, index)); err != nil {
				return err
			}
		}
	case map[string]any:
		if value["type"] != "input_image" && value["type"] != "computer_screenshot" {
			return nil
		}
		// Responses also accepts uploaded file references instead of image URLs.
		fileID, _ := value["file_id"].(string)
		if value["image_url"] == nil && strings.TrimSpace(fileID) != "" {
			return nil
		}
		imageURL, _ := value["image_url"].(string)
		return validateImageURL(imageURL, path+".image_url")
	}
	return nil
}
