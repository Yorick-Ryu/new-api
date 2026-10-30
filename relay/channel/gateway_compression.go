package channel

import (
	"compress/gzip"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/klauspost/compress/zstd"
)

var gatewayRequestEncoders sync.Pool

// prepareCompressedGatewayRequest runs after body conversion and header overrides.
// It changes only transport encoding; retries replay the same compressed bytes.
func prepareCompressedGatewayRequest(req *http.Request) (io.Closer, error) {
	acceptEncoding := strings.Join(req.Header.Values("Accept-Encoding"), ",")
	if strings.TrimSpace(acceptEncoding) == "" {
		req.Header.Set("Accept-Encoding", "gzip")
	} else {
		// Header overrides must not advertise a response decoder we do not have.
		// Validate every field value, including overrides on uncompressed uploads.
		for token := range strings.SplitSeq(acceptEncoding, ",") {
			if strings.TrimSpace(token) == "" {
				continue
			}
			encoding, params, err := mime.ParseMediaType(token)
			if err != nil || (encoding != "gzip" && encoding != "identity") {
				return nil, errors.New("HTTP compression Accept-Encoding must contain only gzip or identity; remove unsupported encodings and wildcards from channel header overrides")
			}
			for name, value := range params {
				quality, errQuality := strconv.ParseFloat(value, 64)
				if name != "q" || errQuality != nil || !(quality >= 0 && quality <= 1) {
					return nil, errors.New("HTTP compression Accept-Encoding requires a valid q value between 0 and 1")
				}
			}
		}
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
		(req.Header.Get("Content-Encoding") != "" && !strings.EqualFold(req.Header.Get("Content-Encoding"), "identity")) {
		return nil, nil
	}

	encoder, _ := gatewayRequestEncoders.Get().(*zstd.Encoder)
	if encoder == nil {
		var err error
		encoder, err = zstd.NewWriter(nil, zstd.WithEncoderConcurrency(1), zstd.WithEncoderLevel(zstd.EncoderLevelFromZstd(3)))
		if err != nil {
			return nil, err
		}
	}
	defer func() {
		encoder.Reset(io.Discard)
		gatewayRequestEncoders.Put(encoder)
	}()
	var compressed common.BodyStorageWriter
	defer compressed.Close()
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
	storage, err := compressed.Finish()
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
