package relay

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/auto_ban"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func setupAutoBanRelayTest(t *testing.T) (*gorm.DB, model.User) {
	t.Helper()
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
	user := model.User{Username: "auto-ban-ws", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1}
	require.NoError(t, db.Create(&user).Error)
	settings := auto_ban.Defaults()
	settings.Mode = "ban"
	_, err = model.SaveAutoBanSettings(settings)
	require.NoError(t, err)
	var settingsReads atomic.Int64
	require.NoError(t, db.Callback().Query().Before("gorm:query").Register("test:auto_ban_settings_reads", func(tx *gorm.DB) {
		if tx.Statement.Table == "options" {
			settingsReads.Add(1)
		}
	}))
	t.Cleanup(func() { assert.Zero(t, settingsReads.Load(), "HTTP and WebSocket failures must use cached rules") })
	return db, user
}

func TestAutoBanWebSocketErrorDisablesAccount(t *testing.T) {
	db, user := setupAutoBanRelayTest(t)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("GET", "/v1/responses", nil)
	c.Set("id", user.Id)
	// A text delta with nested error-looking output must not trigger the detector.
	state := &responsesWSCallState{info: &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}}
	s := &responsesWSSession{c: c, current: state}
	s.observeUpstreamMessage([]byte(`{"type":"response.output_text.delta","delta":"cyber_policy","error":{"code":"cyber_policy"}}`))
	require.NoError(t, db.First(&user, user.Id).Error)
	assert.Equal(t, common.UserStatusEnabled, user.Status)
	// A real terminal error is still forwarded and settled by the existing path.
	finished1, _, _ := s.observeUpstreamMessage([]byte(`{"type":"error","error":{"code":"cyber_policy","message":"blocked"}}`))
	require.True(t, finished1)
	require.NoError(t, db.First(&user, user.Id).Error)
	assert.Equal(t, common.UserStatusDisabled, user.Status)
}

