package model

import (
	"fmt"
	"os"
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
				driver = sqlite.Open(t.TempDir() + "/campus.db?_pragma=busy_timeout(10000)")
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
			oldDB := DB
			DB = db
			t.Cleanup(func() { DB = oldDB; sqlDB, _ := db.DB(); _ = sqlDB.Close() })
			// Representative pre-feature schema and historical successful payment.
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
			require.NoError(t, CampusConfigure(true, 6, 7, 1))
			first, err := CampusJoin(1)
			require.NoError(t, err)
			second, err := CampusJoin(2)
			require.NoError(t, err)
			require.NoError(t, CampusBind(2, first.Code))
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
			again, err := CampusRequestWithdrawal(1, "request-0000000001", "alipay@example.test", "Test", 30000)
			require.NoError(t, err)
			assert.Equal(t, w.ID, again.ID)
			_, err = CampusRequestWithdrawal(1, "request-0000000002", "alipay@example.test", "Test", 10000)
			assert.Error(t, err)
			_, err = CampusRegisterRefund("large", "partial-pending", "confirmed provider refund", 10000, 1, false)
			require.NoError(t, err)
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
			require.NoError(t, CampusConfigure(false, 6, 7, 1))
			off := TopUp{UserId: 2, TradeNo: "disabled", Money: 1000, Status: common.TopUpStatusPending}
			require.NoError(t, InsertCampusTopUp(&off, true, "CNY", false))
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return CampusSettleTx(tx, "disabled", 2) }))
			require.NoError(t, CampusConfigure(true, 6, 7, 1))
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
			require.NoError(t, CampusConfigure(false, 6, 7, 1))
			retry := TopUp{UserId: 3, TradeNo: "coupon-while-paused", Money: 10.10, Status: common.TopUpStatusPending}
			require.NoError(t, InsertCampusTopUp(&retry, true, "CNY", true))
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return CampusSettleTx(tx, retry.TradeNo, 3) }))
			secondOverview, err := CampusGetOverview(2)
			require.NoError(t, err)
			assert.Zero(t, secondOverview.Net)
			require.NoError(t, CampusConfigure(true, 6, 7, 1))
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
			require.NoError(t, InitializeCampusPartner(db))
			var final CampusMember
			require.NoError(t, db.First(&final, "user_id = ?", 2).Error)
			assert.Equal(t, 1, final.InviterID)
			assert.Equal(t, "used", final.CouponState)
		})
	}
}
