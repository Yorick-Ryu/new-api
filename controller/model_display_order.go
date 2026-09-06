package controller

import (
	"net/http"
	"sort"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetModelDisplayOrder(c *gin.Context) {
	names := model.GetModelDisplayOrder()
	seen := make(map[string]bool, len(names))
	for _, name := range names {
		seen[name] = true
	}
	remaining := []string{}
	for _, item := range model.GetPricing() {
		if !seen[item.ModelName] {
			remaining = append(remaining, item.ModelName)
			seen[item.ModelName] = true
		}
	}
	sort.Strings(remaining)
	// Retain temporarily unavailable models so disabling a channel does not erase its order.
	names = append(names, remaining...)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": names})
}

func UpdateModelDisplayOrder(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 3<<20)
	var request struct {
		Names []string `json:"model_names"`
	}
	if err := common.DecodeJson(c.Request.Body, &request); err != nil || request.Names == nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid model display order"})
		return
	}
	raw, err := common.Marshal(request.Names)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if _, err = model.ParseModelDisplayOrder(string(raw)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid model display order"})
		return
	}
	if err = model.UpdateOptionsBulk(map[string]string{model.ModelDisplayOrderOptionKey: string(raw)}); err != nil {
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}