func TestAutoBanWebSocketExistingConnectionContinuesWithoutAccountStatusQueries(t *testing.T) {
	db, user := setupAutoBanRelayTest(t)
	require.NoError(t, db.AutoMigrate(&model.UserSubscription{}, &model.Channel{}))
	oldMemoryCache := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = false
	t.Cleanup(func() { common.MemoryCacheEnabled = oldMemoryCache })
	require.NoError(t, db.Create(&model.Channel{Id: 22, Type: constant.ChannelTypeOpenAI, Status: common.ChannelStatusEnabled, BaseURL: common.GetPointer("http://upstream.test")}).Error)
	originalRatios := ratio_setting.ModelRatio2JSONString()
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"gpt-auto-ban-test":0}`))
	originalFreePreConsume := operation_setting.GetQuotaSetting().EnableFreeModelPreConsume
	operation_setting.GetQuotaSetting().EnableFreeModelPreConsume = false
	originalCountToken := constant.CountToken
	constant.CountToken = false
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(originalRatios))
		operation_setting.GetQuotaSetting().EnableFreeModelPreConsume = originalFreePreConsume
		constant.CountToken = originalCountToken
	})

	upstream, target, cleanup := newTestWebSocketPair(t)
	defer cleanup()
	c := newResponsesWSChannelSelectionContext()
	c.Set("id", user.Id)
	common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeOpenAI)
	common.SetContextKey(c, constant.ContextKeyChannelId, 22)
	common.SetContextKey(c, constant.ContextKeyChannelKey, "synthetic-test-key")
	common.SetContextKey(c, constant.ContextKeyOriginalModel, "gpt-auto-ban-test")
	session := &responsesWSSession{
		c: c, target: target, lockedModel: "gpt-auto-ban-test",
		lockedChannel: &model.Channel{Id: 22, Type: constant.ChannelTypeOpenAI, BaseURL: common.GetPointer("http://upstream.test")},
	}
	create, _, err := normalizeResponsesWSCreateEvent([]byte(`{"type":"response.create","model":"gpt-auto-ban-test","input":"hello"}`))
	require.NoError(t, err)
	require.Nil(t, session.handleResponseCreate(create, ""))
	require.NoError(t, upstream.SetReadDeadline(time.Now().Add(5*time.Second)))
	_, _, err = upstream.ReadMessage()
	require.NoError(t, err)
	finished2, _, _ := session.observeUpstreamMessage([]byte(`{"type":"error","error":{"code":"cyber_policy","message":"blocked"}}`))
	require.True(t, finished2)
	session.markIdle()
	require.NoError(t, db.First(&user, user.Id).Error)
	require.Equal(t, common.UserStatusDisabled, user.Status)

	var userQueries atomic.Int64
	require.NoError(t, db.Callback().Query().Before("gorm:query").Register("test:account_status_queries", func(tx *gorm.DB) {
		if tx.Statement.Table == "users" {
			userQueries.Add(1)
		}
	}))
	// The already authenticated socket remains usable after an automatic ban.
	require.Nil(t, session.handleResponseCreate(create, ""))
	require.NoError(t, upstream.SetReadDeadline(time.Now().Add(5*time.Second)))
	_, body, err := upstream.ReadMessage()
	require.NoError(t, err)
	assert.Contains(t, string(body), `"model":"gpt-auto-ban-test"`)
	assert.Zero(t, userQueries.Load(), "normal turns must not re-query account status")
	assert.False(t, service.AutoBanEnforced(c), "the previous error must not carry into the new turn")
	finished3, _, _ := session.observeUpstreamMessage([]byte(`{"type":"response.completed","response":{"status":"completed"}}`))
	require.True(t, finished3)
}

func TestAutoBanWebSocketSupportedFailureEnvelopes(t *testing.T) {
	for _, tc := range []struct{ name, body, rule string }{
		{"sexual", `{"type":"error","error":{"message":"Your request was rejected by the safety system. safety_violations=[sexual]"}}`, "sexual"},
		{"content safety", `{"type":"error","error":{"message":"Your request was blocked by the content safety policy"}}`, "content-safety"},
		{"cyber message", `{"type":"error","message":"This request was flagged for possible cybersecurity risk"}`, "cybersecurity"},
		{"failed response", `{"type":"response.failed","response":{"status":"failed","error":{"code":"cyber_policy","message":"blocked"}}}`, "cybersecurity"},
		{"wrapped error body", `{"type":"error","status":400,"body":{"error":{"code":"cyber_policy","message":"blocked"}}}`, "cybersecurity"},
		{"failed response.done", `{"type":"response.done","response":{"status":"failed","error":{"code":"cyber_policy","message":"blocked"}}}`, "cybersecurity"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, user := setupAutoBanRelayTest(t)
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("GET", "/v1/responses", nil)
			c.Set("id", user.Id)
			state := &responsesWSCallState{info: &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}}
			s := &responsesWSSession{c: c, current: state}
			finished4, _, _ := s.observeUpstreamMessage([]byte(tc.body))
			assert.True(t, finished4)
			require.NoError(t, db.First(&user, user.Id).Error)
			assert.Equal(t, common.UserStatusDisabled, user.Status)
			events, err := model.ListAutoBanEvents(0, 30)
			require.NoError(t, err)
			require.Len(t, events, 1)
			assert.Contains(t, events[0].Rules, tc.rule)
			assert.Equal(t, http.StatusSwitchingProtocols, events[0].HTTPStatus)
		})
	}
}

func TestAutoBanResponsesUpstreamHTTPFailure(t *testing.T) {
	for _, transport := range []string{"http", "websocket_handshake"} {
		t.Run(transport, func(t *testing.T) {
			db, user := setupAutoBanRelayTest(t)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "/v1/responses", r.URL.Path)
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"error":{"message":"Your request was rejected by the safety system. safety_violations=[sexual]"}}`))
			}))
			defer upstream.Close()
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
			c.Set("id", user.Id)
			common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeOpenAI)
			common.SetContextKey(c, constant.ContextKeyChannelId, 22)
			common.SetContextKey(c, constant.ContextKeyChannelBaseUrl, upstream.URL)
			common.SetContextKey(c, constant.ContextKeyChannelKey, "synthetic-test-key")
			common.SetContextKey(c, constant.ContextKeyOriginalModel, "chat")
			info := relaycommon.GenRelayInfoResponses(c, &dto.OpenAIResponsesRequest{Model: "chat", Input: common.RawMessage(`"hello"`)})
			if transport == "http" {
				service.InitHttpClient()
				apiErr := ResponsesHelper(c, info)
				require.NotNil(t, apiErr)
				assert.Equal(t, http.StatusBadRequest, apiErr.StatusCode)
			} else {
				info.InitChannelMeta(c)
				adaptor := GetAdaptor(info.ApiType)
				adaptor.Init(info)
				conn, apiErr := dialResponsesWebSocketUpstream(c, adaptor, info)
				require.Nil(t, conn)
				require.NotNil(t, apiErr)
				assert.Equal(t, http.StatusBadRequest, apiErr.StatusCode)
			}
			require.NoError(t, db.First(&user, user.Id).Error)
			assert.Equal(t, common.UserStatusDisabled, user.Status)
			assert.True(t, service.AutoBanEnforced(c))
			events, err := model.ListAutoBanEvents(0, 30)
			require.NoError(t, err)
			require.Len(t, events, 1)
			assert.Equal(t, 22, events[0].ChannelID)
			assert.Equal(t, "chat", events[0].Model)
			assert.Equal(t, 400, events[0].HTTPStatus)
		})
	}
}
