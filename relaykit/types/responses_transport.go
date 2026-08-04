package types

// ResponsesTransport identifies the downstream transport used by the
// Responses API. It lives in relaykit so channel settings can enforce
// transport capabilities without importing the host application.
type ResponsesTransport string

const (
	ResponsesTransportNone      ResponsesTransport = ""
	ResponsesTransportHTTP      ResponsesTransport = "http"
	ResponsesTransportWebSocket ResponsesTransport = "websocket"
)
