package service

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRelayResponseHeaderTimeout(t *testing.T) {
	previous := common.RelayResponseHeaderTimeout
	common.RelayResponseHeaderTimeout = 1
	t.Cleanup(func() { common.RelayResponseHeaderTimeout = previous })

	t.Run("unresponsive headers time out", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			<-r.Context().Done()
		}))
		defer server.Close()
		transport := newRelayHTTPTransport()
		defer transport.CloseIdleConnections()
		client := &http.Client{Transport: transport}
		_, err := client.Get(server.URL)
		require.Error(t, err)
		var timeout net.Error
		require.ErrorAs(t, err, &timeout)
		assert.True(t, timeout.Timeout())
		assert.Contains(t, err.Error(), "timeout awaiting response headers")
	})

	t.Run("body remains readable after header deadline", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/event-stream")
			w.WriteHeader(http.StatusOK)
			w.(http.Flusher).Flush()
			// Cross the configured header deadline after headers have arrived.
			timer := time.NewTimer(1200 * time.Millisecond)
			defer timer.Stop()
			select {
			case <-timer.C:
				_, _ = io.WriteString(w, "data: completed\n\n")
			case <-r.Context().Done():
			}
		}))
		defer server.Close()
		transport := newRelayHTTPTransport()
		defer transport.CloseIdleConnections()
		client := &http.Client{Transport: transport, Timeout: 5 * time.Second}
		response, err := client.Get(server.URL)
		require.NoError(t, err)
		defer response.Body.Close()
		body, err := io.ReadAll(response.Body)
		require.NoError(t, err)
		assert.Equal(t, "data: completed\n\n", string(body))
	})
}
