package service

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/stretchr/testify/assert"
)

func TestResponsesTransportFromRequest(t *testing.T) {
	httpRequest := httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	assert.Equal(t, constant.ResponsesTransportHTTP, ResponsesTransportFromRequest(httpRequest))

	webSocketRequest := httptest.NewRequest(http.MethodGet, "/v1/responses", nil)
	webSocketRequest.Header.Set("Upgrade", "websocket")
	assert.Equal(t, constant.ResponsesTransportWebSocket, ResponsesTransportFromRequest(webSocketRequest))

	otherRequest := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	assert.Equal(t, constant.ResponsesTransportNone, ResponsesTransportFromRequest(otherRequest))
}
