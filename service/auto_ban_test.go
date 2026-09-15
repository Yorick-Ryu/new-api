package service

import (
	"errors"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/auto_ban"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestAutoBanUnmatchedErrorsNeedNoDatabase(t *testing.T) {
	previous, previousDB := auto_ban.CurrentSnapshot(), model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	model.DB = db
	t.Cleanup(func() {
		auto_ban.PublishSnapshot(previous)
		model.DB = previousDB
		_ = sqlDB.Close()
	})
	var queries atomic.Int64
	require.NoError(t, db.Callback().Query().Before("gorm:query").Register("test:unavailable_database", func(tx *gorm.DB) {
		queries.Add(1)
		tx.AddError(errors.New("database unavailable"))
	}))
	for _, tc := range []struct{ mode, body string }{
		{"off", `{"error":{"code":"cyber_policy","message":"blocked"}}`},
		{"observe", `{"error":{"code":"invalid_request","message":"missing model"}}`},
		{"ban", `{"error":{"code":"invalid_request","message":"missing model"}}`},
	} {
		t.Run(tc.mode, func(t *testing.T) {
			settings := auto_ban.Defaults()
			settings.Mode = tc.mode
			data, err := common.Marshal(settings)
			require.NoError(t, err)
			snapshot, err := auto_ban.ParseSnapshot(string(data))
			require.NoError(t, err)
			auto_ban.PublishSnapshot(snapshot)
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Set("id", 1)
			assert.False(t, ObserveUpstreamFailure(c, []byte(tc.body), 400))
			assert.False(t, AutoBanEnforced(c))
			assert.Zero(t, queries.Load(), "disabled or unmatched failures must not depend on database availability")
		})
	}
}

func TestAutoBanParseUpstreamFailures(t *testing.T) {
	tests := []struct {
		name, body string
		status     int
		matched    string
	}{
		{"sexual message", `{"error":{"message":"Your request was rejected by the safety system. safety_violations=[sexual]"}}`, 400, "sexual"},
		{"structured sexual", `{"error":{"message":"Your request was rejected by the safety system","safety_violations":["sexual"]}}`, 400, "sexual"},
		{"content safety", `Your request was blocked by the content safety policy.`, 400, "content-safety"},
		{"legacy text", `This request was flagged for possible cybersecurity risk`, 400, "cybersecurity"},
		{"top-level stream error", `{"type":"error","code":"cyber_policy","message":"blocked"}`, 200, "cybersecurity"},
		{"streamed error", `{"type":"error","error":{"code":"cyber_policy","message":"blocked"}}`, 200, "cybersecurity"},
		{"websocket failure", `{"type":"response.failed","response":{"status":"failed","error":{"code":"cyber_policy","message":"blocked"}}}`, 101, "cybersecurity"},
		{"websocket wrapped body", `{"type":"error","status":400,"body":{"error":{"code":"cyber_policy","message":"blocked"}}}`, 101, "cybersecurity"},
		{"response.error", `{"type":"response.error","response":{"error":{"code":"cyber_policy","message":"blocked"}}}`, 200, "cybersecurity"},
		{"both cybersecurity signals match one rule", `{"error":{"code":"cyber_policy","message":"This request was flagged for possible cybersecurity risk"}}`, 400, "cybersecurity"},
		{"ordinary 400", `{"error":{"code":"invalid_request","message":"missing model"}}`, 400, ""},
		{"generated text", `{"type":"response.output_text.delta","delta":"cyber_policy flagged for possible cybersecurity risk","error":{"code":"cyber_policy"}}`, 200, ""},
		{"quoted error in completion", `{"choices":[{"message":{"content":"Your request was blocked by the content safety policy"}}]}`, 200, ""},
		{"normal refusal", `{"type":"response.refusal.delta","delta":"flagged for possible cybersecurity risk"}`, 200, ""},
		{"unrelated violation", `{"error":{"message":"Your request was rejected by the safety system. safety_violations=[violence]"}}`, 400, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e, failed := ParseUpstreamFailure([]byte(tt.body), tt.status)
			matches := auto_ban.Match(auto_ban.Defaults(), e, 0, "")
			if tt.matched == "" {
				assert.Empty(t, matches)
				return
			}
			require.True(t, failed)
			require.Len(t, matches, 1)
			assert.Equal(t, tt.matched, matches[0].ID)
		})
	}
}

func TestAutoBanHTTPFailureBeforeMaskingAndLiveSettings(t *testing.T) {
	previous := auto_ban.CurrentSnapshot()
	t.Cleanup(func() { auto_ban.PublishSnapshot(previous) })
	oldDB, oldRedis := model.DB, common.RedisEnabled
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	common.RedisEnabled = false
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { model.DB = oldDB; common.RedisEnabled = oldRedis; _ = sqlDB.Close() })
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Option{}, &model.AutoBanEvent{}))
	user := model.User{Username: "auto-ban-http", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1}
	require.NoError(t, db.Create(&user).Error)
	s := auto_ban.Defaults()
	s.Mode = "observe"
	s, err = model.SaveAutoBanSettings(s)
	require.NoError(t, err)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set("id", user.Id)
	c.Set("original_model", "chat")
	c.Set("channel_id", 22)
	c.Set(common.RequestIdKey, "request-one")
	body := "This request was flagged for possible cybersecurity risk"
	response := func() *http.Response {
		return &http.Response{StatusCode: 400, Body: io.NopCloser(strings.NewReader(body))}
	}
	apiErr := RelayErrorHandler(c, response(), false)
	assert.NotContains(t, apiErr.Error(), "cybersecurity")
	assert.False(t, AutoBanEnforced(c))
	require.NoError(t, db.First(&user, user.Id).Error)
	assert.Equal(t, common.UserStatusEnabled, user.Status)
	observeVersion := s.Version
	s.Mode = "ban"
	s, err = model.SaveAutoBanSettings(s)
	require.NoError(t, err)
	BeginAutoBanRequest(c)
	RelayErrorHandler(c, response(), false)
	assert.True(t, AutoBanEnforced(c))
	assert.False(t, ShouldRetryRelayError(c, apiErr, 3))
	require.NoError(t, db.First(&user, user.Id).Error)
	assert.Equal(t, common.UserStatusDisabled, user.Status)
	events, err := model.ListAutoBanEvents(0, 30)
	require.NoError(t, err)
	require.Len(t, events, 2)
	assert.Equal(t, "banned", events[0].Action)
	assert.Equal(t, s.Version, events[0].Version)
	assert.Equal(t, "ban", events[0].Mode)
	assert.Equal(t, observeVersion, events[1].Version)
	assert.Equal(t, "observe", events[1].Mode)
	assert.NotContains(t, events[0].ErrorSummary, body)
}
