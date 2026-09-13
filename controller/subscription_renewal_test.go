package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupSubscriptionRenewalControllerTest(t *testing.T) (*gorm.DB, model.User, model.SubscriptionPlan, *model.UserSubscription) {
	t.Helper()
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousMainType, previousLogType := common.MainDatabaseType(), common.LogDatabaseType()
	previousRedis := common.RedisEnabled
	payment := operation_setting.GetPaymentSetting()
	previousPayment := *payment
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	payment.ComplianceConfirmed = true
	payment.ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	model.DB, model.LOG_DB = db, db
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.SetDatabaseTypes(previousMainType, previousLogType)
		common.RedisEnabled = previousRedis
		*payment = previousPayment
		_ = sqlDB.Close()
	})
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Log{}, &model.SubscriptionPlan{}, &model.SubscriptionOrder{}, &model.UserSubscription{}, &model.UserSubscriptionQuotaWindow{}))
	user := model.User{Username: "renewal-controller", Quota: 10000000}
	require.NoError(t, db.Create(&user).Error)
	plan := model.SubscriptionPlan{Title: "Renew", AllowRenewal: common.GetPointer(true), Enabled: true, PriceAmount: 1, DurationUnit: model.SubscriptionDurationDay, DurationValue: 30, MaxPurchasePerUser: 1, QuotaResetPeriod: model.SubscriptionResetDaily, TotalAmount: 1000}
	require.NoError(t, db.Create(&plan).Error)
	model.InvalidateSubscriptionPlanCache(plan.Id)
	t.Cleanup(func() { model.InvalidateSubscriptionPlanCache(plan.Id) })
	sub, err := model.CreateUserSubscriptionFromPlanTx(db, user.Id, &plan, "order")
	require.NoError(t, err)
	return db, user, plan, sub
}

func TestSubscriptionBalancePayAcceptsRenewalTargetAtPurchaseLimit(t *testing.T) {
	db, user, plan, sub := setupSubscriptionRenewalControllerTest(t)
	writer := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(writer)
	ctx.Set("id", user.Id)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/subscription/balance/pay", strings.NewReader(fmt.Sprintf(`{"plan_id":%d,"renewal_subscription_id":%d}`, plan.Id, sub.Id)))
	ctx.Request.Header.Set("Content-Type", "application/json")
	SubscriptionRequestBalancePay(ctx)
	require.Equal(t, http.StatusOK, writer.Code)
	var response struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(writer.Body.Bytes(), &response))
	require.True(t, response.Success, writer.Body.String())
	var updated model.UserSubscription
	require.NoError(t, db.First(&updated, sub.Id).Error)
	assert.Equal(t, sub.EndTime+30*86400, updated.EndTime)
	var order model.SubscriptionOrder
	require.NoError(t, db.First(&order).Error)
	assert.Equal(t, sub.Id, order.RenewalSubscriptionId)
	var count int64
	require.NoError(t, db.Model(&model.UserSubscription{}).Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

func TestSubscriptionPlanRenewalSettingPersistsExplicitFalseAndPreservesOmittedUpdates(t *testing.T) {
	db, user, plan, _ := setupSubscriptionRenewalControllerTest(t)
	expected := true
	for _, value := range []*bool{common.GetPointer(false), nil, common.GetPointer(true), nil} {
		plan.AllowRenewal = value
		body, err := common.Marshal(map[string]interface{}{"plan": plan})
		require.NoError(t, err)
		writer := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(writer)
		ctx.Set("id", user.Id)
		ctx.Params = gin.Params{{Key: "id", Value: fmt.Sprint(plan.Id)}}
		ctx.Request = httptest.NewRequest(http.MethodPut, "/api/subscription/admin/plans/1", strings.NewReader(string(body)))
		ctx.Request.Header.Set("Content-Type", "application/json")
		AdminUpdateSubscriptionPlan(ctx)
		var response struct {
			Success bool `json:"success"`
		}
		require.NoError(t, common.Unmarshal(writer.Body.Bytes(), &response))
		require.True(t, response.Success, writer.Body.String())
		var updated model.SubscriptionPlan
		require.NoError(t, db.First(&updated, plan.Id).Error)
		require.NotNil(t, updated.AllowRenewal)
		if value != nil {
			expected = *value
		}
		assert.Equal(t, expected, *updated.AllowRenewal)
		cached, err := model.GetSubscriptionPlanById(plan.Id)
		require.NoError(t, err)
		require.NotNil(t, cached.AllowRenewal)
		assert.Equal(t, expected, *cached.AllowRenewal)
	}
}

func TestSubscriptionPlanCreateRequiresExplicitRenewalOptIn(t *testing.T) {
	for _, value := range []*bool{nil, common.GetPointer(false), common.GetPointer(true)} {
		t.Run(fmt.Sprint(value != nil, value != nil && *value), func(t *testing.T) {
			db, user, plan, _ := setupSubscriptionRenewalControllerTest(t)
			plan.Id = 0
			plan.Title = "New plan"
			plan.AllowRenewal = value
			body, err := common.Marshal(map[string]interface{}{"plan": plan})
			require.NoError(t, err)
			writer := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(writer)
			ctx.Set("id", user.Id)
			ctx.Request = httptest.NewRequest(http.MethodPost, "/api/subscription/admin/plans", strings.NewReader(string(body)))
			ctx.Request.Header.Set("Content-Type", "application/json")
			AdminCreateSubscriptionPlan(ctx)
			var response struct {
				Success bool `json:"success"`
			}
			require.NoError(t, common.Unmarshal(writer.Body.Bytes(), &response))
			require.True(t, response.Success, writer.Body.String())
			var created model.SubscriptionPlan
			require.NoError(t, db.Where("title = ?", plan.Title).First(&created).Error)
			require.NotNil(t, created.AllowRenewal)
			assert.Equal(t, value != nil && *value, *created.AllowRenewal)
		})
	}
}
