package router

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Calcium-Ion/go-epay/epay"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	cp "github.com/QuantumNous/new-api/pkg/campuspartner"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/service/authz"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// This suite uses the real API router, registration/login, authorization,
// payment callbacks and SQL transactions. Only external payment signatures
// and elapsed business time are fixtures. No refund endpoints are exercised.
type campusJourney struct {
	db       *gorm.DB
	engine   *gin.Engine
	password string
	admin    campusClient
}

type campusClient struct {
	id    int
	token string
	sid   string
}

type campusResponse struct {
	Success bool            `json:"success"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
}

type campusNoExternalHTTP struct{}

func (campusNoExternalHTTP) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, errors.New("outbound HTTP disabled during campus journey tests")
}

func campusFixtureValue[T any](t *testing.T, target *T, value T) {
	t.Helper()
	previous := *target
	*target = value
	t.Cleanup(func() { *target = previous })
}

func newCampusJourney(t *testing.T, dialect string) *campusJourney {
	t.Helper()
	dsn := "local"
	if dialect != "sqlite" {
		dsn = os.Getenv("CAMPUS_JOURNEY_" + strings.ToUpper(dialect) + "_DSN")
		if dsn == "" {
			t.Skip("dedicated empty campus journey database not configured")
		}
		// The runner creates fresh loopback-only databases, never deployment DSNs.
		require.True(t, strings.Contains(dsn, "127.0.0.1"), "journey database must be local")
		require.True(t, strings.Contains(dsn, "campus_journey_"), "journey database must have a dedicated name")
	}
	t.Setenv("SQL_DSN", dsn)
	t.Setenv("LOG_SQL_DSN", "")
	campusFixtureValue(t, &common.SQLitePath, t.TempDir()+"/journey.db?_pragma=busy_timeout(30000)&_pragma=journal_mode(WAL)&_txlock=immediate")
	campusFixtureValue(t, &common.IsMasterNode, false)
	campusFixtureValue(t, &common.RedisEnabled, false)
	campusFixtureValue(t, &common.RegisterEnabled, true)
	campusFixtureValue(t, &common.PasswordRegisterEnabled, true)
	campusFixtureValue(t, &common.PasswordLoginEnabled, true)
	campusFixtureValue(t, &common.PasswordLoginEncryptionEnabled, false)
	campusFixtureValue(t, &common.EmailVerificationEnabled, true)
	campusFixtureValue(t, &common.TurnstileCheckEnabled, false)
	campusFixtureValue(t, &common.GlobalApiRateLimitEnable, false)
	campusFixtureValue(t, &common.CriticalRateLimitEnable, false)
	campusFixtureValue(t, &constant.GenerateDefaultToken, false)
	campusFixtureValue(t, &common.QuotaForNewUser, 0)
	campusFixtureValue(t, &common.SessionSecret, common.GetRandomString(48))
	campusFixtureValue(t, &common.SessionCookieSecure, true)
	campusFixtureValue[http.RoundTripper](t, &http.DefaultTransport, campusNoExternalHTTP{})
	campusFixtureValue(t, &operation_setting.MinTopUp, 1)
	campusFixtureValue(t, &operation_setting.Price, float64(1))
	campusFixtureValue(t, &operation_setting.PayAddress, "https://payment.example.test")
	campusFixtureValue(t, &operation_setting.EpayId, "journey-merchant")
	campusFixtureValue(t, &operation_setting.EpayKey, common.GetRandomString(48))
	campusFixtureValue(t, &operation_setting.PayMethods, []map[string]string{{"type": "alipay", "name": "Alipay"}})
	campusFixtureValue(t, &system_setting.SiteAddress, "https://beiapi.cn")
	campusFixtureValue(t, &system_setting.SiteAllowedOrigins, "https://novapi.cn,https://www.beiapi.cn")
	campusFixtureValue(t, &system_setting.ServerAddress, "https://beiapi.cn")
	payment := operation_setting.GetPaymentSetting()
	previousPayment := *payment
	t.Cleanup(func() { *payment = previousPayment })
	payment.ComplianceConfirmed = true
	payment.ComplianceTermsVersion = operation_setting.CurrentComplianceTermsVersion
	previousDB, previousLog := model.DB, model.LOG_DB
	previousMain, previousLogType := common.MainDatabaseType(), common.LogDatabaseType()
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLog
		common.SetDatabaseTypes(previousMain, previousLogType)
	})
	require.NoError(t, model.InitDB())
	db := model.DB
	db.Logger = logger.Default.LogMode(logger.Silent)
	model.LOG_DB = db
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	tables, err := db.Migrator().GetTables()
	require.NoError(t, err)
	require.Empty(t, tables, "refuse to test against a nonempty database")
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.UserSession{}, &model.AuthFlow{}, &model.ExternalIdentityClaim{}, &model.Log{}, &model.AuditLog{}, &model.Option{}, &model.TwoFA{}, &model.PasskeyCredential{}, &model.TopUp{}, &model.SubscriptionPlan{}, &model.SubscriptionOrder{}, &model.UserSubscription{}, &model.UserSubscriptionQuotaWindow{}, &model.CasbinRule{}, &model.AuthzRole{}))
	require.NoError(t, model.InitializeCampusPartner(db))
	require.NoError(t, authz.Init(db))
	versionSQL := "SELECT VERSION()"
	if dialect == "sqlite" {
		versionSQL = "SELECT sqlite_version()"
	}
	var version string
	require.NoError(t, db.Raw(versionSQL).Scan(&version).Error)
	t.Logf("database engine: %s %s", dialect, version)
	gin.SetMode(gin.TestMode)
	j := &campusJourney{db: db, engine: gin.New(), password: common.GetRandomString(32)}
	SetApiRouter(j.engine)
	// Only the initial administrator is provisioned as a fixture. Participants
	// are subsequently created by the production registration endpoint.
	root := model.User{Username: "journey-admin", Password: j.password, Role: common.RoleRootUser, Status: common.UserStatusEnabled, Group: "default"}
	require.NoError(t, root.Insert(0))
	j.admin = j.login(t, root.Username)
	return j
}

func (j *campusJourney) request(client campusClient, method, path string, body any) *httptest.ResponseRecorder {
	var encoded []byte
	contentType := "application/json"
	if form, ok := body.(url.Values); ok {
		encoded = []byte(form.Encode())
		contentType = "application/x-www-form-urlencoded"
	} else if body != nil {
		var err error
		encoded, err = common.Marshal(body)
		if err != nil {
			panic(err)
		}
	}
	if strings.HasPrefix(path, "/") {
		path = "https://beiapi.cn" + path
	}
	req := httptest.NewRequest(method, path, strings.NewReader(string(encoded)))
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Origin", "https://beiapi.cn")
	if client.token != "" {
		req.Header.Set("Authorization", "Bearer "+client.token)
		req.Header.Set("X-Auth-Session", client.sid)
	}
	response := httptest.NewRecorder()
	j.engine.ServeHTTP(response, req)
	return response
}

func (j *campusJourney) api(t *testing.T, client campusClient, method, path string, body any, success bool, target any) {
	t.Helper()
	response := j.request(client, method, path, body)
	require.Equal(t, http.StatusOK, response.Code, "%s %s HTTP status", method, path)
	var result campusResponse
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	require.Equal(t, success, result.Success, "%s %s business result: %s", method, path, result.Message)
	if target != nil && success {
		require.NoError(t, common.Unmarshal(result.Data, target))
	}
}

func (j *campusJourney) login(t *testing.T, username string) campusClient {
	t.Helper()
	var data struct {
		AccessToken string                   `json:"access_token"`
		Session     service.LoginSessionView `json:"session"`
		User        struct {
			ID int `json:"id"`
		} `json:"user"`
	}
	j.api(t, campusClient{}, "POST", "/api/user/login", map[string]string{"username": username, "password": j.password}, true, &data)
	require.NotEmpty(t, data.AccessToken)
	require.Positive(t, data.User.ID)
	return campusClient{id: data.User.ID, token: data.AccessToken, sid: data.Session.SID}
}

func (j *campusJourney) register(t *testing.T, username, code string) campusClient {
	t.Helper()
	email := username + "@example.test"
	verification := common.GetRandomString(12)
	common.RegisterVerificationCodeWithKey(email, verification, common.EmailVerificationPurpose)
	j.api(t, campusClient{}, "POST", "/api/user/register", map[string]string{"username": username, "password": j.password, "email": email, "verification_code": verification, "campus_code": code}, true, nil)
	return j.login(t, username)
}

func (j *campusJourney) overview(t *testing.T, client campusClient) model.CampusOverview {
	t.Helper()
	var result model.CampusOverview
	j.api(t, client, "GET", "/api/campus/self", nil, true, &result)
	return result
}

func (j *campusJourney) checkout(t *testing.T, client campusClient, amount int, coupon bool) model.TopUp {
	t.Helper()
	response := j.request(client, "POST", "/api/user/pay", gin.H{"amount": amount, "payment_method": "alipay", "campus_coupon": coupon})
	require.Equal(t, http.StatusOK, response.Code)
	var result campusResponse
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	// Epay checkout's existing contract uses message=success, not success=true.
	require.Equal(t, "success", result.Message)
	var order model.TopUp
	require.NoError(t, j.db.Where("user_id = ?", client.id).Order("id desc").First(&order).Error)
	require.Equal(t, common.TopUpStatusPending, order.Status)
	return order
}

func (j *campusJourney) proof(trade, reference, amount string, overrides map[string]string) url.Values {
	params := map[string]string{"pid": operation_setting.EpayId, "out_trade_no": trade, "trade_no": reference, "trade_status": epay.StatusTradeSuccess, "type": "alipay", "money": amount, "sign_type": "MD5"}
	for key, value := range overrides {
		params[key] = value
	}
	params = epay.GenerateParams(params, operation_setting.EpayKey)
	values := url.Values{}
	for key, value := range params {
		values.Set(key, value)
	}
	return values
}

func (j *campusJourney) paid(t *testing.T, order model.TopUp, reference string) {
	t.Helper()
	response := j.request(campusClient{}, "POST", "/api/user/epay/notify", j.proof(order.TradeNo, reference, fmt.Sprintf("%.2f", order.Money), nil))
	require.Equal(t, "success", response.Body.String())
}

func (j *campusJourney) wallet(t *testing.T, client campusClient) int {
	t.Helper()
	var user struct {
		Quota int `json:"quota"`
	}
	j.api(t, client, "GET", "/api/user/self", nil, true, &user)
	return user.Quota
}

func TestCampusHTTPJourney(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			j := newCampusJourney(t, dialect)
			partner := j.register(t, "journey-partner", "")
			j.api(t, partner, "POST", "/api/campus/self/join", gin.H{}, false, nil)
			j.api(t, j.admin, "PUT", "/api/campus/admin/config", gin.H{"enabled": true}, true, nil)
			var member model.CampusMember
			j.api(t, partner, "POST", "/api/campus/self/join", gin.H{}, true, &member)
			require.Len(t, member.Code, 6)
			buyer := j.register(t, "journey-buyer", strings.ToLower(member.Code))
			stranger := j.register(t, "journey-stranger", "")
			baseline := j.wallet(t, buyer)
			var couponOrder model.TopUp

			require.True(t, t.Run("registration_binding_and_permission_isolation", func(t *testing.T) {
				overview := j.overview(t, buyer)
				assert.Equal(t, partner.id, overview.Member.InviterID)
				assert.Equal(t, "available", overview.Member.CouponState)
				assert.EqualValues(t, 1, j.overview(t, partner).Invited)
				j.api(t, buyer, "POST", "/api/campus/self/bind", gin.H{"code": member.Code}, true, nil)
				j.api(t, partner, "POST", "/api/campus/self/bind", gin.H{"code": member.Code}, false, nil)
				assert.Equal(t, 401, j.request(campusClient{}, "GET", "/api/campus/self", nil).Code)
				assert.Equal(t, 403, j.request(buyer, "PUT", "/api/campus/admin/config", gin.H{"enabled": false}).Code)
				assert.Equal(t, 404, j.request(buyer, "GET", "https://novapi.cn/api/campus/self", nil).Code)
				var list struct {
					Total int64 `json:"total"`
				}
				j.api(t, stranger, "GET", fmt.Sprintf("/api/campus/self/records/invitations?user_id=%d", partner.id), nil, true, &list)
				assert.Zero(t, list.Total)
			}))

			require.True(t, t.Run("coupon_reservation_resume_and_duplicate_checkout", func(t *testing.T) {
				couponOrder = j.checkout(t, buyer, 2000, true)
				assert.Equal(t, 1900.0, couponOrder.Money)
				assert.Equal(t, "reserved", j.overview(t, buyer).Member.CouponState)
				response := j.request(buyer, "POST", "/api/user/pay", gin.H{"amount": 2000, "payment_method": "alipay", "campus_coupon": true})
				var rejected campusResponse
				require.NoError(t, common.Unmarshal(response.Body.Bytes(), &rejected))
				assert.NotEqual(t, "success", rejected.Message)
				j.api(t, buyer, "POST", "/api/campus/self/coupon/resume", gin.H{}, true, nil)
				var count int64
				require.NoError(t, j.db.Model(&model.TopUp{}).Where("user_id = ?", buyer.id).Count(&count).Error)
				assert.EqualValues(t, 1, count)
				assert.Equal(t, baseline, j.wallet(t, buyer))
				assert.Zero(t, j.overview(t, partner).Net)
			}))

			require.True(t, t.Run("invalid_callbacks_leave_wallet_coupon_and_commission_unchanged", func(t *testing.T) {
				for _, test := range []struct {
					name    string
					changes map[string]string
					tamper  bool
				}{
					{"bad_signature", nil, true},
					{"underpayment", map[string]string{"money": "1899.99"}, false},
					{"overpayment", map[string]string{"money": "1900.01"}, false},
					{"unknown_order", map[string]string{"out_trade_no": "missing-order"}, false},
					{"unpaid_status", map[string]string{"trade_status": "WAIT_BUYER_PAY"}, false},
					{"missing_provider_transaction", map[string]string{"trade_no": ""}, false},
				} {
					t.Run(test.name, func(t *testing.T) {
						proof := j.proof(couponOrder.TradeNo, "provider-coupon", "1900.00", test.changes)
						if test.tamper {
							proof.Set("sign", "invalid")
						}
						j.request(campusClient{}, "POST", "/api/user/epay/notify", proof)
						assert.Equal(t, baseline, j.wallet(t, buyer))
						assert.Zero(t, j.overview(t, partner).Net)
						assert.Equal(t, "reserved", j.overview(t, buyer).Member.CouponState)
						var order model.TopUp
						require.NoError(t, j.db.First(&order, couponOrder.Id).Error)
						assert.Equal(t, common.TopUpStatusPending, order.Status)
					})
				}
			}))

			require.True(t, t.Run("signed_payment_and_get_post_return_replays_credit_exactly_once", func(t *testing.T) {
				j.paid(t, couponOrder, "provider-coupon")
				j.paid(t, couponOrder, "provider-coupon")
				proof := j.proof(couponOrder.TradeNo, "provider-coupon", "1900.00", nil)
				for _, method := range []string{"GET", "POST"} {
					path := "/api/user/epay/return"
					var body any = proof
					if method == "GET" {
						path += "?" + proof.Encode()
						body = nil
					}
					response := j.request(campusClient{}, method, path, body)
					assert.Equal(t, "/wallet?pay=success", response.Header().Get("Location"))
				}
				assert.Equal(t, baseline+int(2000*common.QuotaPerUnit), j.wallet(t, buyer))
				overview := j.overview(t, partner)
				assert.EqualValues(t, 57000, overview.Net)
				assert.EqualValues(t, 57000, overview.Frozen)
				assert.EqualValues(t, 190000, overview.Member.Performance)
				assert.Equal(t, "used", j.overview(t, buyer).Member.CouponState)
			}))

			require.True(t, t.Run("parallel_callbacks_and_cross_tier_orders_do_not_double_credit", func(t *testing.T) {
				orders := []model.TopUp{j.checkout(t, buyer, 200, false), j.checkout(t, buyer, 200, false)}
				start := make(chan struct{})
				results := make(chan string, 4)
				var wg sync.WaitGroup
				for i, order := range orders {
					for range 2 {
						proof := j.proof(order.TradeNo, fmt.Sprintf("parallel-%d", i), "200.00", nil)
						wg.Go(func() {
							<-start
							results <- j.request(campusClient{}, "POST", "/api/user/epay/notify", proof).Body.String()
						})
					}
				}
				close(start)
				wg.Wait()
				close(results)
				for result := range results {
					assert.Equal(t, "success", result)
				}
				assert.Equal(t, baseline+int(2400*common.QuotaPerUnit), j.wallet(t, buyer))
				overview := j.overview(t, partner)
				assert.EqualValues(t, 230000, overview.Member.Performance)
				assert.EqualValues(t, 70500, overview.Net) // 2000*30% + 300*35%.
				assert.Equal(t, 2, overview.Tier.Level)
				assert.Equal(t, 35.0, overview.Tier.RatePercent)
			}))

			require.True(t, t.Run("provider_reference_cannot_fund_another_order", func(t *testing.T) {
				order := j.checkout(t, buyer, 2000, false)
				response := j.request(campusClient{}, "POST", "/api/user/epay/notify", j.proof(order.TradeNo, "provider-coupon", "2000.00", nil))
				assert.Equal(t, "fail", response.Body.String())
				assert.Equal(t, baseline+int(2400*common.QuotaPerUnit), j.wallet(t, buyer))
				assert.EqualValues(t, 70500, j.overview(t, partner).Net)
			}))

			require.True(t, t.Run("subscription_purchase_and_renewal_grant_one_entitlement_per_payment", func(t *testing.T) {
				plan := model.SubscriptionPlan{Title: "Journey plan", Enabled: true, AllowRenewal: common.GetPointer(true), Currency: "CNY", PriceAmount: 100, DurationUnit: model.SubscriptionDurationDay, DurationValue: 30, TotalAmount: 1000, MaxPurchasePerUser: 1}
				require.NoError(t, j.db.Create(&plan).Error)
				t.Cleanup(func() { model.InvalidateSubscriptionPlanCache(plan.Id) })
				j.api(t, j.admin, "PUT", "/api/campus/admin/plan-rates", gin.H{"plan_revision": 0, "plan_rates": []cp.PlanRate{{PlanID: plan.Id, RateBPS: 1250}}}, true, nil)
				var sub model.UserSubscription
				var originalEnd int64
				for round := range 2 {
					body := gin.H{"plan_id": plan.Id, "payment_method": "alipay"}
					if round == 1 {
						body["renewal_subscription_id"] = sub.Id
					}
					response := j.request(buyer, "POST", "/api/subscription/epay/pay", body)
					var result campusResponse
					require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
					require.Equal(t, "success", result.Message)
					var order model.SubscriptionOrder
					require.NoError(t, j.db.Where("user_id = ?", buyer.id).Order("id desc").First(&order).Error)
					proof := j.proof(order.TradeNo, fmt.Sprintf("subscription-%d", round), "100.00", nil)
					for range 2 {
						response = j.request(campusClient{}, "POST", "/api/subscription/epay/notify", proof)
						require.Equal(t, "success", response.Body.String())
					}
					require.NoError(t, j.db.Where("user_id = ?", buyer.id).First(&sub).Error)
					if round == 0 {
						originalEnd = sub.EndTime
					} else {
						assert.Equal(t, originalEnd+30*86400, sub.EndTime)
					}
				}
				var count int64
				require.NoError(t, j.db.Model(&model.UserSubscription{}).Where("user_id = ?", buyer.id).Count(&count).Error)
				assert.EqualValues(t, 1, count)
				assert.EqualValues(t, 73000, j.overview(t, partner).Net)
				assert.EqualValues(t, 250000, j.overview(t, partner).Member.Performance)
				assert.Equal(t, baseline+int(2400*common.QuotaPerUnit), j.wallet(t, buyer))
			}))

			require.True(t, t.Run("freeze_expiry_and_withdrawal_input_validation", func(t *testing.T) {
				withdraw := gin.H{"request_id": "journey-withdraw-0001", "amount": "600.00", "account": "cash@example.test", "name": "Test payee"}
				j.api(t, partner, "POST", "/api/campus/self/withdraw", withdraw, false, nil)
				// Advance only fixture settlement timestamps, leaving real balances intact.
				require.NoError(t, j.db.Model(&model.CampusPayment{}).Where("inviter_id = ? AND settled_at > 0", partner.id).Update("settled_at", time.Now().Add(-169*time.Hour).Unix()).Error)
				overview := j.overview(t, partner)
				assert.Zero(t, overview.Frozen)
				assert.EqualValues(t, 73000, overview.Available)
				for _, amount := range []string{"0", "-100", "99.99", "730.01", "100.001", "NaN", "999999999999999999999999"} {
					withdraw["amount"] = amount
					j.api(t, partner, "POST", "/api/campus/self/withdraw", withdraw, false, nil)
				}
				assert.EqualValues(t, 73000, j.overview(t, partner).Available)
			}))

			t.Run("friend_contributions_match_settled_sales_and_hide_private_identity", func(t *testing.T) {
				var history struct {
					Total int64                    `json:"total"`
					Items []model.CampusInvitation `json:"items"`
				}
				j.api(t, partner, "GET", "/api/campus/self/records/invitations?page=1&size=1", nil, true, &history)
				require.EqualValues(t, 1, history.Total)
				require.Len(t, history.Items, 1)
				assert.Equal(t, buyer.id, history.Items[0].UserID)
				assert.Equal(t, "j**", history.Items[0].MaskedName)
				assert.EqualValues(t, 250000, history.Items[0].Paid)
				assert.EqualValues(t, 73000, history.Items[0].Commission)
				j.api(t, partner, "GET", "/api/campus/self/records/invitations?page=2&size=1", nil, true, &history)
				assert.EqualValues(t, 1, history.Total)
				assert.Empty(t, history.Items)
				j.api(t, partner, "GET", "/api/campus/self/records/invitations?size=101", nil, false, nil)
				var adminHistory struct {
					Total int64                         `json:"total"`
					Items []model.CampusAdminInvitation `json:"items"`
				}
				adminPath := fmt.Sprintf("/api/campus/admin/records/invitations?inviter=%%23%d&invitee=%%23%d", partner.id, buyer.id)
				j.api(t, j.admin, "GET", adminPath, nil, true, &adminHistory)
				require.EqualValues(t, 1, adminHistory.Total)
				require.Len(t, adminHistory.Items, 1)
				assert.Equal(t, partner.id, adminHistory.Items[0].InviterID)
				assert.Equal(t, buyer.id, adminHistory.Items[0].UserID)
				assert.NotEmpty(t, adminHistory.Items[0].Username)
				assert.NotEmpty(t, adminHistory.Items[0].InviterUsername)
				assert.Equal(t, http.StatusForbidden, j.request(partner, "GET", adminPath, nil).Code)
				for _, query := range []string{"start_timestamp=invalid", "start_timestamp=-1", "end_timestamp=253402300800", "start_timestamp=2000&end_timestamp=1000", "inviter=" + strings.Repeat("a", 101)} {
					j.api(t, j.admin, "GET", "/api/campus/admin/records/invitations?"+query, nil, false, nil)
				}
				self := j.request(partner, "GET", "/api/campus/self/records/invitations?admin=true&inviter=999999", nil)
				assert.NotContains(t, self.Body.String(), "inviter_username")
				assert.NotContains(t, self.Body.String(), "display_name")
			})

			require.True(t, t.Run("concurrent_withdrawals_idempotency_and_review_states", func(t *testing.T) {
				start := make(chan struct{})
				results := make(chan *httptest.ResponseRecorder, 2)
				var wg sync.WaitGroup
				for i := range 2 {
					body := gin.H{"request_id": fmt.Sprintf("parallel-withdraw-%d", i), "amount": "600", "account": "cash@example.test", "name": "Test payee"}
					wg.Go(func() { <-start; results <- j.request(partner, "POST", "/api/campus/self/withdraw", body) })
				}
				close(start)
				wg.Wait()
				close(results)
				var withdrawal model.CampusWithdrawal
				successes := 0
				for response := range results {
					var result campusResponse
					require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
					if result.Success {
						successes++
						require.NoError(t, common.Unmarshal(result.Data, &withdrawal))
					}
				}
				require.Equal(t, 1, successes)
				body := gin.H{"request_id": withdrawal.RequestID, "amount": "600", "account": "cash@example.test", "name": "Test payee"}
				var replay model.CampusWithdrawal
				j.api(t, partner, "POST", "/api/campus/self/withdraw", body, true, &replay)
				assert.Equal(t, withdrawal.ID, replay.ID)
				body["amount"] = "100"
				j.api(t, partner, "POST", "/api/campus/self/withdraw", body, false, nil)
				path := fmt.Sprintf("/api/campus/admin/withdrawals/%d", withdrawal.ID)
				assert.Equal(t, 403, j.request(buyer, "POST", path, gin.H{"action": "approve"}).Code)
				j.api(t, j.admin, "POST", path, gin.H{"action": "paid", "receipt": "premature", "paid_at": time.Now().Unix()}, false, nil)
				j.api(t, j.admin, "POST", path, gin.H{"action": "failed"}, false, nil)
				assert.EqualValues(t, 60000, j.overview(t, partner).Processing)
				// Listing an overdue request must not mutate any batch or reason.
				require.NoError(t, j.db.Model(&withdrawal).Updates(map[string]any{"batch": "2020-01-31", "reason": "keep review note"}).Error)
				var filtered struct {
					Total int64                    `json:"total"`
					Items []model.CampusWithdrawal `json:"items"`
				}
				query := fmt.Sprintf("/api/campus/admin/records/withdrawals?status=pending&user=%%23%d&start_timestamp=%d&end_timestamp=%d&page=1&size=1", partner.id, withdrawal.CreatedAt, withdrawal.CreatedAt)
				j.api(t, j.admin, "GET", query, nil, true, &filtered)
				require.EqualValues(t, 1, filtered.Total)
				require.Len(t, filtered.Items, 1)
				assert.Equal(t, withdrawal.ID, filtered.Items[0].ID)
				require.NoError(t, j.db.First(&withdrawal, withdrawal.ID).Error)
				assert.Equal(t, "2020-01-31", withdrawal.Batch)
				assert.Equal(t, "keep review note", withdrawal.Reason)
				for _, invalid := range []string{"status=invalid", "start_timestamp=-1", "start_timestamp=2&end_timestamp=1", "user=" + strings.Repeat("a", 101)} {
					j.api(t, j.admin, "GET", "/api/campus/admin/records/withdrawals?"+invalid, nil, false, nil)
				}
				j.api(t, j.admin, "POST", path, gin.H{"action": "pause", "reason": "verify recipient"}, true, nil)
				j.api(t, j.admin, "POST", path, gin.H{"action": "failed"}, false, nil)
				assert.EqualValues(t, 60000, j.overview(t, partner).Processing)

				j.api(t, j.admin, "POST", path, gin.H{"action": "resume", "reason": "recipient confirmed"}, true, nil)
				require.NoError(t, j.db.Model(&withdrawal).Update("batch", "2020-01-31").Error)
				j.api(t, j.admin, "POST", path, gin.H{"action": "approve"}, true, nil)
				require.NoError(t, j.db.First(&withdrawal, withdrawal.ID).Error)
				assert.NotEqual(t, "2020-01-31", withdrawal.Batch, "approval advances overdue batches before maintenance runs")
				j.api(t, j.admin, "POST", path, gin.H{"action": "unknown", "reason": "provider result pending"}, true, nil)
				j.api(t, j.admin, "POST", path, gin.H{"action": "reject", "reason": "cannot release unknown transfer"}, false, nil)
				assert.EqualValues(t, 60000, j.overview(t, partner).Processing)
				assert.EqualValues(t, 13000, j.overview(t, partner).Available)
				j.api(t, j.admin, "POST", path, gin.H{"action": "failed", "reason": "provider confirmed no transfer"}, true, nil)
				assert.Zero(t, j.overview(t, partner).Processing)
				assert.EqualValues(t, 73000, j.overview(t, partner).Available)
			}))

			require.True(t, t.Run("month_end_paid_record_replay_and_private_history", func(t *testing.T) {
				var withdrawal model.CampusWithdrawal
				j.api(t, partner, "POST", "/api/campus/self/withdraw", gin.H{"request_id": "month-end-withdraw-01", "amount": "600", "account": "cash@example.test", "name": "Test payee"}, true, &withdrawal)
				path := fmt.Sprintf("/api/campus/admin/withdrawals/%d", withdrawal.ID)
				j.api(t, j.admin, "POST", path, gin.H{"action": "approve"}, true, nil)
				zone := time.FixedZone("Asia/Shanghai", 8*3600)
				now := time.Now().In(zone)
				monthEnd := time.Date(now.Year(), now.Month(), 0, 12, 0, 0, 0, zone)
				// Make this temporary withdrawal an approved previous-month batch.
				require.NoError(t, j.db.Model(&withdrawal).Updates(map[string]any{"created_at": monthEnd.AddDate(0, 0, -10).Unix(), "batch": monthEnd.Format(time.DateOnly)}).Error)
				body := gin.H{"action": "paid", "receipt": "journey-payout-01", "paid_at": monthEnd.Unix()}
				j.api(t, j.admin, "POST", path, body, true, nil)
				j.api(t, j.admin, "POST", path, body, true, nil)
				body["receipt"] = "conflicting-receipt"
				j.api(t, j.admin, "POST", path, body, false, nil)
				overview := j.overview(t, partner)
				assert.EqualValues(t, 60000, overview.Paid)
				assert.EqualValues(t, 13000, overview.Available)
				assert.Zero(t, overview.Processing)
				assert.Equal(t, overview.Net, overview.Paid+overview.Available+overview.Frozen+overview.Processing)
				var history struct {
					Total int64                    `json:"total"`
					Items []model.CampusWithdrawal `json:"items"`
				}
				j.api(t, partner, "GET", "/api/campus/self/records/withdrawals", nil, true, &history)
				assert.EqualValues(t, 2, history.Total)
				for _, row := range history.Items {
					assert.Equal(t, "T*********", row.RealName)
					assert.NotContains(t, row.Account, "cash@")
				}
				j.api(t, stranger, "GET", fmt.Sprintf("/api/campus/self/records/withdrawals?user_id=%d", partner.id), nil, true, &history)
				assert.Zero(t, history.Total)
			}))

			t.Run("invalid_registration_leaves_no_user_or_binding", func(t *testing.T) {
				for _, invalid := range []string{"BAD", "ABC!23", "ZZZZZZ"} {
					email := "invalid-signup@example.test"
					verification := common.GetRandomString(12)
					common.RegisterVerificationCodeWithKey(email, verification, common.EmailVerificationPurpose)
					j.api(t, campusClient{}, "POST", "/api/user/register", gin.H{"username": "invalid-signup", "password": j.password, "email": email, "verification_code": verification, "campus_code": invalid}, false, nil)
				}
				var count int64
				require.NoError(t, j.db.Model(&model.User{}).Where("username = ?", "invalid-signup").Count(&count).Error)
				assert.Zero(t, count)
				j.api(t, buyer, "POST", "/api/campus/self/coupon/resume", gin.H{}, false, nil)
				response := j.request(buyer, "POST", "/api/user/pay", gin.H{"amount": 100, "payment_method": "alipay", "campus_coupon": true})
				var result campusResponse
				require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
				assert.NotEqual(t, "success", result.Message)
			})

			t.Run("closed_unpaid_order_releases_coupon_and_rejects_late_payment", func(t *testing.T) {
				client := j.register(t, "coupon-close", member.Code)
				order := j.checkout(t, client, 100, true)
				j.api(t, stranger, "POST", "/api/campus/self/coupon/resume", gin.H{"user_id": client.id}, false, nil)
				before := j.overview(t, partner).Net
				j.api(t, j.admin, "POST", "/api/campus/admin/reconcile", gin.H{"trade_no": order.TradeNo, "result": "closed", "evidence": "isolated provider confirmed unpaid and closed"}, true, nil)
				assert.Equal(t, "available", j.overview(t, client).Member.CouponState)
				response := j.request(campusClient{}, "POST", "/api/user/epay/notify", j.proof(order.TradeNo, "late-closed", "95.00", nil))
				assert.Equal(t, "fail", response.Body.String())
				assert.Zero(t, j.wallet(t, client))
				assert.Equal(t, before, j.overview(t, partner).Net)
				retry := j.checkout(t, client, 100, true)
				assert.NotEqual(t, order.TradeNo, retry.TradeNo)
				j.paid(t, retry, "coupon-retry")
				assert.Equal(t, "used", j.overview(t, client).Member.CouponState)
				assert.Equal(t, int(100*common.QuotaPerUnit), j.wallet(t, client))
			})

			t.Run("transaction_failure_rolls_back_credit_and_coupon_then_callback_retry_succeeds", func(t *testing.T) {
				client := j.register(t, "rollback-buyer", member.Code)
				order := j.checkout(t, client, 100, true)
				before := j.overview(t, partner).Net
				const callbackName = "campus_journey_fail_payment"
				require.NoError(t, j.db.Callback().Update().Before("gorm:update").Register(callbackName, func(tx *gorm.DB) {
					if tx.Statement.Table == "campus_payments" {
						tx.AddError(errors.New("injected payment persistence failure"))
					}
				}))
				t.Cleanup(func() { _ = j.db.Callback().Update().Remove(callbackName) })
				response := j.request(campusClient{}, "POST", "/api/user/epay/notify", j.proof(order.TradeNo, "rollback-retry", "95.00", nil))
				assert.Equal(t, "fail", response.Body.String())
				require.NoError(t, j.db.Callback().Update().Remove(callbackName))
				assert.Zero(t, j.wallet(t, client))
				assert.Equal(t, before, j.overview(t, partner).Net)
				assert.Equal(t, "reserved", j.overview(t, client).Member.CouponState)
				var pending model.TopUp
				require.NoError(t, j.db.First(&pending, order.Id).Error)
				assert.Equal(t, common.TopUpStatusPending, pending.Status)
				j.paid(t, order, "rollback-retry")
				assert.Equal(t, int(100*common.QuotaPerUnit), j.wallet(t, client))
				assert.EqualValues(t, before+3325, j.overview(t, partner).Net)
			})

			t.Run("stopped_campaign_preserves_issued_coupon_without_retroactive_commission", func(t *testing.T) {
				client := j.register(t, "paused-buyer", member.Code)
				order := j.checkout(t, client, 100, true)
				before := j.overview(t, partner).Net
				j.api(t, j.admin, "PUT", "/api/campus/admin/config", gin.H{"enabled": false}, true, nil)
				t.Cleanup(func() { require.NoError(t, model.CampusConfigure(true, j.admin.id)) })
				j.api(t, stranger, "POST", "/api/campus/self/join", gin.H{}, false, nil)
				j.api(t, stranger, "POST", "/api/campus/self/bind", gin.H{"code": member.Code}, false, nil)
				j.paid(t, order, "paused-payment")
				assert.Equal(t, "used", j.overview(t, client).Member.CouponState)
				assert.Equal(t, before, j.overview(t, partner).Net)
				j.api(t, j.admin, "PUT", "/api/campus/admin/config", gin.H{"enabled": true}, true, nil)
				j.paid(t, order, "paused-payment")
				assert.Equal(t, before, j.overview(t, partner).Net)
				next := j.checkout(t, client, 100, false)
				j.paid(t, next, "reopened-payment")
				assert.EqualValues(t, before+3500, j.overview(t, partner).Net)
			})

			t.Run("administrator_scope_origin_guard_and_disabled_account", func(t *testing.T) {
				staff := j.register(t, "read-only-staff", "")
				require.NoError(t, j.db.Model(&model.User{}).Where("id = ?", staff.id).Update("role", common.RoleAdminUser).Error)
				require.NoError(t, authz.SetUserPermissions(staff.id, authz.PermissionsMap{authz.CampusRead.Resource: {"read": true, "write": false}}))
				j.api(t, staff, "GET", "/api/campus/admin/config", nil, true, nil)
				j.api(t, staff, "GET", "/api/campus/admin/records/invitations", nil, true, nil)
				assert.Equal(t, 403, j.request(staff, "PUT", "/api/campus/admin/config", gin.H{"enabled": false}).Code)
				req := httptest.NewRequest("POST", "https://beiapi.cn/api/campus/self/join", strings.NewReader("{}"))
				req.Header.Set("Authorization", "Bearer "+stranger.token)
				req.Header.Set("X-Auth-Session", stranger.sid)
				req.Header.Set("Origin", "https://untrusted.example.test")
				response := httptest.NewRecorder()
				j.engine.ServeHTTP(response, req)
				assert.Equal(t, 403, response.Code)
				require.NoError(t, j.db.Model(&model.User{}).Where("id = ?", staff.id).Update("status", common.UserStatusDisabled).Error)
				assert.Equal(t, 401, j.request(staff, "GET", "/api/campus/self", nil).Code)
			})

			t.Run("concurrent_rule_edits_and_order_commission_snapshot", func(t *testing.T) {
				client := j.register(t, "rules-buyer", member.Code)
				order := j.checkout(t, client, 100, false)
				start := make(chan struct{})
				results := make(chan *httptest.ResponseRecorder, 2)
				var wg sync.WaitGroup
				for _, rate := range []int64{1000, 2000} {
					body := gin.H{"tier_revision": 0, "tiers": []cp.TierRule{{Floor: 0, RateBPS: rate}}}
					wg.Go(func() { <-start; results <- j.request(j.admin, "PUT", "/api/campus/admin/tiers", body) })
				}
				close(start)
				wg.Wait()
				close(results)
				successes := 0
				for response := range results {
					var result campusResponse
					require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
					if result.Success {
						successes++
					}
				}
				require.Equal(t, 1, successes)
				overview := j.overview(t, partner)
				j.paid(t, order, "rule-snapshot")
				var settled model.CampusPayment
				require.NoError(t, j.db.Where("trade_no = ?", order.TradeNo).First(&settled).Error)
				assert.EqualValues(t, overview.Tiers[0].RateBPS, settled.Commission) // CNY 100 * configured rate.
				j.api(t, j.admin, "PUT", "/api/campus/admin/tiers", gin.H{"tier_revision": 1, "tiers": []cp.TierRule{{Floor: 0, RateBPS: 3325}}}, true, nil)
				j.paid(t, order, "rule-snapshot")
				var replay model.CampusPayment
				require.NoError(t, j.db.First(&replay, settled.ID).Error)
				assert.Equal(t, settled.Commission, replay.Commission)
				assert.Equal(t, settled.RuleVersion, replay.RuleVersion)
				assert.Equal(t, settled.Segments, replay.Segments)
			})
		})
	}
}

func TestCampusPublicStatus(t *testing.T) {
	j := newCampusJourney(t, "sqlite")
	for _, enabled := range []bool{true, false} {
		require.NoError(t, model.CampusConfigure(enabled, j.admin.id))
		req := httptest.NewRequest(http.MethodGet, "https://www.beiapi.cn/api/campus/status", nil)
		recorder := httptest.NewRecorder()
		j.engine.ServeHTTP(recorder, req)
		require.Equal(t, http.StatusOK, recorder.Code)
		var response struct {
			Success bool           `json:"success"`
			Data    map[string]any `json:"data"`
		}
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
		assert.True(t, response.Success)
		assert.Equal(t, map[string]any{"enabled": enabled}, response.Data)
	}
	req := httptest.NewRequest(http.MethodGet, "https://novapi.cn/api/campus/status", nil)
	recorder := httptest.NewRecorder()
	j.engine.ServeHTTP(recorder, req)
	assert.Equal(t, http.StatusOK, recorder.Code)
}
