package wsmanager

import (
	"net"
	"sync"
	"time"
)

// UploadConn gives an in-progress WebSocket message a bounded, progress-based
// read deadline. Track wire reads, not decompressed output: a decompressor may
// buffer input while the peer's Pong is queued behind a large data frame.
type UploadConn struct {
	net.Conn
	mu           sync.Mutex
	readDeadline time.Time
	started      time.Time
	progress     time.Time
	stall        time.Duration
	limit        time.Duration
}

func (c *UploadConn) BeginUpload(stall, limit time.Duration) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.started = time.Now()
	c.progress = c.started
	c.stall, c.limit = stall, limit
	return c.Conn.SetReadDeadline(c.uploadDeadline())
}

// EndUpload restores the session deadline. The caller must refresh liveness
// after a completed message before starting its next read.
func (c *UploadConn) EndUpload() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.started = time.Time{}
	return c.Conn.SetReadDeadline(c.readDeadline)
}

func (c *UploadConn) SetReadDeadline(deadline time.Time) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.readDeadline = deadline
	if !c.started.IsZero() {
		deadline = c.uploadDeadline()
	}
	return c.Conn.SetReadDeadline(deadline)
}

func (c *UploadConn) Read(p []byte) (int, error) {
	n, err := c.Conn.Read(p)
	if n > 0 {
		c.mu.Lock()
		if !c.started.IsZero() {
			c.progress = time.Now()
			if deadlineErr := c.Conn.SetReadDeadline(c.uploadDeadline()); err == nil {
				err = deadlineErr
			}
		}
		c.mu.Unlock()
	}
	return n, err
}

// Caller holds mu. Incoming traffic and session deadline updates cannot extend
// the absolute cap, even if the peer never finishes its message.
func (c *UploadConn) uploadDeadline() time.Time {
	a, b := c.progress.Add(c.stall), c.started.Add(c.limit)
	if a.Before(b) {
		return a
	}
	return b
}
