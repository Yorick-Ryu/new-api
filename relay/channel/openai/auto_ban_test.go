package openai

import (
	"net/http"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/auto_ban"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// These tests exercise real relay entry points: HTTP 200 can carry an upstream
// failure. Both successful and failing responses must use cached ban settings.
func TestAutoBanOpenAIErrorBranches(t *testing.T) {
	const cyber = `{"error":{"type":"invalid_request_error","code":"cyber_policy","message":"blocked"}}`
	const event = `{"type":"error","error":{"code":"cyber_policy","message":"blocked"}}`
	const failed = `{"type":"response.failed","response":{"status":"failed","error":{"code":"cyber_policy","message":"blocked"}}}`
	const completed = `{"type":"response.completed","response":{"status":"completed","error":null,"output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}`
	type handler func(*gin.Context, *relaycommon.RelayInfo, *http.Response) (*dto.Usage, *types.NewAPIError)
	for _, tc := range []struct {
		name, body     string
		stream, banned bool
		handle         handler
	}{
		{"chat JSON error", cyber, false, true, OpenaiHandler},
		{"responses JSON error", cyber, false, true, OaiResponsesHandler},
		{"image JSON error", cyber, false, true, OpenaiImageHandler},
		{"image JSON presented as stream", cyber, false, true, openaiImageJSONAsStreamHandler},
		{"chat converted to responses", cyber, false, true, OaiChatToResponsesHandler},
		{"responses converted to chat", cyber, false, true, OaiResponsesToChatHandler},
		{"chat stream error", event, true, true, OaiStreamHandler},
		{"responses stream error", event, true, true, OaiResponsesStreamHandler},
		{"responses failed stream", failed, true, true, OaiResponsesStreamHandler},
		{"image stream error", event, true, true, OpenaiImageStreamHandler},
		{"converted responses stream error", failed, true, true, OaiResponsesToChatStreamHandler},
		{"buffered responses stream error", event, true, true, OaiResponsesToChatBufferedStreamHandler},
		{"converted chat stream error", cyber, true, true, OaiChatToResponsesStreamHandler},
		{"successful chat quotes error", `{"choices":[{"message":{"content":"cyber_policy Your request was blocked by the content safety policy"}}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2},"error":null}`, false, false, OpenaiHandler},
		{"successful responses error null", `{"status":"completed","error":null,"output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}`, false, false, OaiResponsesHandler},
		{"successful image error null", `{"data":[{"b64_json":"image"}],"error":null}`, false, false, OpenaiImageHandler},
		{"successful completed event", completed, true, false, OaiResponsesStreamHandler},
		{"normal text is not an error event", `{"type":"response.output_text.delta","delta":"cyber_policy","error":{"code":"cyber_policy"}}` + "\n\ndata: " + completed, true, false, OaiResponsesStreamHandler},
		{"refusal is not an error event", `{"type":"response.refusal.delta","delta":"flagged for possible cybersecurity risk"}`, true, false, OaiResponsesStreamHandler},
		{"successful image stream error null", `{"type":"image_generation.completed","b64_json":"image","error":null}`, true, false, OpenaiImageStreamHandler},
	} {
		t.Run(tc.name, func(t *testing.T) {
			previous := auto_ban.CurrentSnapshot()
			t.Cleanup(func() { auto_ban.PublishSnapshot(previous) })
			oldDB, oldRedis, oldTimeout := model.DB, common.RedisEnabled, constant.StreamingTimeout
			db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			model.DB, common.RedisEnabled, constant.StreamingTimeout = db, false, 30
			t.Cleanup(func() {
				model.DB, common.RedisEnabled, constant.StreamingTimeout = oldDB, oldRedis, oldTimeout
				_ = sqlDB.Close()
			})
			require.NoError(t, db.AutoMigrate(&model.User{}, &model.Option{}, &model.AutoBanEvent{}))
			user := model.User{Username: "relay-test", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1}
			require.NoError(t, db.Create(&user).Error)
			settings := auto_ban.Defaults()
			settings.Mode = "ban"
			_, err = model.SaveAutoBanSettings(settings)
			require.NoError(t, err)
			var settingsReads atomic.Int64
			require.NoError(t, db.Callback().Query().Before("gorm:query").Register("test:settings_reads", func(tx *gorm.DB) {
				if tx.Statement.Table == "options" {
					settingsReads.Add(1)
				}
			}))
			body := tc.body
			if tc.stream {
				body = "data: " + body + "\n\ndata: [DONE]\n\n"
			}
			c, recorder, resp, info := newResponsesChatTestContext(t, body, tc.stream)
			c.Set("id", user.Id)
			_, apiErr := tc.handle(c, info, resp)
			assert.Zero(t, settingsReads.Load(), "relay responses must use cached automatic-ban rules, including errors")
			require.NoError(t, db.First(&user, user.Id).Error)
			events, err := model.ListAutoBanEvents(0, 30)
			require.NoError(t, err)
			if tc.banned {
				assert.Equal(t, common.UserStatusDisabled, user.Status)
				require.Len(t, events, 1)
				assert.Equal(t, 200, events[0].HTTPStatus)
				assert.Contains(t, events[0].Rules, "cybersecurity")
			} else {
				assert.Nil(t, apiErr)
				assert.Equal(t, common.UserStatusEnabled, user.Status)
				assert.Empty(t, events)
				assert.NotEmpty(t, recorder.Body.String())
			}
		})
	}
}
