package controller

import (
	"context"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

var codexOfficialSyncMutex sync.Mutex

func GetCodexModelProfileDefaults(c *gin.Context) {
	profiles, fallback, err := service.GetCodexModelProfileDefaults()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	metadata, _, err := model.SearchModelsWithChannels("", "", "", "", 0, -1)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	names := make([]string, 0, len(metadata))
	for _, entry := range metadata {
		names = append(names, entry.ModelName)
	}
	snapshot, err := service.GetCodexOfficialSnapshot()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	var syncInfo *service.CodexOfficialSyncInfo
	if snapshot != nil {
		syncInfo = &snapshot.CodexOfficialSyncInfo
	}
	common.ApiSuccess(c, gin.H{"profiles": profiles, "fallback": fallback, "models": names, "official_sync": syncInfo})
}

func SyncOfficialCodexModelProfiles(c *gin.Context) {
	codexOfficialSyncMutex.Lock()
	defer codexOfficialSyncMutex.Unlock()
	ctx, cancel := context.WithTimeout(c.Request.Context(), 40*time.Second)
	defer cancel()
	snapshot, err := service.FetchOfficialCodexModelProfiles(ctx)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	encoded, err := common.Marshal(snapshot)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.UpdateOptionsBulk(map[string]string{service.CodexOfficialModelProfilesOptionKey: string(encoded)}); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "codex.profiles.sync", map[string]any{
		"revision": snapshot.Revision, "model_count": snapshot.ModelCount,
	})
	common.ApiSuccess(c, snapshot.CodexOfficialSyncInfo)
}
