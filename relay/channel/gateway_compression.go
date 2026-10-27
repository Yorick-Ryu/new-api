package channel

import (
	"bytes"
	"compress/gzip"
	"io"
	"mime"
	"net/http"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/klauspost/compress/zstd"
)

var gatewayRequestEncoders sync.Pool

// prepareCompressedGatewayRequest runs after body conversion and header overrides.
// It changes only transport encoding; retries replay the same compressed bytes.
func prepareCompressedGatewayRequest(req *http.Request) (io.Closer, error) {
	if req.Header.Get("Accept-Encoding") == "" {
		req.Header.Set("Accept-Encoding", "gzip")
	}
	// CPA decodes these JSON routes before parsing. Multipart uploads and other
	// routes keep their existing request body representation.
	switch req.URL.Path {
	case "/v1/responses", "/v1/responses/compact", "/v1/chat/completions", "/v1/completions",
		"/v1/images/generations", "/v1/images/edits", "/backend-api/codex/responses", "/backend-api/codex/responses/compact":
	default:
		return nil, nil
	}
	mediaType, _, _ := mime.ParseMediaType(req.Header.Get("Content-Type"))
	if req.Body == nil || req.Body == http.NoBody || req.Method != http.MethodPost ||
		(mediaType != "application/json" && !strings.HasSuffix(mediaType, "+json")) ||
		(req.Header.Get("Content-Encoding") != "" && !strings.EqualFold(req.Header.Get("Content-Encoding"), "identity")) ||
		(req.ContentLength > 0 && req.ContentLength < 1024) {
		return nil, nil
	}

	encoder, _ := gatewayRequestEncoders.Get().(*zstd.Encoder)
	if encoder == nil {
		var err error
		encoder, err = zstd.NewWriter(nil, zstd.WithEncoderConcurrency(1), zstd.WithEncoderLevel(zstd.SpeedFastest))
		if err != nil {
			return nil, err
		}
	}
	defer func() {
		encoder.Reset(io.Discard)
		gatewayRequestEncoders.Put(encoder)
	}()
	var compressed bytes.Buffer
	encoder.Reset(&compressed)
	_, errCopy := io.Copy(encoder, req.Body)
	errClose := req.Body.Close()
	errEncoder := encoder.Close()
	if errCopy != nil {
		return nil, errCopy
	}
	if errClose != nil {
		return nil, errClose
	}
	if errEncoder != nil {
		return nil, errEncoder
	}
	storage, err := common.CreateBodyStorage(compressed.Bytes())
	if err != nil {
		return nil, err
	}
	body, err := storage.NewReader()
	if err != nil {
		_ = storage.Close()
		return nil, err
	}
	req.Body = body
	req.GetBody = storage.NewReader
	req.ContentLength = storage.Size()
	req.TransferEncoding = nil
	req.Header.Del("Content-Length")
	req.Header.Set("Content-Encoding", "zstd")
	return storage, nil
}

// gatewayGzipBody defers reading the gzip header until the relay consumes the
// body, so upstream response headers and streaming cancellation remain prompt.
type gatewayGzipBody struct {
	source io.ReadCloser
	once   sync.Once
	reader *gzip.Reader
	err    error
}

func (b *gatewayGzipBody) Read(p []byte) (int, error) {
	b.once.Do(func() { b.reader, b.err = gzip.NewReader(b.source) })
	if b.err != nil {
		return 0, b.err
	}
	return b.reader.Read(p)
}

func (b *gatewayGzipBody) Close() error {
	return b.source.Close()
}
