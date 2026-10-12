package controller

import (
	"context"
	"slices"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
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
	connections, err := model.GetModelConnections()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	groupModels := make(map[string][]string)
	for group := range ratio_setting.GetGroupRatioCopy() {
		groupModels[group] = []string{}
	}
	for _, connection := range connections {
		groupModels[connection.Group] = append(groupModels[connection.Group], connection.Model)
	}
	for group, models := range groupModels {
		slices.Sort(models)
		groupModels[group] = slices.Compact(models)
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
	common.ApiSuccess(c, gin.H{"profiles": profiles, "fallback": fallback, "models": names, "group_models": groupModels, "official_sync": syncInfo})
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
