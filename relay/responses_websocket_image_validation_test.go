package relay

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResponsesWebSocketRejectsEmptyImageBeforeUpstream(t *testing.T) {
	client, server, cleanup := newTestWebSocketPair(t)
	defer cleanup()
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/v1/responses", nil)
	done := make(chan *types.NewAPIError, 1)
	go func() {
		done <- responsesWebSocketHelper(c, server, responsesWSHeartbeatConfig{})
	}()
	// Both supported event envelopes must return a recoverable error without
	// requiring a configured user balance or an upstream channel.
	events := []struct{ id, body string }{
		{"evt-flat", `{"type":"response.create","event_id":"evt-flat","model":"gpt-test","input":[{"role":"user","content":[{"type":"input_image","image_url":"data:image/png;base64,"}]}]}`},
		{"evt-wrapped", `{"type":"response.create","event_id":"evt-wrapped","response":{"model":"gpt-test","input":[{"role":"user","content":[{"type":"input_image","image_url":"data:image/png;base64,"}]}]}}`},
	}
	for _, event := range events {
		require.NoError(t, client.WriteMessage(websocket.TextMessage, []byte(event.body)))
		require.NoError(t, client.SetReadDeadline(time.Now().Add(5*time.Second)))
		_, payload, err := client.ReadMessage()
		require.NoError(t, err)
		var response struct {
			Type    string            `json:"type"`
			Status  int               `json:"status"`
			EventID string            `json:"event_id"`
			Error   types.OpenAIError `json:"error"`
		}
		require.NoError(t, common.Unmarshal(payload, &response))
		assert.Equal(t, "error", response.Type)
		assert.Equal(t, http.StatusBadRequest, response.Status)
		assert.Equal(t, event.id, response.EventID)
		assert.Equal(t, "invalid_image_url", response.Error.Code)
		assert.Equal(t, "input[0].content[0].image_url", response.Error.Param)
	}
	require.NoError(t, client.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""), time.Now().Add(time.Second)))
	select {
	case err := <-done:
		require.Nil(t, err)
	case <-time.After(5 * time.Second):
		t.Fatal("websocket relay did not close")
	}
}
