package service

import (
	"fmt"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/auto_ban"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Measures only the additional branch on already decoded Responses/WS frames.
// JSON parsing belongs to the existing relay and is not repeated for auto-ban.
func BenchmarkAutoBanResponsesEventGate(b *testing.B) {
	for _, event := range []dto.ResponsesStreamResponse{
		{Type: "response.output_text.delta", Delta: "cyber_policy"},
		{Type: "response.completed", Response: &dto.OpenAIResponsesResponse{}},
		{Type: "response.image_generation_call.partial_image"},
	} {
		b.Run(event.Type, func(b *testing.B) {
			b.ReportAllocs()
			for i := 0; i < b.N; i++ {
				if IsResponsesFailure(&event) {
					b.Fatal("successful event was treated as failure")
				}
			}
		})
	}
}

// SQLite timings exclude any production database/network latency. These cases
// isolate configuration reads on ordinary upstream errors that do not ban users.
func BenchmarkAutoBanUnmatchedUpstreamError(b *testing.B) {
	oldDB, oldRedis, oldMode := model.DB, common.RedisEnabled, gin.Mode()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(b, err)
	sqlDB, err := db.DB()
	require.NoError(b, err)
	sqlDB.SetMaxOpenConns(1)
	model.DB = db
	common.RedisEnabled = false
	gin.SetMode(gin.TestMode)
	b.Cleanup(func() { model.DB = oldDB; common.RedisEnabled = oldRedis; gin.SetMode(oldMode); _ = sqlDB.Close() })
	require.NoError(b, db.AutoMigrate(&model.Option{}))
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set("id", 1)
	body := []byte(`{"error":{"code":"invalid_request","message":"Invalid argument: the requested model is not available"}}`)
	for _, tc := range []struct {
		mode  string
		rules int
	}{{"off", 3}, {"observe", 3}, {"observe", 64}} {
		b.Run(fmt.Sprintf("%s_%d_rules", tc.mode, tc.rules), func(b *testing.B) {
			s := auto_ban.Defaults()
			s.Mode = tc.mode
			templates := s.Rules
			s.Rules = nil
			for i := 0; i < tc.rules; i++ {
				r := templates[i%len(templates)]
				r.ID = fmt.Sprint("rule-", i)
				s.Rules = append(s.Rules, r)
			}
			data, err := common.Marshal(s)
			require.NoError(b, err)
			require.NoError(b, db.Save(&model.Option{Key: auto_ban.OptionKey, Value: string(data)}).Error)
			require.False(b, ObserveUpstreamFailure(c, body, 400))
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				ObserveUpstreamFailure(c, body, 400)
			}
		})
	}
}
