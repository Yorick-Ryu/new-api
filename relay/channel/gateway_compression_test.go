package channel

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/klauspost/compress/zstd"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGatewayCompressionRequestReplayAndScope(t *testing.T) {
	config := common.GetDiskCacheConfig()
	t.Cleanup(func() { common.SetDiskCacheConfig(config) })
	common.SetDiskCacheConfig(common.DiskCacheConfig{Enabled: true, ThresholdMB: 0, MaxSizeMB: 16, Path: t.TempDir()})
	large := `{"input":"` + strings.Repeat("gateway compression ", 256) + `"}`
	for _, tc := range []struct {
		name, path, mediaType, encoding, accept, body string
		compressed                                    bool
	}{
		{name: "responses", path: "/v1/responses", body: large, compressed: true},
		{name: "compact", path: "/v1/responses/compact", body: large, compressed: true},
		{name: "image json", path: "/v1/images/generations", body: large, compressed: true},
		{name: "small", path: "/v1/responses", body: "{}", compressed: true},
		{name: "explicit identity response", path: "/v1/responses", accept: "identity", body: large, compressed: true},
		{name: "already encoded", path: "/v1/responses", encoding: "br", body: large},
		{name: "multipart", path: "/v1/images/edits", mediaType: "multipart/form-data; boundary=test", body: large},
		{name: "other route", path: "/v1/messages", body: large},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body, owner, err := relaycommon.NewOutboundJSONBody([]byte(tc.body))
			require.NoError(t, err)
			defer owner.Close()
			req, err := http.NewRequest(http.MethodPost, "https://gateway.example"+tc.path, body)
			require.NoError(t, err)
			ApplyUpstreamBodyMetadata(req, body)
			if tc.mediaType == "" {
				tc.mediaType = "application/json"
			}
			req.Header.Set("Content-Type", tc.mediaType)
			req.Header.Set("Content-Encoding", tc.encoding)
			req.Header.Set("Accept-Encoding", tc.accept)
			ownerCompression, err := prepareCompressedGatewayRequest(req)
			require.NoError(t, err)
			if ownerCompression != nil {
				defer ownerCompression.Close()
			}
			defer req.Body.Close()
			wire, err := io.ReadAll(req.Body)
			require.NoError(t, err)
			assert.EqualValues(t, len(wire), req.ContentLength)
			replay, err := req.GetBody()
			require.NoError(t, err)
			defer replay.Close()
			replayed, err := io.ReadAll(replay)
			require.NoError(t, err)
			assert.Equal(t, wire, replayed)
			if tc.accept == "" {
				tc.accept = "gzip"
			}
			assert.Equal(t, tc.accept, req.Header.Get("Accept-Encoding"))
			if tc.compressed {
				assert.True(t, ownerCompression.(common.BodyStorage).IsDisk())
				assert.Equal(t, "zstd", req.Header.Get("Content-Encoding"))
				decoder, err := zstd.NewReader(nil)
				require.NoError(t, err)
				defer decoder.Close()
				decoded, err := decoder.DecodeAll(wire, nil)
				require.NoError(t, err)
				assert.Equal(t, tc.body, string(decoded))
			} else {
				assert.Equal(t, tc.encoding, req.Header.Get("Content-Encoding"))
				assert.Equal(t, tc.body, string(wire))
			}
			// The caller still owns the original body for channel-level retries.
			original, err := body.NewReader()
			require.NoError(t, err)
			defer original.Close()
			raw, err := io.ReadAll(original)
			require.NoError(t, err)
			assert.Equal(t, tc.body, string(raw))
		})
	}
}

func TestGatewayCompressionHTTPRoundTrip(t *testing.T) {
	service.InitHttpClient()
	payload := `{"input":"` + strings.Repeat("long context ", 512) + `"}`
	for _, enabled := range []bool{false, true} {
		t.Run(map[bool]string{false: "disabled", true: "enabled"}[enabled], func(t *testing.T) {
			observed := make(chan string, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				wire, err := io.ReadAll(r.Body)
				if err != nil {
					t.Error(err)
					return
				}
				if enabled {
					assert.Equal(t, "zstd", r.Header.Get("Content-Encoding"))
					assert.Less(t, len(wire), len(payload))
					decoder, err := zstd.NewReader(nil)
					if !assert.NoError(t, err) {
						return
					}
					defer decoder.Close()
					wire, err = decoder.DecodeAll(wire, nil)
					assert.NoError(t, err)
				} else {
					assert.Empty(t, r.Header.Get("Content-Encoding"))
				}
				observed <- string(wire)
				w.Header().Set("Content-Encoding", "gzip")
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				encoder := gzip.NewWriter(w)
				_, _ = io.WriteString(encoder, `{"error":"invalid fixture"}`)
				_ = encoder.Close()
			}))
			defer server.Close()
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
			req, err := http.NewRequest(http.MethodPost, server.URL+"/v1/responses", strings.NewReader(payload))
			require.NoError(t, err)
			req.Header.Set("Content-Type", "application/json")
			info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelSetting: dto.ChannelSettings{HTTPCompression: enabled}}}
			response, err := doRequest(c, req, info)
			require.NoError(t, err)
			defer response.Body.Close()
			assert.Equal(t, http.StatusBadRequest, response.StatusCode)
			assert.Empty(t, response.Header.Get("Content-Encoding"))
			body, err := io.ReadAll(response.Body)
			require.NoError(t, err)
			assert.Equal(t, `{"error":"invalid fixture"}`, string(body))
			assert.Equal(t, payload, <-observed)
		})
	}
}

