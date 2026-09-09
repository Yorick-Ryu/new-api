package controller

import (
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAddTokenReturnsOwnedIDForSetupWithoutDisclosingKey(t *testing.T) {
	user := setupTokenAutoGroupsControllerTest(t)
	request := map[string]any{"name": "CodexBei · Codex", "group": "default", "expired_time": -1, "unlimited_quota": true, "user_id": 999}
	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/token/", request, user.Id)
	AddToken(ctx)
	response := decodeAPIResponse(t, recorder)
	require.True(t, response.Success)
	var data struct {
		ID int `json:"id"`
	}
	require.NoError(t, common.Unmarshal(response.Data, &data))
	require.Positive(t, data.ID)
	var token model.Token
	require.NoError(t, model.DB.First(&token, data.ID).Error)
	assert.Equal(t, user.Id, token.UserId)
	assert.Equal(t, "default", token.Group)
	assert.JSONEq(t, `{"id":`+stringInt(data.ID)+`}`, string(response.Data))
	assert.NotContains(t, recorder.Body.String(), token.Key)

	owner, ownerResponse := newAuthenticatedContext(t, http.MethodPost, "/api/token/"+stringInt(data.ID)+"/key", nil, user.Id)
	owner.Params = gin.Params{{Key: "id", Value: stringInt(data.ID)}}
	GetTokenKey(owner)
	require.True(t, decodeAPIResponse(t, ownerResponse).Success)
	other, otherResponse := newAuthenticatedContext(t, http.MethodPost, "/api/token/"+stringInt(data.ID)+"/key", nil, user.Id+1)
	other.Params = gin.Params{{Key: "id", Value: stringInt(data.ID)}}
	GetTokenKey(other)
	assert.False(t, decodeAPIResponse(t, otherResponse).Success)
	assert.NotContains(t, otherResponse.Body.String(), token.Key)
}
