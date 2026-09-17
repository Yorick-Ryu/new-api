package controller

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetBusinessDashboard(c *gin.Context) {
	days, err := strconv.Atoi(c.DefaultQuery("days", "7"))
	offset, offsetErr := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if err != nil || offsetErr != nil || (days != 1 && days != 3 && days != 7 && days != 30 && days != 90) || offset < 0 || offset > 1 || (offset == 1 && days != 1) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "invalid business reporting period"})
		return
	}
	c.Header("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	result, err := model.GetBusinessDashboard(ctx, days, offset, time.Now())
	if err != nil {
		common.SysError("business dashboard query failed: " + err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Failed to load business overview"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}
