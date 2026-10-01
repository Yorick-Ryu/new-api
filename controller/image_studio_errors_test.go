package controller

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestImageStudioFailureClassification(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
		want   string
	}{
		{"CPA explicit authorization rejection", 503, `{"error":{"code":"auth_unavailable","message":"private upstream diagnostic"}}`, "failed"},
		{"CPA identifier preserved in message", 503, `{"error":{"code":503,"message":"auth_unavailable: no auth available"}}`, "failed"},
		{"authorization error type", 500, `{"error":{"type":"authentication_error"}}`, "failed"},
		{"routing rejected before dispatch", 503, `{"error":{"code":"get_channel_failed"}}`, "failed"},
		{"rate limited", 429, `{"error":{"message":"private upstream diagnostic"}}`, "failed"},
		{"invalid parameters", 400, `{}`, "failed"},
		{"generic upstream failure", 503, `{"error":{"message":"upstream unavailable"}}`, "unknown"},
		{"gateway timeout", 504, `{"error":{"code":"auth_unavailable"}}`, "unknown"},
		{"request timeout", 408, `{}`, "unknown"},
		{"connection failure", 500, `{"error":{"code":"do_request_failed"}}`, "unknown"},
		{"untrusted HTML", 502, `<html>auth_unavailable: no auth available</html>`, "unknown"},
		{"embedded diagnostic is not a rejection", 503, `{"error":{"message":"connection lost after retrying auth_unavailable: diagnostic"}}`, "unknown"},
		{"oversized error", 503, `{"error":{"code":"auth_unavailable","message":"` + strings.Repeat("x", 64<<10) + `"}}`, "unknown"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, message := classifyImageStudioFailure(tc.status, []byte(tc.body))
			assert.Equal(t, tc.want, status)
			assert.NotContains(t, message, "private upstream diagnostic")
			assert.NotContains(t, message, "auth_unavailable")
		})
	}
}
