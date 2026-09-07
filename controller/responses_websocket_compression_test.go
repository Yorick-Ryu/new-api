package controller

import (
	"context"
	"net"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type responsesWSCountingConn struct {
	net.Conn
	written atomic.Int64
}

func (c *responsesWSCountingConn) Write(p []byte) (int, error) {
	n, err := c.Conn.Write(p)
	c.written.Add(int64(n))
	return n, err
}

func TestResponsesWebSocketUploadCompression(t *testing.T) {
	const limit = 1 << 20
	t.Setenv("WEBSOCKET_MAX_MESSAGE_MB", "1")
	for _, tc := range []struct {
		name        string
		negotiate   bool
		compress    bool
		payloadSize int
	}{
		{name: "plain at limit", payloadSize: limit},
		{name: "compressed at limit", negotiate: true, compress: true, payloadSize: limit},
		{name: "plain over limit", payloadSize: limit + 1},
		{name: "compressed over limit", negotiate: true, compress: true, payloadSize: limit + 1},
		{name: "negotiated but plain at limit", negotiate: true, payloadSize: limit},
		{name: "negotiated but plain over limit", negotiate: true, payloadSize: limit + 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			router := gin.New()
			// Exercise the production upgrade and message reader without needing an
			// upstream or billing fixture: this event must fail before channel selection.
			router.GET("/v1/responses", ResponsesWebSocket)
			server := httptest.NewServer(router)
			defer server.Close()

			var wire *responsesWSCountingConn
			dialer := websocket.Dialer{
				EnableCompression: tc.negotiate,
				// Force large messages across continuation frames as well.
				WriteBufferSize: 64,
				NetDialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
					conn, err := (&net.Dialer{}).DialContext(ctx, network, addr)
					if err != nil {
						return nil, err
					}
					wire = &responsesWSCountingConn{Conn: conn}
					return wire, nil
				},
			}
			client, response, err := dialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/v1/responses", nil)
			require.NoError(t, err)
			defer client.Close()
			if tc.negotiate {
				assert.Contains(t, response.Header.Get("Sec-WebSocket-Extensions"), "permessage-deflate")
			} else {
				assert.Empty(t, response.Header.Get("Sec-WebSocket-Extensions"))
			}
			require.NoError(t, client.SetCompressionLevel(6))
			client.EnableWriteCompression(tc.compress)
			require.NoError(t, client.SetWriteDeadline(time.Now().Add(5*time.Second)))
			require.NoError(t, client.SetReadDeadline(time.Now().Add(5*time.Second)))

			const prefix = `{"type":"response.cancel","padding":"`
			const suffix = `"}`
			payload := prefix + strings.Repeat("a", tc.payloadSize-len(prefix)-len(suffix)) + suffix
			before := wire.written.Load()
			writer, err := client.NextWriter(websocket.TextMessage)
			require.NoError(t, err)
			_, writeErr := writer.Write([]byte(payload))
			closeErr := writer.Close()
			if tc.payloadSize <= limit {
				require.NoError(t, writeErr)
				require.NoError(t, closeErr)
			}
			if tc.compress {
				assert.Less(t, wire.written.Load()-before, int64(tc.payloadSize/10), "upload should actually be compressed on the wire")
			}

			_, reply, err := client.ReadMessage()
			if tc.payloadSize > limit {
				var wsClose *websocket.CloseError
				require.ErrorAs(t, err, &wsClose)
				assert.Equal(t, websocket.CloseMessageTooBig, wsClose.Code)
				return
			}
			require.NoError(t, err)
			var event struct {
				Type   string `json:"type"`
				Status int    `json:"status"`
				Error  struct {
					Message string `json:"message"`
				} `json:"error"`
			}
			require.NoError(t, common.Unmarshal(reply, &event))
			assert.Equal(t, "error", event.Type)
			assert.Equal(t, 400, event.Status)
			assert.Contains(t, event.Error.Message, "first responses websocket event must be ")

			// Uncompressed messages remain valid on the same negotiated connection,
			// and reaching the limit must not corrupt the next message boundary.
			client.EnableWriteCompression(false)
			require.NoError(t, client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.cancel"}`)))
			_, nextReply, err := client.ReadMessage()
			require.NoError(t, err)
			assert.JSONEq(t, string(reply), string(nextReply))
			require.NoError(t, client.WriteControl(websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""), time.Now().Add(time.Second)))
			_, _, err = client.ReadMessage()
			assert.True(t, websocket.IsCloseError(err, websocket.CloseNormalClosure))
		})
	}
}
