package relay

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaychannel "github.com/QuantumNous/new-api/relay/channel"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/auto_ban"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/gorilla/websocket"
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
			setupResponsesWSWorkerTest(t)
			db, user := setupAutoBanRelayTest(t)
			require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Ability{}, &model.UserSubscription{}))
			upgrader := websocket.Upgrader{}
			release := make(chan struct{})
			deltaSent := make(chan struct{})
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				conn, err := upgrader.Upgrade(w, r, nil)
				if !assert.NoError(t, err) {
					return
				}
				defer conn.Close()
				if _, _, err = conn.ReadMessage(); err != nil {
					return
				}
				_ = conn.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.output_text.delta","delta":"cyber_policy","error":{"code":"cyber_policy"}}`))
				close(deltaSent)
				<-release
				_ = conn.WriteMessage(websocket.TextMessage, []byte(tc.body))
			}))
			defer upstream.Close()
			channel := &model.Channel{Id: 4, Name: "auto-ban", Models: "gpt-test", BaseURL: common.GetPointer(upstream.URL)}
			addResponsesWSChannelSelectionTestChannel(t, channel)
			peer, client, cleanup := newTestWebSocketPair(t)
			defer cleanup()
			session, _ := newResponsesWSWorkerFixture(t, client)
			done := submitResponsesWSWorkerFixture(t, session, `{"type":"response.create","model":"gpt-test","input":"hi"}`)
			select {
			case <-deltaSent:
			case <-done:
				event := readResponsesWSTerminal(t, peer, done)
				t.Fatalf("worker rejected fixture before upstream: %v", event)
			case <-time.After(5 * time.Second):
				t.Fatal("upstream never received create")
			}
			require.NoError(t, peer.SetReadDeadline(time.Now().Add(5*time.Second)))
			_, _, err := peer.ReadMessage()
			require.NoError(t, err)
			require.NoError(t, db.First(&user, user.Id).Error)
			assert.Equal(t, common.UserStatusEnabled, user.Status, "content text must not trigger automatic ban")
			close(release)
			readResponsesWSTerminal(t, peer, done)
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
				conn, dialErr := relaychannel.DoWssRequest(adaptor, c, info, nil)
				apiErr := types.NewError(dialErr, types.ErrorCodeDoRequestFailed)
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
