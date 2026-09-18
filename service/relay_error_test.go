package service

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestShouldRetryRelayErrorSpecificChannelSkipsChannelError(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set("specific_channel_id", "1")
	err := types.NewError(errors.New("channel failed"), types.ErrorCodeChannelNoAvailableKey)

	assert.False(t, ShouldRetryRelayError(c, err, 1), "specific channel channel error should not retry")
}

func TestProcessChannelErrorPersistsResponseModel(t *testing.T) {
	previous := constant.ErrorLogEnabled
	constant.ErrorLogEnabled = true
	t.Cleanup(func() { constant.ErrorLogEnabled = previous })
	user := &model.User{Username: "response-model-log-test"}
	require.NoError(t, model.DB.Create(user).Error)
	t.Cleanup(func() {
		require.NoError(t, model.LOG_DB.Where("user_id = ?", user.Id).Delete(&model.Log{}).Error)
		require.NoError(t, model.DB.Unscoped().Delete(user).Error)
	})
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	c.Set("id", user.Id)
	c.Set("original_model", "requested")
	info := &relaycommon.RelayInfo{OriginModelName: "requested", ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "mapped"}}
	info.ObserveResponseModel("returned")
	apiErr := types.NewOpenAIError(errors.New("upstream stream failed"), types.ErrorCodeBadResponse, http.StatusBadGateway)
	ProcessChannelError(c, types.ChannelError{}, apiErr, info)
	var logs []model.Log
	require.NoError(t, model.LOG_DB.Where("user_id = ? AND type = ?", user.Id, model.LogTypeError).Find(&logs).Error)
	require.Len(t, logs, 1)
	var other struct {
		ResponseModel *relaycommon.ResponseModel `json:"response_model"`
		StatusCode    int                        `json:"status_code"`
	}
	require.NoError(t, common.UnmarshalJsonStr(logs[0].Other, &other))
	assert.Equal(t, info.ResponseModel, other.ResponseModel)
	assert.Equal(t, http.StatusBadGateway, other.StatusCode)
	assert.Equal(t, "requested", logs[0].ModelName)
	assert.Zero(t, logs[0].Quota)
}
