package controller

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPlansPageCatalog(t *testing.T) {
	dialect := os.Getenv("TEST_PLANS_DIALECT")
	if dialect == "" {
		dialect = "sqlite"
	}
	db, _ := newAuditTestDatabase(t, dialect, os.Getenv("TEST_"+strings.ToUpper(dialect)+"_DSN"))
	previousDB := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previousDB })
	require.NoError(t, db.AutoMigrate(&model.SubscriptionPlan{}, &model.User{}, &model.UserSession{}))
	previousSetting := *operation_setting.GetPaymentSetting()
	t.Cleanup(func() { *operation_setting.GetPaymentSetting() = previousSetting })
	operation_setting.GetPaymentSetting().ComplianceConfirmed = true
	operation_setting.GetPaymentSetting().ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
	common.OptionMapRWMutex.Lock()
	previousOptions := common.OptionMap
	common.OptionMap = map[string]string{}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptions
		common.OptionMapRWMutex.Unlock()
	})
	previousPrice, previousMin, previousQuota := operation_setting.Price, operation_setting.MinTopUp, common.QuotaPerUnit
	previousGeneral := *operation_setting.GetGeneralSetting()
	previousRatios := common.TopupGroupRatio2JSONString()
	t.Cleanup(func() {
		operation_setting.Price, operation_setting.MinTopUp, common.QuotaPerUnit = previousPrice, previousMin, previousQuota
		*operation_setting.GetGeneralSetting() = previousGeneral
		require.NoError(t, common.UpdateTopupGroupRatioByJSONString(previousRatios))
	})
	operation_setting.Price, operation_setting.MinTopUp, common.QuotaPerUnit = 1.25, 1, 500000
	operation_setting.GetGeneralSetting().QuotaDisplayType = operation_setting.QuotaDisplayTypeUSD
	require.NoError(t, common.UpdateTopupGroupRatioByJSONString(`{"default":1,"vip":0.8}`))
	operation_setting.GetPaymentSetting().AmountOptions = []int{10, 220}
	operation_setting.GetPaymentSetting().AmountDiscount = map[int]float64{220: 0.8}
	plan := model.SubscriptionPlan{Title: "Public subscription", PriceAmount: 128, DurationUnit: "month", DurationValue: 1, StripePriceId: "private-provider-product", UpgradeGroup: "private-internal-group", Enabled: true, TotalAmount: 10000, QuotaResetPeriod: "custom", QuotaResetCustomSeconds: 7200}
	require.NoError(t, db.Create(&plan).Error)
	hidden := model.SubscriptionPlan{Title: "Disabled subscription", PriceAmount: 256, Enabled: true}
	require.NoError(t, db.Create(&hidden).Error)
	require.NoError(t, db.Model(&hidden).Update("enabled", false).Error)
	router := gin.New()
	router.GET("/api/plans/catalog", middleware.DisableCache(), GetPlansPageCatalog)
	request := func(config string, tokens ...string) *httptest.ResponseRecorder {
		common.OptionMapRWMutex.Lock()
		common.OptionMap["HeaderNavModules"] = config
		common.OptionMapRWMutex.Unlock()
		response := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/api/plans/catalog", nil)
		if len(tokens) > 0 {
			req.Header.Set("Authorization", "Bearer "+tokens[0])
		}
		router.ServeHTTP(response, req)
		return response
	}
	t.Run("public_enabled_catalog_only_exposes_display_fields", func(t *testing.T) {
		response := request(`{"plans":{"enabled":true,"requireAuth":false}}`)
		require.Equal(t, http.StatusOK, response.Code)
		var payload struct {
			Success bool `json:"success"`
			Data    struct {
				Subscriptions []PlansPageSubscription `json:"subscriptions"`
			} `json:"data"`
		}
		require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
		require.True(t, payload.Success)
		require.Len(t, payload.Data.Subscriptions, 1)
		assert.Equal(t, plan.Id, payload.Data.Subscriptions[0].ID)
		assert.Equal(t, 128.0, payload.Data.Subscriptions[0].PriceAmount)
		assert.Equal(t, "custom", payload.Data.Subscriptions[0].QuotaResetPeriod)
		assert.EqualValues(t, 7200, payload.Data.Subscriptions[0].QuotaResetCustomSeconds)
		assert.NotContains(t, response.Body.String(), "private-provider-product")
		assert.NotContains(t, response.Body.String(), "private-internal-group")
		assert.NotContains(t, response.Body.String(), "stripe_price_id")
	})
	t.Run("topup_cards_follow_current_settings_and_server_quotes", func(t *testing.T) {
		readOptions := func() []struct {
			Amount  int64   `json:"amount"`
			Credits float64 `json:"credits"`
			Money   string  `json:"money"`
		} {
			response := request(`{"plans":{"enabled":true,"requireAuth":false}}`)
			require.Equal(t, http.StatusOK, response.Code)
			var payload struct {
				Data struct {
					TopupOptions []struct {
						Amount  int64   `json:"amount"`
						Credits float64 `json:"credits"`
						Money   string  `json:"money"`
					} `json:"topup_options"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
			return payload.Data.TopupOptions
		}
		options := readOptions()
		require.Len(t, options, 2)
		assert.EqualValues(t, 10, options[0].Amount)
		assert.Equal(t, 10.0, options[0].Credits)
		assert.Equal(t, "12.50", options[0].Money)
		assert.EqualValues(t, 220, options[1].Amount)
		assert.Equal(t, "220.00", options[1].Money)
		previousOptions, previousDiscount := operation_setting.GetPaymentSetting().AmountOptions, operation_setting.GetPaymentSetting().AmountDiscount
		defer func() {
			operation_setting.GetPaymentSetting().AmountOptions = previousOptions
			operation_setting.GetPaymentSetting().AmountDiscount = previousDiscount
			operation_setting.Price = 1.25
			operation_setting.GetGeneralSetting().QuotaDisplayType = operation_setting.QuotaDisplayTypeUSD
		}()
		operation_setting.GetPaymentSetting().AmountOptions = []int{20}
		operation_setting.GetPaymentSetting().AmountDiscount = map[int]float64{20: 0.75}
		operation_setting.Price = 2
		options = readOptions()
		require.Len(t, options, 1)
		assert.EqualValues(t, 20, options[0].Amount)
		assert.Equal(t, "30.00", options[0].Money)
		operation_setting.GetPaymentSetting().AmountOptions = []int{-1, 0, 10, 10, int(common.MaxWalletQuota)}
		options = readOptions()
		require.Len(t, options, 1)
		assert.EqualValues(t, 10, options[0].Amount)
		operation_setting.GetPaymentSetting().AmountOptions = []int{5000000}
		operation_setting.GetGeneralSetting().QuotaDisplayType = operation_setting.QuotaDisplayTypeTokens
		options = readOptions()
		require.Len(t, options, 1)
		assert.EqualValues(t, 5000000, options[0].Amount)
		assert.Equal(t, 10.0, options[0].Credits)
		assert.Equal(t, "20.00", options[0].Money)
	})
	t.Run("disabled_and_corrupt_configuration_do_not_expose_catalog", func(t *testing.T) {
		for _, config := range []string{`{"plans":{"enabled":false}}`, `broken`, `{"plans":{"enabled":"invalid"}}`} {
			response := request(config)
			assert.Equal(t, http.StatusNotFound, response.Code)
			assert.NotContains(t, response.Body.String(), plan.Title)
		}
	})
	t.Run("login_required_catalog_rejects_visitors", func(t *testing.T) {
		response := request(`{"plans":{"enabled":true,"requireAuth":true}}`)
		assert.Equal(t, http.StatusUnauthorized, response.Code)
		assert.NotContains(t, response.Body.String(), plan.Title)
	})
	t.Run("login_required_catalog_accepts_live_session_and_rejects_revocation", func(t *testing.T) {
		previousSecret, previousRedis := common.SessionSecret, common.RedisEnabled
		common.SessionSecret, common.RedisEnabled = "isolated-plans-session-key-at-least-32-bytes", false
		defer func() { common.SessionSecret, common.RedisEnabled = previousSecret, previousRedis }()
		user := model.User{Username: "plans-reader", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1, AffCode: "plans-reader", Group: "vip"}
		require.NoError(t, db.Create(&user).Error)
		identity, token := createAccessTokenTestSession(t, user.Id, "plans-reader-session")
		response := request(`{"plans":{"enabled":true,"requireAuth":true}}`, token)
		require.Equal(t, http.StatusOK, response.Code)
		assert.Contains(t, response.Body.String(), plan.Title)
		publicResponse := request(`{"plans":{"enabled":true,"requireAuth":false}}`, token)
		require.Equal(t, http.StatusOK, publicResponse.Code)
		var catalog struct {
			Data struct {
				TopupOptions []struct {
					Money string `json:"money"`
				} `json:"topup_options"`
			} `json:"data"`
		}
		require.NoError(t, common.Unmarshal(publicResponse.Body.Bytes(), &catalog))
		require.Len(t, catalog.Data.TopupOptions, 2)
		assert.Equal(t, "10.00", catalog.Data.TopupOptions[0].Money)
		assert.Contains(t, publicResponse.Header().Get("Cache-Control"), "no-store")
		require.NoError(t, db.Model(&model.UserSession{}).Where("sid = ?", identity.SessionID).Update("status", model.UserSessionStatusRevoked).Error)
		// Validation must consult the live session rather than accepting a previously valid JWT.
		_, _, err := service.ValidateLoginSession(identity)
		require.Error(t, err)
		response = request(`{"plans":{"enabled":true,"requireAuth":true}}`, token)
		assert.Equal(t, http.StatusUnauthorized, response.Code)
		assert.NotContains(t, response.Body.String(), plan.Title)
		response = request(`{"plans":{"enabled":true,"requireAuth":false}}`, token)
		assert.Equal(t, http.StatusUnauthorized, response.Code)
	})
	t.Run("payment_disabled_returns_empty_catalog", func(t *testing.T) {
		operation_setting.GetPaymentSetting().ComplianceConfirmed = false
		defer func() { operation_setting.GetPaymentSetting().ComplianceConfirmed = true }()
		response := request(`{"plans":{"enabled":true,"requireAuth":false}}`)
		assert.Equal(t, http.StatusOK, response.Code)
		assert.NotContains(t, response.Body.String(), plan.Title)
	})
}
