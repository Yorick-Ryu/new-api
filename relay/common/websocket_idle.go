package common

import (
	"errors"
	"net"
	"time"

	appcommon "github.com/QuantumNous/new-api/common"
)

const (
	WebSocketIdleCloseReason      = "websocket idle timeout"
	WebSocketHeartbeatCloseReason = "websocket heartbeat timeout"
	WebSocketUploadCloseReason    = "websocket upload timeout"
)

// WebSocketIdleTimeoutMinutes 客户端 WebSocket 空闲超时（分钟），0 表示不启用。
var WebSocketIdleTimeoutMinutes = appcommon.GetEnvOrDefault("WEBSOCKET_IDLE_TIMEOUT_MINUTES", 10)

// WebSocketPingIntervalSeconds controls server-to-client heartbeat probes.
// Set either heartbeat value to 0 to disable heartbeat enforcement.
var WebSocketPingIntervalSeconds = appcommon.GetEnvOrDefault("WEBSOCKET_PING_INTERVAL_SECONDS", 30)

// WebSocketPongTimeoutSeconds is the maximum time since the last client Pong.
var WebSocketPongTimeoutSeconds = appcommon.GetEnvOrDefault("WEBSOCKET_PONG_TIMEOUT_SECONDS", 90)

// WebSocketUploadTimeoutSeconds caps a single Responses message upload while
// incoming bytes keep it alive. Zero retains strict Pong deadlines.
var WebSocketUploadTimeoutSeconds = appcommon.GetEnvOrDefault("WEBSOCKET_UPLOAD_TIMEOUT_SECONDS", 900)

func GetWebSocketUploadTimeout() time.Duration {
	return time.Duration(max(0, WebSocketUploadTimeoutSeconds)) * time.Second
}

func GetWebSocketIdleTimeout() time.Duration {
	if WebSocketIdleTimeoutMinutes <= 0 {
		return 0
	}
	return time.Duration(WebSocketIdleTimeoutMinutes) * time.Minute
}

func GetWebSocketPingInterval() time.Duration {
	if WebSocketPingIntervalSeconds <= 0 {
		return 0
	}
	return time.Duration(WebSocketPingIntervalSeconds) * time.Second
}

func GetWebSocketPongTimeout() time.Duration {
	if WebSocketPongTimeoutSeconds <= 0 {
		return 0
	}
	return time.Duration(WebSocketPongTimeoutSeconds) * time.Second
}

func IsWebSocketIdleTimeout(err error) bool {
	var netErr net.Error
	return errors.As(err, &netErr) && netErr.Timeout()
}
