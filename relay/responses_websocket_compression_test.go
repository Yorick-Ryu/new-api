package relay

import (
	"bytes"
	"context"
	"encoding/binary"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type responsesWSRecordedConn struct {
	net.Conn
	received bytes.Buffer
}

func (c *responsesWSRecordedConn) Read(p []byte) (int, error) {
	n, err := c.Conn.Read(p)
	c.received.Write(p[:n])
	return n, err
}

func TestResponsesWebSocketResponseCompression(t *testing.T) {
	for _, tc := range []struct {
		name      string
		negotiate bool
	}{
		{name: "negotiated", negotiate: true},
		{name: "unsupported client"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			upgrader := websocket.Upgrader{EnableCompression: true, WriteBufferSize: 128}
			connections := make(chan *websocket.Conn, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				conn, err := upgrader.Upgrade(w, r, nil)
				if err != nil {
					t.Errorf("upgrade: %v", err)
					return
				}
				connections <- conn
			}))
			defer server.Close()
			var wire *responsesWSRecordedConn
			dialer := websocket.Dialer{
				EnableCompression: tc.negotiate,
				NetDialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
					conn, err := (&net.Dialer{}).DialContext(ctx, network, addr)
					if err != nil {
						return nil, err
					}
					wire = &responsesWSRecordedConn{Conn: conn}
					return wire, nil
				},
			}
			client, response, err := dialer.Dial("ws"+strings.TrimPrefix(server.URL, "http"), nil)
			require.NoError(t, err)
			defer client.Close()
			assert.Equal(t, tc.negotiate, strings.Contains(response.Header.Get("Sec-WebSocket-Extensions"), "permessage-deflate"))
			serverConn := <-connections
			defer serverConn.Close()
			require.NoError(t, serverConn.SetCompressionLevel(6))
			session := &responsesWSSession{client: serverConn}
			// No data is sent until after the handshake, so recording starts at a frame boundary.
			wire.received.Reset()
			require.NoError(t, client.SetReadDeadline(time.Now().Add(5*time.Second)))
			var expectedCompression []bool
			for _, size := range []int{1023, 1024, 1025, 64} {
				// Include UTF-8 to verify that the threshold is bytes, not characters.
				const prefix = `{"type":"response.output_text.delta","delta":"界`
				const suffix = `"}`
				payload := []byte(prefix + strings.Repeat("a", size-len(prefix)-len(suffix)) + suffix)
				require.NoError(t, session.writeClient(websocket.TextMessage, payload))
				messageType, received, err := client.ReadMessage()
				require.NoError(t, err)
				assert.Equal(t, websocket.TextMessage, messageType)
				assert.Equal(t, payload, received)
				expectedCompression = append(expectedCompression, tc.negotiate && size >= 1024)
			}

			// Concurrent error/delta writers must not change another message's compression
			// mode or interleave its frames. Heartbeat frames remain uncompressed.
			require.NoError(t, serverConn.WriteControl(websocket.PingMessage, []byte("heartbeat"), time.Now().Add(time.Second)))
			payloads := []string{strings.Repeat("b", 1024), "small delta", strings.Repeat("c", 2048), "small error"}
			writes := make(chan error, len(payloads))
			start := make(chan struct{})
			for _, payload := range payloads {
				go func() {
					<-start
					writes <- session.writeClient(websocket.TextMessage, []byte(payload))
				}()
			}
			close(start)
			var receivedPayloads []string
			for range payloads {
				messageType, received, err := client.ReadMessage()
				require.NoError(t, err)
				assert.Equal(t, websocket.TextMessage, messageType)
				receivedPayloads = append(receivedPayloads, string(received))
				expectedCompression = append(expectedCompression, tc.negotiate && len(received) >= 1024)
			}
			for range payloads {
				require.NoError(t, <-writes)
			}
			assert.ElementsMatch(t, payloads, receivedPayloads)

			// Check the actual RSV1 bit on the wire; successful decoding alone would
			// also pass if every message were sent uncompressed.
			frames := bytes.NewReader(wire.received.Bytes())
			var actualCompression []bool
			pings := 0
			for frames.Len() > 0 {
				var header [2]byte
				_, err := io.ReadFull(frames, header[:])
				require.NoError(t, err)
				assert.Zero(t, header[1]&0x80, "server frames must not be masked")
				size := uint64(header[1] & 0x7f)
				switch size {
				case 126:
					var extended uint16
					require.NoError(t, binary.Read(frames, binary.BigEndian, &extended))
					size = uint64(extended)
				case 127:
					require.NoError(t, binary.Read(frames, binary.BigEndian, &size))
				}
				require.LessOrEqual(t, size, uint64(frames.Len()))
				_, err = frames.Seek(int64(size), io.SeekCurrent)
				require.NoError(t, err)
				switch header[0] & 0x0f {
				case websocket.TextMessage:
					actualCompression = append(actualCompression, header[0]&0x40 != 0)
				case 0: // Continuation frames never carry RSV1.
					assert.Zero(t, header[0]&0x40)
				case websocket.PingMessage:
					pings++
					assert.Zero(t, header[0]&0x40)
				default:
					t.Fatalf("unexpected frame opcode %d", header[0]&0x0f)
				}
			}
			assert.Equal(t, 1, pings)
			assert.Equal(t, expectedCompression, actualCompression)
		})
	}
}