func TestGatewayCompressionResponseEncodingOverrides(t *testing.T) {
	service.InitHttpClient()
	for _, tc := range []struct {
		name     string
		headers  []string
		want     string
		disabled bool
		invalid  bool
	}{
		{name: "default", want: "gzip"},
		{name: "identity", headers: []string{"identity"}, want: "identity"},
		{name: "weighted supported encodings", headers: []string{"gzip;q=0.5, identity;q=1"}, want: "gzip;q=0.5, identity;q=1"},
		{name: "multiple supported fields", headers: []string{"gzip", "identity;q=0"}, want: "gzip,identity;q=0"},
		{name: "case insensitive", headers: []string{"GZIP"}, want: "GZIP"},
		{name: "gzip excluded", headers: []string{"gzip;q=0, identity"}, want: "gzip;q=0, identity"},
		{name: "zstd", headers: []string{"zstd"}, invalid: true},
		{name: "mixed unsupported", headers: []string{"gzip, br"}, invalid: true},
		{name: "wildcard", headers: []string{"*"}, invalid: true},
		{name: "unsupported second field", headers: []string{"gzip", "zstd"}, invalid: true},
		{name: "invalid quality", headers: []string{"gzip;q=NaN"}, invalid: true},
		{name: "quality out of range", headers: []string{"gzip;q=2"}, invalid: true},
		{name: "malformed parameter", headers: []string{"gzip;q"}, invalid: true},
		{name: "disabled preserves override", headers: []string{"zstd"}, want: "zstd", disabled: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			observed := make(chan string, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				observed <- strings.Join(r.Header.Values("Accept-Encoding"), ",")
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, `{}`)
			}))
			defer server.Close()
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodGet, "/v1/models", nil)
			// Response negotiation also applies to routes without request compression.
			req, err := http.NewRequest(http.MethodGet, server.URL+"/v1/models", http.NoBody)
			require.NoError(t, err)
			for _, value := range tc.headers {
				req.Header.Add("Accept-Encoding", value)
			}
			info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelSetting: dto.ChannelSettings{HTTPCompression: !tc.disabled}}}
			response, err := doRequest(c, req, info)
			if tc.invalid {
				require.ErrorContains(t, err, "Accept-Encoding")
				require.Nil(t, response)
				select {
				case <-observed:
					t.Fatal("unsupported response encoding reached upstream")
				default:
				}
				return
			}
			require.NoError(t, err)
			defer response.Body.Close()
			assert.Equal(t, tc.want, <-observed)
			body, err := io.ReadAll(response.Body)
			require.NoError(t, err)
			assert.Equal(t, `{}`, string(body))
		})
	}
}

func TestGatewayCompressionSSEFlushAndCancellation(t *testing.T) {
	service.InitHttpClient()
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		encoder := gzip.NewWriter(w)
		defer encoder.Close()
		_, _ = io.WriteString(encoder, "data: first\n\n")
		_ = encoder.Flush()
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil).WithContext(ctx)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/v1/responses", strings.NewReader("{}"))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelSetting: dto.ChannelSettings{HTTPCompression: true}}}
	response, err := doRequest(c, req, info)
	require.NoError(t, err, "response headers must arrive before gzip body bytes")
	defer response.Body.Close()
	close(release)
	reader := bufio.NewReader(response.Body)
	line, err := reader.ReadString('\n')
	require.NoError(t, err)
	assert.Equal(t, "data: first\n", line)
	cancel()
	_, err = io.ReadAll(reader)
	assert.ErrorIs(t, err, context.Canceled)
}

