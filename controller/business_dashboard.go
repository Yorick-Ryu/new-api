package controller

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetBusinessDashboard(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	var result *model.BusinessDashboard
	var err error
	startText, hasStart := c.GetQuery("start_timestamp")
	endText, hasEnd := c.GetQuery("end_timestamp")
	if c.Request.URL.Query().Has("start_timestamp") || c.Request.URL.Query().Has("end_timestamp") {
		start, startErr := strconv.ParseInt(startText, 10, 64)
		end, endErr := strconv.ParseInt(endText, 10, 64)
		if !hasStart || !hasEnd || startErr != nil || endErr != nil || c.Request.URL.Query().Has("days") || c.Request.URL.Query().Has("offset") {
			err = model.ErrInvalidBusinessPeriod
		} else {
			result, err = model.GetBusinessDashboardRange(ctx, start, end, time.Now())
		}
	} else {
		days, daysErr := strconv.Atoi(c.DefaultQuery("days", "7"))
		offset, offsetErr := strconv.Atoi(c.DefaultQuery("offset", "0"))
		if daysErr != nil || offsetErr != nil {
			err = model.ErrInvalidBusinessPeriod
		} else {
			result, err = model.GetBusinessDashboard(ctx, days, offset, time.Now())
		}
	}
	if errors.Is(err, model.ErrInvalidBusinessPeriod) {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	if err != nil {
		common.SysError("business dashboard query failed: " + err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Failed to load business overview"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}
