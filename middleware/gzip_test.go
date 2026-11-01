package middleware

import (
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/andybalholm/brotli"
	"github.com/gin-gonic/gin"
	"github.com/klauspost/compress/zstd"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"io"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
)

// runDecompressMiddleware runs DecompressRequestMiddleware against a request
// built from the given encoding + raw body, then returns the fully-drained
// request body (after decompression) and the HTTP status the middleware may
// have aborted with (0 means no abort).
func runDecompressMiddleware(t *testing.T, encoding string, compressedBody []byte) (string, int) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	r := gin.New()
	var captured string
	var status int
	r.Use(DecompressRequestMiddleware())
	r.POST("/v1/echo", func(c *gin.Context) {
		buf, err := io.ReadAll(c.Request.Body)
		if err != nil {
			status = -1
			c.String(http.StatusBadRequest, "read err: %v", err)
			return
		}
		captured = string(buf)
		// Confirm the middleware stripped Content-Encoding, the same way it
		// does for gzip/br — without this, downstream proxies would re-encode
		// or reject the body again.
		ce := c.GetHeader("Content-Encoding")
		assert.Empty(t, ce, "Content-Encoding header not stripped for %q", encoding)
		c.String(http.StatusOK, "ok")
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/echo", bytes.NewReader(compressedBody))
	req.Header.Set("Content-Type", "application/json")
	if encoding != "" {
		req.Header.Set("Content-Encoding", encoding)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if status == 0 {
		status = w.Code
	}
	if status == http.StatusOK {
		return captured, status
	}
	return "", status
}

func compressGzip(t *testing.T, raw []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	_, err := gw.Write(raw)
	require.NoError(t, err)
	require.NoError(t, gw.Close())
	return buf.Bytes()
}

func compressBrotli(t *testing.T, raw []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	bw := brotli.NewWriter(&buf)
	_, err := bw.Write(raw)
	require.NoError(t, err)
	require.NoError(t, bw.Close())
	return buf.Bytes()
}

func compressZstd(t *testing.T, raw []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	encoder, err := zstd.NewWriter(&buf)
	require.NoError(t, err)
	_, err = encoder.Write(raw)
	require.NoError(t, err)
	require.NoError(t, encoder.Close())
	return buf.Bytes()
}

// TestDecompressRequestMiddleware_Zstd verifies the regression from issue
// #6313: a Content-Encoding: zstd body used to be passed through verbatim,
// causing JSON parsing to fail on the zstd magic bytes (0x28 = '(').
func TestDecompressRequestMiddleware_Zstd(t *testing.T) {
	raw := []byte(`{"model":"gpt-4","input":[{"role":"user","content":"hi"}]}`)
	body := compressZstd(t, raw)

	// Sanity: confirm we actually produced a zstd frame whose magic would be
	// misread as '(' — otherwise the regression test isn't exercising the bug.
	require.GreaterOrEqual(t, len(body), 4)
	require.Equal(t, byte(0x28), body[0], "expected zstd magic 0x28.., got % x", body[:min(4, len(body))])

	got, status := runDecompressMiddleware(t, "zstd", body)
	require.Equal(t, http.StatusOK, status, "expected 200 OK (the bug from #6313 yields 400 with `invalid character '('`)")
	assert.Equal(t, string(raw), got, "decompressed body mismatch")
}

// TestDecompressRequestMiddleware_AllEncodingsBehaviorParity documents that
// zstd, gzip and br all behave identically: decode to the original payload
// and strip the Content-Encoding header.
func TestDecompressRequestMiddleware_AllEncodingsBehaviorParity(t *testing.T) {
	raw := []byte(`{"hello":"world","n":42}`)

	cases := []struct {
		name     string
		encoding string
		encode   func(t *testing.T, raw []byte) []byte
	}{
		{"gzip", "gzip", compressGzip},
		{"br", "br", compressBrotli},
		{"zstd", "zstd", compressZstd},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, status := runDecompressMiddleware(t, tc.encoding, tc.encode(t, raw))
			require.Equal(t, http.StatusOK, status, "%s: expected 200", tc.name)
			assert.Equal(t, string(raw), got, "%s: body mismatch", tc.name)
		})
	}
}