func TestGatewayCompressionDecodeFailureAndEarlyClose(t *testing.T) {
	for _, data := range [][]byte{[]byte("invalid gzip"), nil} {
		source := &gatewayTestBody{Reader: bytes.NewReader(data)}
		body := &gatewayGzipBody{source: source}
		if data != nil {
			_, err := io.ReadAll(body)
			assert.Error(t, err)
		}
		require.NoError(t, body.Close())
		assert.True(t, source.closed)
	}
	source := &gatewayTestBody{Reader: io.MultiReader(strings.NewReader("some bytes"), gatewayErrorReader{})}
	req, err := http.NewRequest(http.MethodPost, "https://gateway.example/v1/responses", source)
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	_, err = prepareCompressedGatewayRequest(req)
	assert.ErrorContains(t, err, "source read failed")
	assert.True(t, source.closed)
	assert.Empty(t, req.Header.Get("Content-Encoding"))
}

type gatewayTestBody struct {
	io.Reader
	closed bool
}

func (b *gatewayTestBody) Close() error { b.closed = true; return nil }

type gatewayErrorReader struct{}

func (gatewayErrorReader) Read([]byte) (int, error) { return 0, errors.New("source read failed") }

type gatewayWebsocketAdaptor struct {
	Adaptor
	url string
}

func (a gatewayWebsocketAdaptor) GetRequestURL(*relaycommon.RelayInfo) (string, error) {
	return a.url, nil
}

func (gatewayWebsocketAdaptor) SetupRequestHeader(*gin.Context, *http.Header, *relaycommon.RelayInfo) error {
	return nil
}

type gatewayRecordedConn struct {
	net.Conn
	received bytes.Buffer
}

func (c *gatewayRecordedConn) Read(p []byte) (int, error) {
	n, err := c.Conn.Read(p)
	c.received.Write(p[:n])
	return n, err
}

type gatewayRecordingListener struct{ net.Listener }

func (l gatewayRecordingListener) Accept() (net.Conn, error) {
	conn, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	return &gatewayRecordedConn{Conn: conn}, nil
}

func TestGatewayCompressionWebsocketNegotiationAndRoundTrip(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		for _, supported := range []bool{false, true} {
			name := map[bool]string{false: "disabled", true: "enabled"}[enabled] + "/" + map[bool]string{false: "plain peer", true: "compression peer"}[supported]
			t.Run(name, func(t *testing.T) {
				payload := []byte(`{"type":"response.create","input":"` + strings.Repeat("context ", 1024) + `"}`)
				ready := make(chan struct{})
				done := make(chan struct{})
				server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					defer close(done)
					assert.Equal(t, enabled, strings.Contains(r.Header.Get("Sec-WebSocket-Extensions"), "permessage-deflate"))
					conn, err := (&websocket.Upgrader{EnableCompression: supported}).Upgrade(w, r, nil)
					if !assert.NoError(t, err) {
						close(ready)
						return
					}
					defer conn.Close()
					wire := conn.NetConn().(*gatewayRecordedConn)
					wire.received.Reset()
					close(ready)
					_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
					kind, body, err := conn.ReadMessage()
					if !assert.NoError(t, err) {
						return
					}
					assert.Equal(t, websocket.TextMessage, kind)
					assert.Equal(t, payload, body)
					if assert.NotEmpty(t, wire.received.Bytes()) {
						assert.Equal(t, enabled && supported, wire.received.Bytes()[0]&0x40 != 0, "the actual request frame must be compressed")
					}
					if enabled && supported {
						assert.Less(t, wire.received.Len(), len(payload))
					}
					_ = conn.SetCompressionLevel(6)
					conn.EnableWriteCompression(true)
					assert.NoError(t, conn.WriteMessage(websocket.TextMessage, body))
				}))
				server.Listener = gatewayRecordingListener{server.Listener}
				server.Start()
				defer server.Close()
				c, _ := gin.CreateTestContext(httptest.NewRecorder())
				c.Request = httptest.NewRequest(http.MethodGet, "/v1/responses", nil)
				info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelSetting: dto.ChannelSettings{WebsocketCompression: enabled}}}
				conn, err := DoWssRequest(gatewayWebsocketAdaptor{url: server.URL + "/v1/responses"}, c, info, nil)
				require.NoError(t, err)
				defer conn.Close()
				<-ready
				require.NoError(t, conn.WriteMessage(websocket.TextMessage, payload))
				require.NoError(t, conn.SetReadDeadline(time.Now().Add(5*time.Second)))
				_, response, err := conn.ReadMessage()
				require.NoError(t, err)
				assert.Equal(t, payload, response)
				<-done
			})
		}
	}
}
