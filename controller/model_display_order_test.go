package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestModelDisplayOrderSaveAndRejectInvalidChanges(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Option{}))
	oldDB := model.DB
	model.DB = db
	common.OptionMapRWMutex.Lock()
	oldMap := common.OptionMap
	common.OptionMap = map[string]string{}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		model.DB = oldDB
		common.OptionMapRWMutex.Lock()
		common.OptionMap = oldMap
		common.OptionMapRWMutex.Unlock()
		sqlDB, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
	})
	router := gin.New()
	router.PUT("/order", UpdateModelDisplayOrder)
	for _, tc := range []struct {
		body     string
		status   int
		expected []string
	}{
		{`{"model_names":["z","a"]}`, http.StatusOK, []string{"z", "a"}},
		{`{"model_names":["a","a"]}`, http.StatusBadRequest, []string{"z", "a"}},
		{`{"model_names":null}`, http.StatusBadRequest, []string{"z", "a"}},
		{`{}`, http.StatusBadRequest, []string{"z", "a"}},
		{`{"model_names":[""]}`, http.StatusBadRequest, []string{"z", "a"}},
		{`{"model_names":[]}`, http.StatusOK, []string{}},
	} {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPut, "/order", strings.NewReader(tc.body))
		request.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(recorder, request)
		require.Equal(t, tc.status, recorder.Code)
		assert.Equal(t, tc.expected, model.GetModelDisplayOrder())
		var option model.Option
		require.NoError(t, db.First(&option, "key = ?", model.ModelDisplayOrderOptionKey).Error)
		persisted, err := model.ParseModelDisplayOrder(option.Value)
		require.NoError(t, err)
		assert.Equal(t, tc.expected, persisted)
	}
	require.NoError(t, db.Migrator().DropTable(&model.Option{}))
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPut, "/order", strings.NewReader(`{"model_names":["not-saved"]}`)))
	assert.Contains(t, recorder.Body.String(), `"success":false`)
	assert.Empty(t, model.GetModelDisplayOrder(), "failed writes must not change the active order")
}
