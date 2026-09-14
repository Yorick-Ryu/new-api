package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestRelayEmptyImageRejectedBeforeBillingAndCallLogs(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Log{}, &model.User{}, &model.Token{}))
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousErrorLogEnabled := constant.ErrorLogEnabled
	model.DB, model.LOG_DB = db, db
	constant.ErrorLogEnabled = true
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		constant.ErrorLogEnabled = previousErrorLogEnabled
		sqlDB, closeErr := db.DB()
		require.NoError(t, closeErr)
		require.NoError(t, sqlDB.Close())
	})
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "image-validation-test", Quota: 10000}).Error)
	require.NoError(t, db.Create(&model.Token{Id: 1, UserId: 1, RemainQuota: 10000}).Error)

	tests := []struct {
		path, body, param string
		format            types.RelayFormat
	}{
		{
			path: "/v1/chat/completions", format: types.RelayFormatOpenAI,
			body:  `{"model":"gpt-test","messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":"data:image/png;base64,"}}]}]}`,
			param: "messages[0].content[0].image_url.url",
		},
		{
			path: "/v1/responses", format: types.RelayFormatOpenAIResponses,
			body:  `{"model":"gpt-test","input":[{"role":"user","content":[{"type":"input_image","image_url":"data:image/png;base64,"}]}]}`,
			param: "input[0].content[0].image_url",
		},
		{
			path: "/v1/responses/compact", format: types.RelayFormatOpenAIResponsesCompaction,
			body:  `{"model":"gpt-test","input":[{"role":"user","content":[{"type":"input_image","image_url":"data:image/png;base64,"}]}]}`,
			param: "input[0].content[0].image_url",
		},
	}
	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPost, tt.path, strings.NewReader(tt.body))
			c.Request.Header.Set("Content-Type", "application/json")
			c.Set("id", 1)
			c.Set("token_id", 1)
			c.Set("token_name", "image-validation-test")
			c.Set("group", "default")
			c.Set("original_model", "gpt-test")
			// No channel exists: validation must finish before upstream selection.
			Relay(c, tt.format)
			require.Equal(t, http.StatusBadRequest, recorder.Code)
			var response struct {
				Error types.OpenAIError `json:"error"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			assert.Equal(t, "invalid_image_url", response.Error.Code)
			assert.Equal(t, tt.param, response.Error.Param)
			assert.Empty(t, c.GetStringSlice("use_channel"))
			var logCount int64
			require.NoError(t, db.Model(&model.Log{}).Count(&logCount).Error)
			assert.Zero(t, logCount, "entry validation must not create upstream error or consumption logs")
			var user model.User
			require.NoError(t, db.First(&user, 1).Error)
			assert.Equal(t, 10000, user.Quota)
			assert.Zero(t, user.UsedQuota)
			var token model.Token
			require.NoError(t, db.First(&token, 1).Error)
			assert.Equal(t, 10000, token.RemainQuota)
			assert.Zero(t, token.UsedQuota)
		})
	}
}