// TestDecompressRequestMiddleware_UncompressedPassThrough ensures the default
// branch keeps working (no Content-Encoding → body untouched).
func TestDecompressRequestMiddleware_UncompressedPassThrough(t *testing.T) {
	raw := []byte(`{"hello":"world"}`)
	got, status := runDecompressMiddleware(t, "", raw)
	require.Equal(t, http.StatusOK, status)
	assert.Equal(t, string(raw), got, "uncompressed body should pass through untouched")
}

// TestDecompressRequestMiddleware_InvalidZstdDoesNotLeak verifies that a
// Content-Encoding: zstd header on a body that is *not* a valid zstd frame
// does NOT leak raw garbage to the JSON parser. zstd.NewReader is lazy on
// v1.18, so the error surfaces at the first Read — we assert the handler
// sees a read error (or empty body) rather than receiving raw bytes it would
// then misinterpret as JSON.
func TestDecompressRequestMiddleware_InvalidZstdDoesNotLeak(t *testing.T) {
	gin.SetMode(gin.TestMode)
	invalid := []byte("definitely not a zstd frame")

	r := gin.New()
	var readErr error
	var captured []byte
	r.Use(DecompressRequestMiddleware())
	r.POST("/v1/echo", func(c *gin.Context) {
		captured, readErr = io.ReadAll(c.Request.Body)
		if readErr != nil {
			c.String(http.StatusBadRequest, "read err: %v", readErr)
			return
		}
		c.String(http.StatusOK, "ok")
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/echo", bytes.NewReader(invalid))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Content-Encoding", "zstd")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	// Either the read surfaced an error and we returned 400, or the decoder
	// produced empty output. The one thing that must NOT happen is the raw
	// `invalid` bytes reaching the handler as if they were JSON — that is
	// exactly the regression from #6313.
	if readErr == nil {
		assert.False(t, bytes.Equal(captured, invalid), "invalid zstd body leaked to handler as raw bytes: %q", captured)
	}
}

// TestDecompressRequestMiddleware_GetSkipped verifies GET requests are not
// touched (existing behaviour, kept stable by this change).
func TestDecompressRequestMiddleware_GetSkipped(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(DecompressRequestMiddleware())
	r.GET("/v1/ping", func(c *gin.Context) { c.String(http.StatusOK, "pong") })

	req := httptest.NewRequest(http.MethodGet, "/v1/ping", strings.NewReader(""))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "pong", w.Body.String())
}

// TestDecompressRequestMiddleware_ZstdProducesValidJSON verifies the
// end-to-end intent of #6313: after decompression, the body must be
// unmarshallable as JSON by the project's own common.Unmarshal wrapper
// (which is what downstream relay handlers actually call). This guards the
// regression at the level the bug actually surfaces.
func TestDecompressRequestMiddleware_ZstdProducesValidJSON(t *testing.T) {
	gin.SetMode(gin.TestMode)

	type payload struct {
		Model string `json:"model"`
	}
	raw, err := common.Marshal(payload{Model: "gpt-4"})
	require.NoError(t, err)
	body := compressZstd(t, raw)

	r := gin.New()
	var decoded payload
	r.Use(DecompressRequestMiddleware())
	r.POST("/v1/echo", func(c *gin.Context) {
		require.NoError(t, common.UnmarshalJsonStr(string(mustReadAll(t, c.Request.Body)), &decoded))
		c.String(http.StatusOK, "ok")
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/echo", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Content-Encoding", "zstd")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "gpt-4", decoded.Model)
}

func mustReadAll(t *testing.T, r io.Reader) []byte {
	t.Helper()
	b, err := io.ReadAll(r)
	require.NoError(t, err)
	return b
}

