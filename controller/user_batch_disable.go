package controller

import (
	"errors"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// BatchDisableUsers consumes one proof bound to the complete target set.
// Target validation and status changes share a transaction; no subset is applied.
func BatchDisableUsers(c *gin.Context) {
	var request service.AdminUserBatchDisableContext
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	ids, err := service.NormalizeBatchDisableUsers(request.UserIDs)
	if err != nil {
		common.ApiErrorT(c, "Invalid parameters")
		return
	}
	request.UserIDs = ids
	role, operator := c.GetInt("role"), c.GetInt("id")
	if role < common.RoleAdminUser {
		common.ApiErrorStatus(c, http.StatusForbidden, common.NewMessage("No permission to update users of same or higher permission level"))
		return
	}
	authorization := requireAdminUserProof(c, service.VerificationScopeAdminUserBatchDisable, request)
	if authorization == nil {
		return
	}
	var users []model.User
	invalidTarget := errors.New("invalid batch disable target")
	err = model.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id", "username", "role", "status").Where("id IN ?", ids).Order("id").Find(&users).Error; err != nil {
			return err
		}
		if len(users) != len(ids) {
			return invalidTarget
		}
		for _, user := range users {
			if user.Id == operator || user.Role == common.RoleRootUser || !canManageTargetRole(role, user.Role) {
				return invalidTarget
			}
		}
		for _, user := range users {
			if user.Status == common.UserStatusDisabled {
				continue
			}
			// Use a partial model so balances and unrelated profile fields are never overwritten.
			update := model.User{Id: user.Id, Status: common.UserStatusDisabled}
			if err := update.UpdateWithTx(tx, false); err != nil {
				return err
			}
		}
		return nil
	})
	if errors.Is(err, invalidTarget) {
		common.ApiErrorT(c, "Selected users include missing, deleted or unauthorized accounts")
		return
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// Always complete every user's invalidation, even if one cache operation fails.
	var completionError error
	for _, user := range users {
		completionError = errors.Join(completionError, model.PublishUserAuthCache(user.Id))
		_, err := model.RevokeAllUserSessions(user.Id, "admin_batch_disable")
		completionError = errors.Join(completionError, err, model.InvalidateUserTokensCache(user.Id))
		recordManageAuditFor(c, user.Id, "user.manage", map[string]any{
			"action": "disable", "id": user.Id, "username": user.Username,
			"batch_user_ids": ids, "verification_method": authorization.Method,
		})
	}
	if completionError != nil {
		common.SysLog("Batch disable session/cache invalidation failed: " + completionError.Error())
		common.ApiErrorT(c, "Accounts were disabled, but session or cache cleanup failed. Refresh and retry the same selection")
		return
	}
	common.ApiSuccess(c, gin.H{"user_ids": ids})
}
