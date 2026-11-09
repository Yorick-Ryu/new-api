package router

import (
	"net/http"

	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/service/authz"
	"github.com/gin-gonic/gin"
)

func registerCampusRoutes(api *gin.RouterGroup) {
	api.GET("/campus/status", middleware.DisableCache(), controller.CampusStatus)
	campus := api.Group("/campus", controller.CampusSiteGuard, middleware.DisableCache(), middleware.AnonymousRequestBodyLimit())
	campus.GET("/invite/:code", middleware.CriticalRateLimit(), controller.CampusInvite)
	user := campus.Group("/self", middleware.UserAuth(), middleware.SessionCookieOriginGuard())
	user.GET("", controller.CampusOverview)
	user.GET("/records/:kind", controller.CampusList)
	user.POST("/join", middleware.UserCriticalRateLimit("campus"), controller.CampusJoin)
	user.POST("/bind", middleware.UserCriticalRateLimit("campus"), controller.CampusBind)
	user.POST("/reminder", controller.CampusReminder)
	user.POST("/coupon/resume", middleware.UserCriticalRateLimit("campus"), controller.CampusResumeCoupon)
	user.POST("/withdraw", middleware.UserCriticalRateLimit("campus"), controller.CampusWithdraw)
	admin := campus.Group("/admin", middleware.AdminAuth(), middleware.SessionCookieOriginGuard())
	handlePermissionRoute(admin, http.MethodGet, "/config", authz.CampusRead, controller.CampusConfig)
	handlePermissionRoute(admin, http.MethodPut, "/config", authz.CampusWrite, controller.CampusConfig)
	handlePermissionRoute(admin, http.MethodGet, "/members/:id/tier", authz.CampusRead, controller.CampusMemberTier)
	handlePermissionRoute(admin, http.MethodPut, "/members/:id/tier", authz.CampusWrite, controller.CampusMemberTier)
	handlePermissionRoute(admin, http.MethodPut, "/tiers", authz.CampusWrite, controller.CampusConfigureTiers)
	handlePermissionRoute(admin, http.MethodPut, "/plan-rates", authz.CampusWrite, controller.CampusConfigurePlanRates)
	handlePermissionRoute(admin, http.MethodGet, "/records/:kind", authz.CampusRead, controller.CampusAdminList)
	handlePermissionRoute(admin, http.MethodPost, "/withdrawals/:id", authz.CampusWrite, controller.CampusWithdrawalAction)
	handlePermissionRoute(admin, http.MethodPost, "/refund", authz.CampusWrite, controller.CampusRefund)
	handlePermissionRoute(admin, http.MethodPost, "/reconcile", authz.CampusWrite, controller.CampusReconcile)
}
