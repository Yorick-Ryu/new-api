package controller

import (
	"context"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/perf_metrics_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/samber/hot"
)

var serviceStatusCache = hot.NewHotCache[string, perfmetrics.StatusResult](hot.LRU, 3).
	WithTTL(30 * time.Second).Build()
var serviceStatusQueryMu sync.Mutex

func GetServiceStatus(c *gin.Context) {
	hours, err := strconv.Atoi(c.DefaultQuery("hours", "24"))
	if err != nil || (hours != 24 && hours != 72 && hours != 168) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "hours must be 24, 72, or 168"})
		return
	}
	user, err := model.GetUserCache(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	key := strconv.Itoa(hours) + ":" + strconv.FormatInt(perf_metrics_setting.GetBucketSeconds(), 10)
	serviceStatusQueryMu.Lock()
	result, found, _ := serviceStatusCache.Get(key)
	if !found {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
		result, err = perfmetrics.QueryServiceStatus(ctx, hours)
		cancel()
		if err == nil {
			serviceStatusCache.Set(key, result)
		}
	}
	serviceStatusQueryMu.Unlock()
	if err != nil {
		common.SysError("service status query failed: " + err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Failed to load service status"})
		return
	}

	usable := service.GetUserUsableGroups(user.Group)
	for group := range usable {
		if !ratio_setting.ContainsGroupRatio(group) {
			delete(usable, group)
		}
	}
	// Filter after reading the shared metrics cache, so permissions are evaluated
	// on every request and no user's filtered response is reused for another.
	result = buildVisibleServiceStatus(result, usable, model.GetPricing(), model.GetVendors(), model.GetModelDisplayOrder())
	result = applyServiceStatusSettings(result, model.GetServiceStatusSettings())
	c.Header("Cache-Control", "private, no-store")
	c.JSON(http.StatusOK, gin.H{
		"success": true, "data": result,
		"enabled": perf_metrics_setting.GetSetting().Enabled,
	})
}

func buildVisibleServiceStatus(result perfmetrics.StatusResult, usable map[string]string, pricing []model.Pricing, vendors []model.PricingVendor, displayOrder []string) perfmetrics.StatusResult {
	groups := map[string]map[string]perfmetrics.StatusModel{}
	for _, group := range result.Groups {
		if _, allowed := usable[group.Group]; !allowed {
			continue
		}
		groups[group.Group] = map[string]perfmetrics.StatusModel{}
		for _, item := range group.Models {
			groups[group.Group][item.ModelName] = item
		}
	}
	vendorIcons := map[int]string{}
	for _, vendor := range vendors {
		vendorIcons[vendor.ID] = vendor.Icon
	}
	icons := map[string]string{}
	for _, item := range pricing {
		icon := item.Icon
		if icon == "" {
			icon = vendorIcons[item.VendorID]
		}
		icons[item.ModelName] = icon
		for group := range usable {
			if !common.StringsContains(item.EnableGroup, group) && !common.StringsContains(item.EnableGroup, "all") {
				continue
			}
			if groups[group] == nil {
				groups[group] = map[string]perfmetrics.StatusModel{}
			}
			if _, exists := groups[group][item.ModelName]; !exists {
				groups[group][item.ModelName] = perfmetrics.StatusModel{ModelName: item.ModelName, Series: []perfmetrics.StatusPoint{}}
			}
		}
	}
	order := map[string]int{}
	for index, name := range displayOrder {
		order[name] = index + 1
	}
	result.Groups = make([]perfmetrics.StatusGroup, 0, len(groups))
	for group, models := range groups {
		entry := perfmetrics.StatusGroup{Group: group, Description: strings.TrimSpace(usable[group]), Models: make([]perfmetrics.StatusModel, 0, len(models))}
		for name, item := range models {
			item.Icon = icons[name]
			entry.Models = append(entry.Models, item)
		}
		sort.Slice(entry.Models, func(i, j int) bool {
			a, b := entry.Models[i].ModelName, entry.Models[j].ModelName
			if order[a] != order[b] {
				if order[a] == 0 {
					return false
				}
				if order[b] == 0 {
					return true
				}
				return order[a] < order[b]
			}
			return serviceStatusModelLess(a, b)
		})
		result.Groups = append(result.Groups, entry)
	}
	sort.Slice(result.Groups, func(i, j int) bool { return result.Groups[i].Group < result.Groups[j].Group })
	return result
}

// Keep model families together alphabetically, with numeric version segments
// descending: gpt-6, gpt-5.10, gpt-5.9. Compare digit strings without overflow.
func serviceStatusModelLess(a, b string) bool {
	left, right := strings.ToLower(a), strings.ToLower(b)
	for i, j := 0, 0; ; {
		if i == len(left) || j == len(right) {
			if i == len(left) && j == len(right) {
				return a < b
			}
			return j == len(right)
		}
		if left[i] >= '0' && left[i] <= '9' && right[j] >= '0' && right[j] <= '9' {
			startI, startJ := i, j
			for i < len(left) && left[i] >= '0' && left[i] <= '9' {
				i++
			}
			for j < len(right) && right[j] >= '0' && right[j] <= '9' {
				j++
			}
			numberA := strings.TrimLeft(left[startI:i], "0")
			numberB := strings.TrimLeft(right[startJ:j], "0")
			if len(numberA) != len(numberB) {
				return len(numberA) > len(numberB)
			}
			if numberA != numberB {
				return numberA > numberB
			}
			continue
		}
		if left[i] != right[j] {
			return left[i] < right[j]
		}
		i++
		j++
	}
}
