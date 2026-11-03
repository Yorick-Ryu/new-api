package model

import (
	"bytes"
	"crypto/rand"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	cp "github.com/QuantumNous/new-api/pkg/campuspartner"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestCampusDatabase(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(t.TempDir() + "/campus.db?_pragma=busy_timeout(30000)&_pragma=journal_mode(WAL)&_txlock=immediate")
			case "mysql":
				dsn := os.Getenv("TEST_MYSQL_DSN")
				if dsn == "" {
					t.Skip("TEST_MYSQL_DSN not configured")
				}
				driver = mysql.Open(dsn)
			case "postgres":
				dsn := os.Getenv("TEST_POSTGRES_DSN")
				if dsn == "" {
					t.Skip("TEST_POSTGRES_DSN not configured")
				}
				driver = postgres.Open(dsn)
			}
			db, err := gorm.Open(driver, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
			require.NoError(t, err)
			var version string
			query := "SELECT VERSION()"
			if dialect == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Logf("database version: %s", version)
			oldDB := DB
			oldMain, oldLog := common.MainDatabaseType(), common.LogDatabaseType()
			databaseType := common.DatabaseTypeSQLite
			if dialect == "mysql" {
				databaseType = common.DatabaseTypeMySQL
			}
			if dialect == "postgres" {
				databaseType = common.DatabaseTypePostgreSQL
			}
			common.SetDatabaseTypes(databaseType, databaseType)
			DB = db
			t.Cleanup(func() { DB = oldDB; common.SetDatabaseTypes(oldMain, oldLog); sqlDB, _ := db.DB(); _ = sqlDB.Close() })
			tables, err := db.Migrator().GetTables()
			require.NoError(t, err)
			require.Empty(t, tables, "Use an empty disposable database")
			// Existing account/order tables are outside the new campaign.
			require.NoError(t, db.AutoMigrate(&User{}, &TopUp{}, &SubscriptionOrder{}, &SubscriptionPlan{}))
			for i := 1; i <= 8; i++ {
				require.NoError(t, db.Create(&User{Id: i, Username: fmt.Sprintf("campus-%d", i), AffCode: fmt.Sprintf("old-%d", i), Password: "not-a-login-hash", DisplayName: "Campus", Status: common.UserStatusEnabled}).Error)
			}
			require.NoError(t, db.Create(&TopUp{UserId: 8, TradeNo: "historical", Status: common.TopUpStatusSuccess, Money: 10}).Error)
			require.NoError(t, db.Create(&SubscriptionPlan{Id: 6, Title: "Plus", Enabled: true}).Error)
			require.NoError(t, db.Create(&SubscriptionPlan{Id: 7, Title: "Ultra", Enabled: true}).Error)
			require.NoError(t, InitializeCampusPartner(db))
			require.NoError(t, InitializeCampusPartner(db))
			var preserved TopUp
			require.NoError(t, db.Where("trade_no = ?", "historical").First(&preserved).Error)
			assert.Equal(t, 8, preserved.UserId)
			var config CampusCampaign
			require.NoError(t, db.First(&config, 1).Error)
			assert.False(t, config.Enabled)
			_, err = CampusJoin(1)
			assert.ErrorIs(t, err, ErrCampusDisabled)
			require.NoError(t, CampusConfigurePlanRates([]cp.PlanRate{{PlanID: 6, RateBPS: 500}, {PlanID: 7, RateBPS: 1000}}, 0, 1))
			prelaunch := SubscriptionOrder{UserId: 2, PlanId: 6, TradeNo: "pending-subscription", Money: 100, Status: common.TopUpStatusPending}
			require.NoError(t, InsertCampusSubscription(&prelaunch, true, "CNY"))
			require.NoError(t, CampusConfigure(true, 1))
			var first, second *CampusMember
			t.Run("six-character invitations retry collisions and validate the complete code", func(t *testing.T) {
				originalReader := rand.Reader
				rand.Reader = bytes.NewReader([]byte{
					0, 1, 2, 26, 27, 28, // ABC012
					0, 1, 2, 26, 27, 28, // Collides with the first member.
					25, 35, 24, 34, 23, 33, // Z9Y8X7
				})
				t.Cleanup(func() { rand.Reader = originalReader })
				first, err = CampusJoin(1)
				require.NoError(t, err)
				require.Equal(t, "ABC012", first.Code)
				second, err = CampusJoin(2)
				require.NoError(t, err)
				assert.Equal(t, "Z9Y8X7", second.Code)
				repeated, err := CampusJoin(1)
				require.NoError(t, err)
				assert.Equal(t, first.Code, repeated.Code)
				name, err := CampusValidateCode(" abc012 ")
				require.NoError(t, err)
				assert.Equal(t, "C***", name)
				for _, invalid := range []string{"ABCDE", "ABCDEFG", "ABC!12", "ＡBC012", "CP11111111111111111111"} {
					_, err := CampusValidateCode(invalid)
					assert.ErrorIs(t, err, ErrCampusBinding)
					assert.ErrorIs(t, CampusBind(3, invalid), ErrCampusBinding)
				}
			})
			require.NotNil(t, first)
			require.NotNil(t, second)
			require.NoError(t, CampusBind(2, strings.ToLower(first.Code)))
			require.NoError(t, CampusBind(2, first.Code))
			assert.ErrorIs(t, CampusBind(1, second.Code), ErrCampusBinding)
			assert.ErrorIs(t, CampusBind(1, first.Code), ErrCampusBinding)
			assert.ErrorIs(t, CampusBind(8, first.Code), ErrCampusBinding)
			third, err := CampusJoin(3)
			require.NoError(t, err)
			require.NoError(t, CampusBind(3, second.Code))
			assert.ErrorIs(t, CampusBind(1, third.Code), ErrCampusBinding)
			// A single owned coupon is reserved once; denied attempts leave no order.
			order := TopUp{UserId: 2, TradeNo: "coupon", Money: 200, Amount: 200, PaymentProvider: PaymentProviderEpay, Status: common.TopUpStatusPending}
			require.NoError(t, InsertCampusTopUp(&order, true, "CNY", true))
			assert.Equal(t, 190.0, order.Money)
			other := TopUp{UserId: 2, TradeNo: "coupon-again", Money: 200, Status: common.TopUpStatusPending}
			assert.ErrorIs(t, InsertCampusTopUp(&other, true, "CNY", true), ErrCampusCoupon)
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return CampusSettleTx(tx, "coupon", 2) }))
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return CampusSettleTx(tx, "coupon", 2) }))
			overview, err := CampusGetOverview(1)
			require.NoError(t, err)
			assert.Equal(t, cp.Money(5700), overview.Frozen)
			assert.Equal(t, cp.Money(19000), overview.Member.Performance)
			assert.Equal(t, cp.Money(5700), overview.Net)
			// Partial and duplicate refunds, then a full reversal; used coupon stays used.
			preview, err := CampusRegisterRefund("coupon", "refund-1", "confirmed provider refund", 5000, 1, true)
			require.NoError(t, err)
			assert.Equal(t, cp.Money(1500), preview.Reversal)
			var payment CampusPayment
			require.NoError(t, db.Where("trade_no = ?", "coupon").First(&payment).Error)
			assert.Zero(t, payment.Refunded)
			_, err = CampusRegisterRefund("coupon", "refund-1", "confirmed provider refund", 5000, 1, false)
			require.NoError(t, err)
			_, err = CampusRegisterRefund("coupon", "refund-1", "confirmed provider refund", 5000, 1, false)
			require.NoError(t, err)
			_, err = CampusRegisterRefund("coupon", "refund-1", "conflict", 6000, 1, false)
			assert.Error(t, err)
			_, err = CampusRegisterRefund("coupon", "refund-2", "confirmed provider refund", 14000, 1, false)
			require.NoError(t, err)
			overview, err = CampusGetOverview(1)
			require.NoError(t, err)
			assert.Zero(t, overview.Net)
			assert.Zero(t, overview.Member.Performance)
			buyer, err := CampusGetOverview(2)
			require.NoError(t, err)
			assert.Equal(t, "used", buyer.Member.CouponState)
			assert.False(t, buyer.CanBind)
			// Earn, unlock, reserve, adjust on refund, and restore after rejected payout.
			large := TopUp{UserId: 2, TradeNo: "large", Money: 1000, Status: common.TopUpStatusPending}
			require.NoError(t, InsertCampusTopUp(&large, true, "CNY", false))
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return CampusSettleTx(tx, "large", 2) }))
			require.NoError(t, db.Model(&CampusPayment{}).Where("trade_no = ?", "large").Update("settled_at", time.Now().Add(-169*time.Hour).Unix()).Error)
			w, err := CampusRequestWithdrawal(1, "request-0000000001", "alipay@example.test", "Test", 30000)
			require.NoError(t, err)
			adminRows, adminCount, err := CampusList(1, true, "withdrawals", 1, 10)
			require.NoError(t, err)
			require.EqualValues(t, 1, adminCount)
			encodedRows, err := common.Marshal(adminRows)
			require.NoError(t, err)
			var recipients []struct {
				UserID      int    `json:"user_id"`
				Username    string `json:"username"`
				DisplayName string `json:"display_name"`
			}
			require.NoError(t, common.Unmarshal(encodedRows, &recipients))
			require.Len(t, recipients, 1)
			assert.Equal(t, 1, recipients[0].UserID)
			assert.Equal(t, "campus-1", recipients[0].Username)
			assert.Equal(t, "Campus", recipients[0].DisplayName)
			own, ownCount, err := CampusList(1, false, "withdrawals", 1, 10)
			require.NoError(t, err)
			require.EqualValues(t, 1, ownCount)
			ownRows := *own.(*[]CampusWithdrawal)
			require.Equal(t, "a***@example.test", ownRows[0].Account)
			require.Equal(t, "T***", ownRows[0].RealName)
			recipientOverview, err := CampusGetOverview(1)
			require.NoError(t, err)
			require.Equal(t, "alipay@example.test", recipientOverview.WithdrawalAccount)
			require.Equal(t, "Test", recipientOverview.WithdrawalName)
			otherOverview, err := CampusGetOverview(999)
			require.NoError(t, err)
			require.Empty(t, otherOverview.WithdrawalAccount)
			require.Empty(t, otherOverview.WithdrawalName)
			otherWithdrawals, otherCount, err := CampusList(999, false, "withdrawals", 1, 10)
			require.NoError(t, err)
			require.Zero(t, otherCount)
			require.Empty(t, *otherWithdrawals.(*[]CampusWithdrawal))
			again, err := CampusRequestWithdrawal(1, "request-0000000001", "alipay@example.test", "Test", 30000)
			require.NoError(t, err)
			assert.Equal(t, w.ID, again.ID)
			_, err = CampusRequestWithdrawal(1, "request-0000000002", "alipay@example.test", "Test", 10000)
			assert.Error(t, err)
			_, err = CampusRegisterRefund("large", "partial-pending", "confirmed provider refund", 10000, 1, false)
			require.NoError(t, err)
			refundRows, refundCount, err := CampusList(1, true, "refunds", 1, 10)
			require.NoError(t, err)
			require.Positive(t, refundCount)
			encodedRefunds, err := common.Marshal(refundRows)
			require.NoError(t, err)
			var refundUsers []struct {
				TradeNo  string `json:"trade_no"`
				UserID   int    `json:"user_id"`
				Username string `json:"username"`
			}
			require.NoError(t, common.Unmarshal(encodedRefunds, &refundUsers))
			require.NotEmpty(t, refundUsers)
			assert.Equal(t, "large", refundUsers[0].TradeNo)
			var refundedPayment CampusPayment
			require.NoError(t, db.Where("trade_no = ?", "large").First(&refundedPayment).Error)
			assert.Equal(t, refundedPayment.UserID, refundUsers[0].UserID)
			assert.Equal(t, fmt.Sprintf("campus-%d", refundedPayment.UserID), refundUsers[0].Username)
			require.NoError(t, db.First(w, w.ID).Error)
			assert.Equal(t, "paused", w.State)
			assert.Equal(t, cp.Money(27000), w.Amount)
			assert.Error(t, CampusActWithdrawal(w.ID, 1, "paid", "", "receipt", time.Now().Unix()))
			require.NoError(t, CampusActWithdrawal(w.ID, 1, "resume", "review complete", "", 0))
			require.NoError(t, CampusActWithdrawal(w.ID, 1, "reject", "recipient mismatch", "", 0))
			overview, err = CampusGetOverview(1)
			require.NoError(t, err)
			assert.Equal(t, cp.Money(27000), overview.Available)
			assert.Zero(t, overview.Processing)
			// Disabled activity retains withdrawals/coupons, but never counts new sales.
			require.NoError(t, CampusConfigure(false, 1))
			off := TopUp{UserId: 2, TradeNo: "disabled", Money: 1000, Status: common.TopUpStatusPending}
			require.NoError(t, InsertCampusTopUp(&off, true, "CNY", false))
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return CampusSettleTx(tx, "disabled", 2) }))
			require.NoError(t, CampusConfigure(true, 1))
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return CampusSettleTx(tx, "disabled", 2) }))
			overview, err = CampusGetOverview(1)
			require.NoError(t, err)
			assert.Equal(t, cp.Money(90000), overview.Member.Performance)

			// Unknown transfers keep reservations until a definitive result exists.
			uncertain, err := CampusRequestWithdrawal(1, "request-unknown-001", "alipay@example.test", "Test", 27000)
			require.NoError(t, err)
			require.NoError(t, CampusActWithdrawal(uncertain.ID, 1, "approve", "review complete", "", 0))
			require.NoError(t, CampusActWithdrawal(uncertain.ID, 1, "unknown", "provider result delayed", "", 0))
			assert.ErrorIs(t, CampusActWithdrawal(uncertain.ID, 1, "reject", "cannot assume failure", "", 0), ErrCampusState)
			_, err = CampusRegisterRefund("large", "unknown-refund", "confirmed provider refund", 10000, 1, false)
			assert.ErrorIs(t, err, ErrCampusState)
			require.NoError(t, CampusActWithdrawal(uncertain.ID, 1, "failed", "provider confirmed no transfer", "", 0))
			paid, err := CampusRequestWithdrawal(1, "request-paid-00001", "alipay@example.test", "Test", 27000)
			require.NoError(t, err)
			require.NoError(t, CampusActWithdrawal(paid.ID, 1, "approve", "review complete", "", 0))
			zone := time.FixedZone("Asia/Shanghai", 28800)
			clock := time.Now().In(zone)
			lastMonthEnd := time.Date(clock.Year(), clock.Month(), 0, 12, 0, 0, 0, zone)
			require.NoError(t, db.Model(paid).Updates(map[string]any{"batch": lastMonthEnd.Format(time.DateOnly), "created_at": lastMonthEnd.Add(-24 * time.Hour).Unix()}).Error)
			require.NoError(t, CampusAdvanceBatches())
			require.NoError(t, db.First(paid, paid.ID).Error)
			assert.Equal(t, lastMonthEnd.Format(time.DateOnly), paid.Batch, "approved transfers retain the batch when recorded after month end")
			require.NoError(t, CampusActWithdrawal(paid.ID, 1, "paid", "bank transfer checked", "unique-receipt-001", lastMonthEnd.Unix()))
			require.NoError(t, CampusActWithdrawal(paid.ID, 1, "paid", "bank transfer checked", "unique-receipt-001", lastMonthEnd.Unix()))
			_, err = CampusRegisterRefund("large", "paid-full-refund", "confirmed full provider refund", 90000, 1, false)
			require.NoError(t, err)
			overview, err = CampusGetOverview(1)
			require.NoError(t, err)
			assert.EqualValues(t, 27000, overview.Member.Debt)
			assert.EqualValues(t, 27000, overview.Paid)
			assert.Zero(t, overview.Net)
			future := TopUp{UserId: 2, TradeNo: "future-recovery", Money: 100, Status: common.TopUpStatusPending}
			require.NoError(t, InsertCampusTopUp(&future, true, "CNY", false))
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return CampusSettleTx(tx, future.TradeNo, 2) }))
			overview, err = CampusGetOverview(1)
			require.NoError(t, err)
			assert.EqualValues(t, 27000, overview.Member.Debt)
			assert.EqualValues(t, 3000, overview.Frozen)
			require.NoError(t, db.Model(&CampusPayment{}).Where("trade_no = ?", future.TradeNo).Update("settled_at", time.Now().Add(-169*time.Hour).Unix()).Error)
			overview, err = CampusGetOverview(1)
			require.NoError(t, err)
			assert.EqualValues(t, 24000, overview.Member.Debt)
			assert.Zero(t, overview.Available)
			assert.EqualValues(t, 3000, overview.Net) // Recovery is a transfer, not another reversal.
			_, err = CampusRegisterRefund(future.TradeNo, "offset-refund", "confirmed provider refund", 10000, 1, false)
			require.NoError(t, err)
			overview, err = CampusGetOverview(1)
			require.NoError(t, err)
			assert.EqualValues(t, 27000, overview.Member.Debt)
			assert.Zero(t, overview.Net)
			// Refund before first trusted settlement is retained and applied once.
			delayed := TopUp{UserId: 2, TradeNo: "delayed-settlement", Money: 100, Status: common.TopUpStatusPending}
			require.NoError(t, InsertCampusTopUp(&delayed, true, "CNY", false))
			_, err = CampusRegisterRefund(delayed.TradeNo, "early-refund", "confirmed provider refund", 5000, 1, false)
			require.NoError(t, err)
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return CampusSettleTx(tx, delayed.TradeNo, 2) }))
			overview, err = CampusGetOverview(1)
			require.NoError(t, err)
			assert.EqualValues(t, 5000, overview.Member.Performance)
			assert.EqualValues(t, 1500, overview.Net)
			// A final unpaid closure releases a coupon; activity pause does not expire it.
			unpaid := TopUp{UserId: 3, TradeNo: "closed-coupon", Money: 10.10, Status: common.TopUpStatusPending}
			require.NoError(t, InsertCampusTopUp(&unpaid, true, "CNY", true))
			assert.Equal(t, 9.60, unpaid.Money)
			require.NoError(t, CampusConfirmClosedOrder(unpaid.TradeNo, 1, "gateway confirmed unpaid and closed"))
			require.NoError(t, CampusConfigure(false, 1))
			retry := TopUp{UserId: 3, TradeNo: "coupon-while-paused", Money: 10.10, Status: common.TopUpStatusPending}
			require.NoError(t, InsertCampusTopUp(&retry, true, "CNY", true))
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return CampusSettleTx(tx, retry.TradeNo, 3) }))
			secondOverview, err := CampusGetOverview(2)
			require.NoError(t, err)
			assert.Zero(t, secondOverview.Net)
			require.NoError(t, CampusConfigure(true, 1))
			// Concurrent two-way binding can commit at most one edge, including SQLite.
			a, err := CampusJoin(4)
			require.NoError(t, err)
			b, err := CampusJoin(5)
			require.NoError(t, err)
			var wg sync.WaitGroup
			outcomes := make(chan error, 2)
			wg.Go(func() { outcomes <- CampusBind(4, b.Code) })
			wg.Go(func() { outcomes <- CampusBind(5, a.Code) })
			wg.Wait()
			close(outcomes)
			successes := 0
			for err := range outcomes {
				if err == nil {
					successes++
				}
			}
			assert.Equal(t, 1, successes)

			// Competing first settlements share the cumulative tier boundary.
			freshInviter, err := CampusJoin(6)
			require.NoError(t, err)
			require.NoError(t, CampusBind(7, freshInviter.Code))
			for _, trade := range []string{"concurrent-a", "concurrent-b"} {
				require.NoError(t, InsertCampusTopUp(&TopUp{UserId: 7, TradeNo: trade, Money: 1500, Status: common.TopUpStatusPending}, true, "CNY", false))
			}
			settlements := make(chan error, 2)
			for _, trade := range []string{"concurrent-a", "concurrent-b"} {
				wg.Go(func() { settlements <- db.Transaction(func(tx *gorm.DB) error { return CampusSettleTx(tx, trade, 7) }) })
			}
			wg.Wait()
			close(settlements)
			for err := range settlements {
				require.NoError(t, err)
			}
			freshOverview, err := CampusGetOverview(6)
			require.NoError(t, err)
			assert.EqualValues(t, 300000, freshOverview.Member.Performance)
			assert.EqualValues(t, 95000, freshOverview.Net)
			require.NoError(t, db.Model(&CampusPayment{}).Where("inviter_id = ?", 6).Update("settled_at", time.Now().Add(-169*time.Hour).Unix()).Error)
			withdrawals := make(chan error, 2)
			for _, request := range []string{"parallel-withdraw-a", "parallel-withdraw-b"} {
				wg.Go(func() {
					_, err := CampusRequestWithdrawal(6, request, "test@example.test", "Test", 60000)
					withdrawals <- err
				})
			}
			wg.Wait()
			close(withdrawals)
			successes = 0
			for err := range withdrawals {
				if err == nil {
					successes++
				}
			}
			assert.Equal(t, 1, successes)
			freshOverview, err = CampusGetOverview(6)
			require.NoError(t, err)
			assert.EqualValues(t, 60000, freshOverview.Processing)
			assert.EqualValues(t, 35000, freshOverview.Available)
			// Daily reminders are account-level, and accepting survives reopening.
			show, err := CampusReminder(7)
			require.NoError(t, err)
			assert.True(t, show)
			show, err = CampusReminder(7)
			require.NoError(t, err)
			assert.False(t, show)
			_, err = CampusJoin(7)
			require.NoError(t, err)
			require.NoError(t, db.Model(&CampusMember{}).Where("user_id = ?", 7).Update("reminder_day", "2020-01-01").Error)
			require.NoError(t, CampusConfigure(false, 1))
			require.NoError(t, CampusConfigure(true, 1))
			show, err = CampusReminder(7)
			require.NoError(t, err)
			assert.False(t, show)
			_, count, err := CampusList(7, false, "withdrawals", 1, 10)
			require.NoError(t, err)
			assert.Zero(t, count)
			_, _, err = CampusList(7, false, "refunds", 1, 10)
			assert.Error(t, err)
			require.NoError(t, InitializeCampusPartner(db))
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return CampusSettleTx(tx, prelaunch.TradeNo, 2) }))
			prelaunchSummary, err := CampusGetOverview(1)
			require.NoError(t, err)
			assert.EqualValues(t, 15000, prelaunchSummary.Member.Performance)
			assert.EqualValues(t, 2000, prelaunchSummary.Net)
			var final CampusMember
			require.NoError(t, db.First(&final, "user_id = ?", 2).Error)
			assert.Equal(t, 1, final.InviterID)
			assert.Equal(t, "used", final.CouponState)
			// Saved tiers affect first settlements only; replay and refunds retain snapshots.
			var historicalCommission CampusPayment
			require.NoError(t, db.Where("trade_no = ?", "concurrent-a").First(&historicalCommission).Error)
			require.NoError(t, InsertCampusTopUp(&TopUp{UserId: 7, TradeNo: "custom-tiers", Money: 200, Status: common.TopUpStatusPending}, true, "CNY", false))
			custom := []cp.TierRule{{Name: "校园新星", Floor: 0, RateBPS: 1250}, {Name: "进阶合伙人", Floor: 310000, RateBPS: 3325}}
			require.NoError(t, CampusConfigureTiers(custom, 0, 1))
			assert.Error(t, CampusConfigureTiers(custom, 0, 1), "stale writes must not overwrite newer tiers")
			assert.Error(t, CampusConfigureTiers([]cp.TierRule{}, 1, 1))
			assert.Error(t, CampusConfigureTiers([]cp.TierRule{{Floor: 1, RateBPS: 100}}, 1, 1))
			savedConfig, err := CampusGetConfig()
			require.NoError(t, err)
			assert.Equal(t, custom, savedConfig.Tiers)
			assert.EqualValues(t, 1, savedConfig.TierRevision)
			require.NoError(t, InitializeCampusPartner(db))
			require.NoError(t, InitializeCampusPartner(db))
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return CampusSettleTx(tx, "custom-tiers", 7) }))
			var customPayment CampusPayment
			require.NoError(t, db.Where("trade_no = ?", "custom-tiers").First(&customPayment).Error)
			assert.EqualValues(t, 4575, customPayment.Commission)
			assert.Equal(t, cp.RuleVersion+"-tiers-1-plans-1", customPayment.RuleVersion)
			customOverview, err := CampusGetOverview(6)
			require.NoError(t, err)
			assert.Equal(t, custom, customOverview.Tiers)
			assert.Equal(t, 33.25, customOverview.Tier.RatePercent)
			// Two editors using the same revision cannot silently overwrite one another.
			updates := make(chan error, 2)
			for _, bps := range []int64{2500, 5000} {
				wg.Go(func() { updates <- CampusConfigureTiers([]cp.TierRule{{Floor: 0, RateBPS: bps}}, 1, 1) })
			}
			wg.Wait()
			close(updates)
			successes = 0
			for err := range updates {
				if err == nil {
					successes++
				}
			}
			assert.Equal(t, 1, successes)
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return CampusSettleTx(tx, "custom-tiers", 7) }))
			var replay CampusPayment
			require.NoError(t, db.First(&replay, customPayment.ID).Error)
			assert.Equal(t, customPayment.Commission, replay.Commission)
			assert.Equal(t, customPayment.Segments, replay.Segments)
			assert.Equal(t, customPayment.RuleVersion, replay.RuleVersion)
			replay = CampusPayment{}
			require.NoError(t, db.First(&replay, historicalCommission.ID).Error)
			assert.Equal(t, historicalCommission.Commission, replay.Commission)
			assert.Equal(t, historicalCommission.Segments, replay.Segments)
			refundAfterChange, err := CampusRegisterRefund("custom-tiers", "custom-tier-full-refund", "isolated test", 20000, 1, false)
			require.NoError(t, err)
			assert.EqualValues(t, 4575, refundAfterChange.Reversal)
			require.NoError(t, db.Create(&SubscriptionPlan{Id: 8, Title: "Custom", Enabled: true}).Error)
			plans := []cp.PlanRate{{PlanID: 6, RateBPS: 1234}, {PlanID: 7, RateBPS: 0}, {PlanID: 8, RateBPS: 2500}}
			require.NoError(t, CampusConfigurePlanRates(plans, 1, 1))
			assert.Error(t, CampusConfigurePlanRates(plans, 1, 1))
			assert.Error(t, CampusConfigurePlanRates([]cp.PlanRate{{PlanID: 99999, RateBPS: 10}}, 2, 1))
			assert.Error(t, CampusConfigurePlanRates([]cp.PlanRate{{PlanID: 6, RateBPS: 10001}}, 2, 1))
			assert.Error(t, CampusConfigurePlanRates([]cp.PlanRate{{PlanID: 6}, {PlanID: 6}}, 2, 1))
			require.NoError(t, InsertCampusSubscription(&SubscriptionOrder{UserId: 7, PlanId: 6, TradeNo: "custom-plan", Money: 100, Status: common.TopUpStatusPending}, true, "CNY"))
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return CampusSettleTx(tx, "custom-plan", 7) }))
			var planPayment CampusPayment
			require.NoError(t, db.Where("trade_no = ?", "custom-plan").First(&planPayment).Error)
			assert.EqualValues(t, 1234, planPayment.Commission)
			require.NoError(t, InsertCampusSubscription(&SubscriptionOrder{UserId: 7, PlanId: 8, TradeNo: "new-custom-plan", Money: 100, Status: common.TopUpStatusPending}, true, "CNY"))
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return CampusSettleTx(tx, "new-custom-plan", 7) }))
			var arbitraryPlan CampusPayment
			require.NoError(t, db.Where("trade_no = ?", "new-custom-plan").First(&arbitraryPlan).Error)
			assert.EqualValues(t, 2500, arbitraryPlan.Commission)
			assert.Equal(t, cp.Subscription, arbitraryPlan.Product)
			require.NoError(t, CampusConfigurePlanRates([]cp.PlanRate{}, 2, 1))
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return CampusSettleTx(tx, "custom-plan", 7) }))
			refundPlan, err := CampusRegisterRefund("custom-plan", "plan-refund-after-removal", "isolated test", 10000, 1, false)
			require.NoError(t, err)
			assert.EqualValues(t, 1234, refundPlan.Reversal)
			require.NoError(t, InitializeCampusPartner(db))
			finalConfig, err := CampusGetConfig()
			require.NoError(t, err)
			assert.Empty(t, finalConfig.PlanRates)
			assert.EqualValues(t, 3, finalConfig.PlanRevision)

			assert.False(t, db.Migrator().HasTable("campus_entries"))
			_, _, err = CampusList(1, true, "entries", 1, 10)
			assert.ErrorIs(t, err, ErrCampusState)

			t.Run("invitation history masks names and isolates net contributions with pagination", func(t *testing.T) {
				for _, user := range []User{
					{Id: 101, Username: "partner-alice", DisplayName: "邀请人甲", CreatedAt: 700},
					{Id: 102, Username: "partner-bob", DisplayName: "邀请人乙", CreatedAt: 700},
					{Id: 201, Username: "lin-private", DisplayName: "林小明", CreatedAt: 800},
					{Id: 202, Username: "chen-private%_!", CreatedAt: 900},
					{Id: 203, Username: "other-partner", DisplayName: "Other", CreatedAt: 1000},
					{Id: 204, Username: "deleted-friend", DisplayName: "Deleted", CreatedAt: 1100},
				} {
					user.AffCode = fmt.Sprintf("query-%d", user.Id)
					require.NoError(t, db.Create(&user).Error)
				}
				require.NoError(t, db.Delete(&User{}, 204).Error)
				require.NoError(t, db.Create(&[]CampusMember{
					{UserID: 201, Code: "QRY201", InviterID: 101, BoundAt: 2000},
					{UserID: 202, Code: "QRY202", InviterID: 101, BoundAt: 1000},
					{UserID: 203, Code: "QRY203", InviterID: 102, BoundAt: 3000},
					{UserID: 204, Code: "QRY204", InviterID: 101, BoundAt: 500},
				}).Error)
				require.NoError(t, db.Create(&[]CampusPayment{
					{TradeNo: "query-topup", UserID: 201, InviterID: 101, Product: cp.TopUp, Eligibility: string(cp.Eligible), SettledAt: 2100, Paid: 10000, Refunded: 2000, Commission: 3000, Reversed: 600},
					{TradeNo: "query-subscription", UserID: 201, InviterID: 101, Product: cp.Subscription, Eligibility: string(cp.Eligible), SettledAt: 2200, Paid: 5000, Commission: 500},
					{TradeNo: "query-full-refund", UserID: 201, InviterID: 101, Eligibility: string(cp.Eligible), SettledAt: 2300, Paid: 1000, Refunded: 1000, Commission: 300, Reversed: 300},
					{TradeNo: "query-pending", UserID: 201, InviterID: 101, Eligibility: string(cp.Eligible), Paid: 99999},
					{TradeNo: "query-ineligible", UserID: 201, InviterID: 101, Eligibility: "ineligible", SettledAt: 2400, Paid: 50000},
					{TradeNo: "query-other-inviter", UserID: 201, InviterID: 102, Eligibility: string(cp.Eligible), SettledAt: 2500, Paid: 20000, Commission: 6000},
					{TradeNo: "query-other-friend", UserID: 203, InviterID: 102, Eligibility: string(cp.Eligible), SettledAt: 3100, Paid: 30000, Commission: 9000},
				}).Error)

				result, total, err := CampusList(101, false, "invitations", 1, 1)
				require.NoError(t, err)
				assert.EqualValues(t, 3, total)
				rows := *result.(*[]CampusInvitation)
				require.Len(t, rows, 1)
				assert.Equal(t, CampusInvitation{UserID: 201, BoundAt: 2000, MaskedName: "林**", RegisteredAt: 800, Paid: 13000, Commission: 2900}, rows[0])
				encoded, err := common.Marshal(result)
				require.NoError(t, err)
				assert.NotContains(t, string(encoded), "林小明")
				assert.NotContains(t, string(encoded), "lin-private")
				assert.NotContains(t, string(encoded), "inviter_username")
				assert.NotContains(t, string(encoded), "display_name")

				result, total, err = CampusList(101, false, "invitations", 2, 1)
				require.NoError(t, err)
				assert.EqualValues(t, 3, total)
				rows = *result.(*[]CampusInvitation)
				require.Len(t, rows, 1)
				assert.Equal(t, CampusInvitation{UserID: 202, BoundAt: 1000, MaskedName: "c**", RegisteredAt: 900}, rows[0])

				result, _, err = CampusList(101, false, "invitations", 3, 1)
				require.NoError(t, err)
				rows = *result.(*[]CampusInvitation)
				require.Len(t, rows, 1)
				assert.Equal(t, CampusInvitation{UserID: 204, BoundAt: 500, MaskedName: "***"}, rows[0])

				result, total, err = CampusList(999, false, "invitations", 1, 10)
				require.NoError(t, err)
				assert.Zero(t, total)
				assert.Empty(t, *result.(*[]CampusInvitation))
				result, _, err = CampusList(0, true, "invitations", 1, 100)
				require.NoError(t, err)
				assert.Contains(t, *result.(*[]CampusAdminInvitation), CampusAdminInvitation{UserID: 203, Username: "other-partner", DisplayName: "Other", InviterID: 102, InviterUsername: "partner-bob", InviterDisplayName: "邀请人乙", BoundAt: 3000, RegisteredAt: 1000, Paid: 30000, Commission: 9000})

				paymentRows, paymentTotal, err := CampusList(101, false, "payments", 1, 100)
				require.NoError(t, err)
				assert.EqualValues(t, 4, paymentTotal)
				encodedPayments, err := common.Marshal(paymentRows)
				require.NoError(t, err)
				assert.Contains(t, string(encodedPayments), `"masked_name":"林**"`)
				assert.Contains(t, string(encodedPayments), `"trade_no":"quer***opup"`)
				assert.NotContains(t, string(encodedPayments), "query-topup")
				assert.NotContains(t, string(encodedPayments), "林小明")
				assert.NotContains(t, string(encodedPayments), "provider_transaction")
				assert.NotContains(t, string(encodedPayments), "query-other-inviter")

				start, end := int64(1000), int64(2000)
				for _, test := range []struct {
					name   string
					filter CampusInvitationFilter
					ids    []int
				}{
					{"inviter username is case insensitive", CampusInvitationFilter{Inviter: "PARTNER-AL"}, []int{201, 202, 204}},
					{"both display names narrow the result", CampusInvitationFilter{Inviter: "邀请人甲", Invitee: "林"}, []int{201}},
					{"IDs match both sides", CampusInvitationFilter{Inviter: "#101", Invitee: "#202"}, []int{202}},
					{"date endpoints include exact binding times", CampusInvitationFilter{Inviter: "101", StartTimestamp: &start, EndTimestamp: &end}, []int{201, 202}},
					{"date range can select one instant", CampusInvitationFilter{Inviter: "101", StartTimestamp: &end, EndTimestamp: &end}, []int{201}},
					{"different inviters cannot match the same invitee", CampusInvitationFilter{Inviter: "partner-alice", Invitee: "other"}, []int{}},
					{"percent is a literal name character", CampusInvitationFilter{Invitee: "%"}, []int{202}},
					{"underscore is a literal name character", CampusInvitationFilter{Invitee: "_"}, []int{202}},
					{"escape character is literal", CampusInvitationFilter{Invitee: "!"}, []int{202}},
					{"query syntax is treated as text", CampusInvitationFilter{Invitee: "' OR 1=1 --"}, []int{}},
					{"deleted accounts retain administrative identity", CampusInvitationFilter{Invitee: "deleted-friend"}, []int{204}},
				} {
					t.Run(test.name, func(t *testing.T) {
						result, total, err := CampusListAdminInvitations(test.filter, 1, 100)
						require.NoError(t, err)
						assert.EqualValues(t, len(test.ids), total)
						ids := []int{}
						for _, row := range *result.(*[]CampusAdminInvitation) {
							ids = append(ids, row.UserID)
						}
						assert.Equal(t, test.ids, ids)
					})
				}
				result, total, err = CampusListAdminInvitations(CampusInvitationFilter{Inviter: "101"}, 2, 1)
				require.NoError(t, err)
				assert.EqualValues(t, 3, total)
				adminRows := *result.(*[]CampusAdminInvitation)
				require.Len(t, adminRows, 1)
				assert.Equal(t, 202, adminRows[0].UserID)
				assert.Equal(t, "partner-alice", adminRows[0].InviterUsername)
			})

		})
	}
}

