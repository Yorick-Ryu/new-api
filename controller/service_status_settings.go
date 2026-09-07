package controller

import (
	"context"
	"net/http"
	"sort"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
)

// Apply after user permissions and after the shared metrics cache. A display
// override can only narrow visibility; it can never grant access to a group.
func applyServiceStatusSettings(result perfmetrics.StatusResult, settings model.ServiceStatusSettings) perfmetrics.StatusResult {
	rules := map[string]model.ServiceStatusGroupSetting{}
	ranks := map[string]int{}
	for i, group := range settings.Groups {
		rules[group.Group] = group
		ranks[group.Group] = i + 1
	}
	groups := make([]perfmetrics.StatusGroup, 0, len(result.Groups))
	for _, group := range result.Groups {
		rule, configured := rules[group.Group]
		if configured && rule.Hidden {
			continue
		}
		modelRanks := map[string]int{}
		hidden := map[string]bool{}
		for i, entry := range rule.Models {
			modelRanks[entry.Model] = i + 1
			hidden[entry.Model] = entry.Hidden
		}
		models := make([]perfmetrics.StatusModel, 0, len(group.Models))
		for _, entry := range group.Models {
			if !hidden[entry.ModelName] {
				models = append(models, entry)
			}
		}
		sort.SliceStable(models, func(i, j int) bool {
			return serviceStatusRankLess(modelRanks[models[i].ModelName], modelRanks[models[j].ModelName])
		})
		if len(models) == 0 {
			continue
		}
		group.Models = models
		groups = append(groups, group)
	}
	sort.SliceStable(groups, func(i, j int) bool { return serviceStatusRankLess(ranks[groups[i].Group], ranks[groups[j].Group]) })
	result.Groups = groups
	return result
}

func serviceStatusRankLess(a, b int) bool {
	if a == 0 {
		return false
	}
	if b == 0 {
		return true
	}
	return a < b
}

type serviceStatusManagedGroup struct {
	model.ServiceStatusGroupSetting
	Description string `json:"description"`
}

func GetServiceStatusSettings(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()
	pairs, err := model.GetServiceStatusModelPairs(ctx, time.Now().Add(-7*24*time.Hour).Unix())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	usable := setting.GetUserUsableGroupsCopy()
	for group := range ratio_setting.GetGroupRatioCopy() {
		if _, ok := usable[group]; !ok {
			usable[group] = group
		}
	}
	raw := perfmetrics.StatusResult{}
	grouped := map[string][]perfmetrics.StatusModel{}
	for _, pair := range pairs {
		grouped[pair.Group] = append(grouped[pair.Group], perfmetrics.StatusModel{ModelName: pair.ModelName})
	}
	for group, models := range grouped {
		raw.Groups = append(raw.Groups, perfmetrics.StatusGroup{Group: group, Models: models})
	}
	catalog := buildVisibleServiceStatus(raw, usable, model.GetPricing(), model.GetVendors(), model.GetModelDisplayOrder())
	settings := model.GetServiceStatusSettings()
	groups := make([]serviceStatusManagedGroup, 0)
	indexes := map[string]int{}
	// Preserve configured but currently inactive entries, including their order.
	for _, group := range settings.Groups {
		indexes[group.Group] = len(groups)
		groups = append(groups, serviceStatusManagedGroup{ServiceStatusGroupSetting: group, Description: usable[group.Group]})
	}
	for _, group := range catalog.Groups {
		index, found := indexes[group.Group]
		if !found {
			index = len(groups)
			indexes[group.Group] = index
			groups = append(groups, serviceStatusManagedGroup{ServiceStatusGroupSetting: model.ServiceStatusGroupSetting{Group: group.Group, Models: []model.ServiceStatusModelSetting{}}, Description: group.Description})
		}
		existing := map[string]bool{}
		for _, entry := range groups[index].Models {
			existing[entry.Model] = true
		}
		for _, entry := range group.Models {
			if !existing[entry.ModelName] {
				groups[index].Models = append(groups[index].Models, model.ServiceStatusModelSetting{Model: entry.ModelName})
			}
		}
	}
	// Include empty configured groups so admins can choose visibility in advance.
	names := make([]string, 0, len(usable))
	for group := range usable {
		names = append(names, group)
	}
	sort.Strings(names)
	for _, group := range names {
		if _, found := indexes[group]; !found {
			groups = append(groups, serviceStatusManagedGroup{ServiceStatusGroupSetting: model.ServiceStatusGroupSetting{Group: group, Models: []model.ServiceStatusModelSetting{}}, Description: usable[group]})
		}
	}
	c.Header("Cache-Control", "private, no-store")
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"groups": groups}})
}

func UpdateServiceStatusSettings(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2*1024*1024)
	var settings model.ServiceStatusSettings
	if err := common.DecodeJson(c.Request.Body, &settings); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid service status settings"})
		return
	}
	encoded, err := common.Marshal(settings)
	if err == nil {
		_, err = model.ParseServiceStatusSettings(string(encoded))
	}
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid service status settings"})
		return
	}
	if err = model.UpdateOptionsBulk(map[string]string{model.ServiceStatusSettingsOptionKey: string(encoded)}); err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
