package controller

import (
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/auto_ban"
	"github.com/gin-gonic/gin"
)

func GetAutoBanSettings(c *gin.Context) {
	settings, err := model.GetAutoBanSettings()
	if err != nil {
		common.ApiErrorMsg(c, common.TranslateMessage(c, "auto_ban.load_failed"))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": settings})
}

func UpdateAutoBanSettings(c *gin.Context) {
	var settings auto_ban.Settings
	if err := common.DecodeJson(io.LimitReader(c.Request.Body, 1<<20), &settings); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": common.TranslateMessage(c, "auto_ban.invalid_settings")})
		return
	}
	if err := auto_ban.Validate(settings); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": common.TranslateMessage(c, "auto_ban.invalid_settings"), "detail": err.Error()})
		return
	}
	updated, err := model.SaveAutoBanSettings(settings)
	if errors.Is(err, model.ErrAutoBanSettingsConflict) {
		c.JSON(http.StatusConflict, gin.H{"success": false, "message": common.TranslateMessage(c, "auto_ban.conflict")})
		return
	}
	if err != nil {
		common.ApiErrorMsg(c, common.TranslateMessage(c, "auto_ban.save_failed"))
		return
	}
	recordManageAudit(c, "auto_ban.settings.update", map[string]interface{}{"previous_version": settings.Version, "version": updated.Version, "mode": updated.Mode, "rule_count": len(updated.Rules)})
	c.JSON(http.StatusOK, gin.H{"success": true, "data": updated})
}

func TestAutoBanRules(c *gin.Context) {
	var req struct {
		Settings   auto_ban.Settings `json:"settings"`
		Body       string            `json:"body"`
		HTTPStatus int               `json:"http_status"`
		ChannelID  int               `json:"channel_id"`
		Model      string            `json:"model"`
	}
	if err := common.DecodeJson(io.LimitReader(c.Request.Body, 1<<20), &req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": common.TranslateMessage(c, "auto_ban.invalid_test")})
		return
	}
	if err := auto_ban.Validate(req.Settings); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": common.TranslateMessage(c, "auto_ban.invalid_settings"), "detail": err.Error()})
		return
	}
	if req.HTTPStatus < 100 || req.HTTPStatus > 599 || len(req.Body) > 65536 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": common.TranslateMessage(c, "auto_ban.invalid_sample")})
		return
	}
	e, failed := service.ParseUpstreamFailure([]byte(req.Body), req.HTTPStatus)
	type groupResult struct {
		ID         string `json:"id"`
		Matched    bool   `json:"matched"`
		Conditions []bool `json:"conditions"`
	}
	type result struct {
		ID      string        `json:"id"`
		Name    string        `json:"name"`
		Matched bool          `json:"matched"`
		Groups  []groupResult `json:"groups"`
	}
	results := make([]result, 0, len(req.Settings.Rules))
	for _, rule := range req.Settings.Rules {
		r := result{ID: rule.ID, Name: rule.Name, Groups: make([]groupResult, 0, len(rule.MatchGroups))}
		for _, group := range rule.MatchGroups {
			g := groupResult{ID: group.ID, Matched: failed && auto_ban.MatchGroupConditions(group, e), Conditions: make([]bool, 0, len(group.Conditions))}
			for _, cond := range group.Conditions {
				g.Conditions = append(g.Conditions, failed && auto_ban.MatchCondition(cond, e))
			}
			r.Groups = append(r.Groups, g)
		}
		r.Matched = failed && len(auto_ban.Match(auto_ban.Settings{Rules: []auto_ban.Rule{rule}}, e, req.ChannelID, req.Model)) > 0
		results = append(results, r)
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"is_upstream_error": failed, "rules": results}})
}

func GetAutoBanEvents(c *gin.Context) {
	before, _ := strconv.Atoi(c.Query("before"))
	events, err := model.ListAutoBanEvents(before, 30)
	if err != nil {
		common.ApiErrorMsg(c, common.TranslateMessage(c, "auto_ban.records_failed"))
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": events})
}