func TestCampusAlipayAccountFormat(t *testing.T) {
	for _, account := range []string{"13800138000", "+85291234567", "person+tag@example.com"} {
		assert.True(t, campusAlipayAccountPattern.MatchString(account), account)
	}
	for _, account := range []string{"123", "name", "name@", "name@example", "name @example.com", "1380013800", "a@@example.com"} {
		assert.False(t, campusAlipayAccountPattern.MatchString(account), account)
		_, err := CampusRequestWithdrawal(1, "format-request-0001", account, "Test", 10000)
		require.Error(t, err)
	}
}

func TestCampusMaskedRealName(t *testing.T) {
	for name, want := range map[string]string{"张三": "张*", "王小明": "王**", "欧阳小明": "欧阳**", "李": "*", "": "*", "  张三  ": "张*"} {
		assert.Equal(t, want, campusMaskedRealName(name))
	}
}

func TestCampusMaskedAlipayAccount(t *testing.T) {
	for account, want := range map[string]string{
		"campus-preview@example.test": "c***@example.test",
		"13800138000":                 "138****8000",
		"+85291234567":                "+85*****4567",
		"a@example.com":               "a***@example.com",
		"":                            "***",
		"short":                       "***",
	} {
		assert.Equal(t, want, campusMaskedAlipayAccount(account))
	}
}
