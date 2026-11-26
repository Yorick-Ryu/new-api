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
	"github.com/samber/hot"
	"golang.org/x/sync/singleflight"
)

type businessDashboardCacheKey struct {
	Day, Start, End int64
	Days, Offset    int
}

func (k businessDashboardCacheKey) singleflightKey() string {
	return strconv.FormatInt(k.Day, 10) + ":" +
		strconv.FormatInt(k.Start, 10) + ":" +
		strconv.FormatInt(k.End, 10) + ":" +
		strconv.Itoa(k.Days) + ":" +
		strconv.Itoa(k.Offset)
}

type businessDashboardCacheEntry struct {
	Result    *model.BusinessDashboard
	ExpiresAt time.Time
}

// This admin-only aggregate is shared across admins, never cached by a CDN.
// Bound custom-range entries as well as freshness; midnight gets a new key.
var (
	businessDashboardCache  = hot.NewHotCache[businessDashboardCacheKey, businessDashboardCacheEntry](hot.LRU, 64).Build()
	businessDashboardFlight singleflight.Group
)

func GetBusinessDashboard(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	now := time.Now()
	var result *model.BusinessDashboard
	var err error
	var load func(context.Context) (*model.BusinessDashboard, error)
	key := businessDashboardCacheKey{Day: (now.Unix() + 8*3600) / 86400}
	startText, hasStart := c.GetQuery("start_timestamp")
	endText, hasEnd := c.GetQuery("end_timestamp")
	if c.Request.URL.Query().Has("start_timestamp") || c.Request.URL.Query().Has("end_timestamp") {
		start, startErr := strconv.ParseInt(startText, 10, 64)
		end, endErr := strconv.ParseInt(endText, 10, 64)
		if !hasStart || !hasEnd || startErr != nil || endErr != nil || c.Request.URL.Query().Has("days") || c.Request.URL.Query().Has("offset") {
			err = model.ErrInvalidBusinessPeriod
		} else {
			key.Start, key.End = start, end
			load = func(loadCtx context.Context) (*model.BusinessDashboard, error) {
				return model.GetBusinessDashboardRange(loadCtx, start, end, now)
			}
		}
	} else {
		days, daysErr := strconv.Atoi(c.DefaultQuery("days", "7"))
		offset, offsetErr := strconv.Atoi(c.DefaultQuery("offset", "0"))
		if daysErr != nil || offsetErr != nil {
			err = model.ErrInvalidBusinessPeriod
		} else {
			key.Days, key.Offset = days, offset
			load = func(loadCtx context.Context) (*model.BusinessDashboard, error) {
				return model.GetBusinessDashboard(loadCtx, days, offset, now)
			}
		}
	}
	if err == nil {
		entry, found, _ := businessDashboardCache.Get(key)
		if found && now.Before(entry.ExpiresAt) {
			result = entry.Result
		} else {
			ch := businessDashboardFlight.DoChan(key.singleflightKey(), func() (any, error) {
				if cached, ok, _ := businessDashboardCache.Get(key); ok && time.Now().Before(cached.ExpiresAt) {
					return cached.Result, nil
				}
				queryCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
				defer cancel()
				res, loadErr := load(queryCtx)
				// Retry transient log-store failures on the next request.
				if loadErr == nil && (res.Activity != nil || model.LOG_DB == nil) {
					businessDashboardCache.Set(key, businessDashboardCacheEntry{Result: res, ExpiresAt: time.Now().Add(time.Minute)})
				}
				return res, loadErr
			})
			select {
			case <-c.Request.Context().Done():
				err = c.Request.Context().Err()
			case flightRes := <-ch:
				if flightRes.Err != nil {
					err = flightRes.Err
				} else if flightRes.Val != nil {
					result = flightRes.Val.(*model.BusinessDashboard)
				}
			}
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