var zstdMagic = []byte{0x28, 0xb5, 0x2f, 0xfd}

// zstdRLEBlock is a last block that repeats 'a' once.
var zstdRLEBlock = []byte{0x0b, 0x00, 0x00, 'a'}

func readZstdBody(t *testing.T, body []byte) ([]byte, error) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	var data []byte
	var readErr error
	router.POST("/v1/chat/completions", DecompressRequestMiddleware(), func(c *gin.Context) {
		data, readErr = io.ReadAll(c.Request.Body)
	})
	request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(body))
	request.Header.Set("Content-Encoding", "zstd")
	t.Cleanup(func() {
		assert.NoError(t, request.Body.Close())
	})
	router.ServeHTTP(httptest.NewRecorder(), request)
	return data, readErr
}

func TestDecompressRequestZstd(t *testing.T) {
	previousMaxBodyMB := constant.MaxRequestBodyMB
	constant.MaxRequestBodyMB = 16
	t.Cleanup(func() {
		constant.MaxRequestBodyMB = previousMaxBodyMB
	})

	encoder, err := zstd.NewWriter(nil, zstd.WithEncoderConcurrency(1))
	require.NoError(t, err)
	payload := bytes.Repeat([]byte(`{"role":"user","content":"hello"},`), 1<<15)
	compressed := encoder.EncodeAll(payload, nil)
	require.NoError(t, encoder.Close())

	// Window descriptors 0x50, 0x68, 0x69, and 0x98 declare 1MiB, 8MiB, 9MiB, and 512MiB windows.
	smallWindowFrame := append(append(append([]byte{}, zstdMagic...), 0x00, 0x50), zstdRLEBlock...)
	boundaryWindowFrame := append(append(append([]byte{}, zstdMagic...), 0x00, 0x68), zstdRLEBlock...)
	aboveWindowFrame := append(append(append([]byte{}, zstdMagic...), 0x00, 0x69), zstdRLEBlock...)
	largeWindowFrame := append(append(append([]byte{}, zstdMagic...), 0x00, 0x98), zstdRLEBlock...)
	// A single-segment frame uses its declared content size, here 100MiB, as the window.
	largeContentFrame := binary.LittleEndian.AppendUint64(append(append([]byte{}, zstdMagic...), 0xe0), 100<<20)
	largeContentFrame = append(largeContentFrame, zstdRLEBlock...)

	largePayload := bytes.Repeat([]byte("a"), 9<<20)
	boundedEncoder, err := zstd.NewWriter(nil, zstd.WithWindowSize(1<<20), zstd.WithSingleSegment(false), zstd.WithEncoderConcurrency(1))
	require.NoError(t, err)
	largeBody := boundedEncoder.EncodeAll(largePayload, nil)
	require.NoError(t, boundedEncoder.Close())
	var header zstd.Header
	require.NoError(t, header.Decode(largeBody))
	require.False(t, header.SingleSegment)
	require.LessOrEqual(t, header.WindowSize, uint64(8<<20))

	singleEncoder, err := zstd.NewWriter(nil, zstd.WithSingleSegment(true), zstd.WithEncoderConcurrency(1))
	require.NoError(t, err)
	boundaryContentFrame := singleEncoder.EncodeAll(largePayload[:8<<20], nil)
	aboveContentFrame := singleEncoder.EncodeAll(largePayload[:(8<<20)+1], nil)
	require.NoError(t, singleEncoder.Close())
	for _, frame := range [][]byte{boundaryContentFrame, aboveContentFrame} {
		require.NoError(t, header.Decode(frame))
		require.True(t, header.SingleSegment)
	}

	cases := []struct {
		name           string
		body           []byte
		wantBody       []byte
		wantErr        error
		maxBodyMB      int
		wantLimitError bool
	}{
		{name: "regular body is decompressed", body: compressed, wantBody: payload},
		{name: "512MiB window is rejected", body: largeWindowFrame, wantErr: zstd.ErrWindowSizeExceeded},
		{name: "100MiB single-segment window is rejected", body: largeContentFrame, wantErr: zstd.ErrDecoderSizeExceeded},
		{name: "8MiB window is accepted", body: boundaryWindowFrame, wantBody: []byte("a")},
		{name: "9MiB window is rejected", body: aboveWindowFrame, wantErr: zstd.ErrWindowSizeExceeded},
		{name: "8MiB single-segment body is accepted", body: boundaryContentFrame, wantBody: largePayload[:8<<20]},
		{name: "single-segment body one byte above 8MiB is rejected", body: aboveContentFrame, wantErr: zstd.ErrDecoderSizeExceeded},
		{name: "9MiB body with a bounded window is decompressed", body: largeBody, wantBody: largePayload},
		{name: "bounded window does not bypass the decoded body limit", body: largeBody, wantBody: largePayload[:1<<20], maxBodyMB: 1, wantLimitError: true},
		{name: "window equal to a smaller request limit is accepted", body: smallWindowFrame, wantBody: []byte("a"), maxBodyMB: 1},
		{name: "window above a smaller request limit is rejected", body: boundaryWindowFrame, wantErr: zstd.ErrWindowSizeExceeded, maxBodyMB: 1},
		{name: "single-segment window above a smaller request limit is rejected", body: boundaryContentFrame, wantErr: zstd.ErrDecoderSizeExceeded, maxBodyMB: 1},
		{name: "oversized window in a later frame is rejected", body: append(append([]byte{}, compressed...), largeWindowFrame...), wantBody: payload, wantErr: zstd.ErrWindowSizeExceeded},
		{name: "oversized single-segment window in a later frame is rejected", body: append(append([]byte{}, compressed...), aboveContentFrame...), wantBody: payload, wantErr: zstd.ErrDecoderSizeExceeded},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.maxBodyMB > 0 {
				constant.MaxRequestBodyMB = tc.maxBodyMB
				t.Cleanup(func() {
					constant.MaxRequestBodyMB = 16
				})
			}
			data, err := readZstdBody(t, tc.body)

			switch {
			case tc.wantLimitError:
				var sizeErr *http.MaxBytesError
				require.ErrorAs(t, err, &sizeErr)
				assert.Equal(t, int64(tc.maxBodyMB)<<20, sizeErr.Limit)
			case tc.wantErr != nil:
				require.ErrorIs(t, err, tc.wantErr)
			default:
				require.NoError(t, err)
			}
			if tc.wantBody == nil {
				assert.Empty(t, data)
				return
			}
			assert.Equal(t, tc.wantBody, data)
		})
	}
}

type zstdBodyReadCounter struct {
	reads atomic.Int32
}

func (b *zstdBodyReadCounter) Read([]byte) (int, error) {
	b.reads.Add(1)
	return 0, io.EOF
}

func TestDecompressRequestZstdEarlyRejectionDoesNotReadBody(t *testing.T) {
	// Keep this regression meaningful even on hosts where the default decoder
	// would otherwise be synchronous because GOMAXPROCS is 1.
	previousProcs := runtime.GOMAXPROCS(2)
	t.Cleanup(func() {
		runtime.GOMAXPROCS(previousProcs)
	})

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/v1/chat/completions", DecompressRequestMiddleware(), func(c *gin.Context) {
		c.AbortWithStatus(http.StatusUnauthorized)
	})
	body := &zstdBodyReadCounter{}
	request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", io.NopCloser(body))
	request.Header.Set("Content-Encoding", "zstd")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	// Closing also joins any asynchronous decoder before checking the read count.
	require.NoError(t, request.Body.Close())
	assert.Equal(t, http.StatusUnauthorized, response.Code)
	assert.Zero(t, body.reads.Load(), "an early rejection must not consume the request body")
}
