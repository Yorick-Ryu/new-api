package campuspartner

import (
	"math"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFirstSettlementEligibility(t *testing.T) {
	start := time.Date(2026, 11, 1, 0, 0, 0, 0, beijing)
	facts := SettlementFacts{
		MainSite: true, ExternalPayment: true, Currency: "CNY", Product: TopUp,
		Paid: 19000, InviterID: 123, BoundAt: start.Add(-time.Hour), FirstSettledAt: start,
	}
	for _, enabled := range []bool{false, true} {
		result, err := SettlementEligibility(facts, enabled)
		require.NoError(t, err)
		want := OutsideActivity
		if enabled {
			want = Eligible
		}
		assert.Equal(t, want, result)
	}
	for _, test := range []struct {
		name   string
		change func(*SettlementFacts)
		want   Eligibility
	}{
		{"another brand or unknown origin", func(f *SettlementFacts) { f.MainSite = false }, OutsideMainSite},
		{"balance or gift", func(f *SettlementFacts) { f.ExternalPayment = false }, NotExternalPayment},
		{"foreign currency", func(f *SettlementFacts) { f.Currency = "USD" }, NotRMB},
		{"unknown currency", func(f *SettlementFacts) { f.Currency = "" }, NotRMB},
		{"unmapped plan", func(f *SettlementFacts) { f.Product = "other" }, UnsupportedProduct},
		{"no inviter", func(f *SettlementFacts) { f.InviterID = 0 }, NoBindingAtSettlement},
		{"binding after settlement", func(f *SettlementFacts) { f.BoundAt = start.Add(time.Nanosecond) }, NoBindingAtSettlement},
		{"binding at settlement", func(f *SettlementFacts) { f.BoundAt = start }, Eligible},
	} {
		t.Run(test.name, func(t *testing.T) {
			input := facts
			test.change(&input)
			result, err := SettlementEligibility(input, true)
			require.NoError(t, err)
			assert.Equal(t, test.want, result)
		})
	}
	invalid := facts
	invalid.FirstSettledAt = time.Time{}
	_, err := SettlementEligibility(invalid, true)
	assert.ErrorIs(t, err, ErrTime)
	for _, paid := range []Money{0, -1, MaxMoney + 1} {
		invalid = facts
		invalid.Paid = paid
		_, err := SettlementEligibility(invalid, true)
		assert.ErrorIs(t, err, ErrAmount)
	}
}

func TestMoneyAndCouponRounding(t *testing.T) {
	for _, value := range []struct {
		input string
		cents Money
	}{
		{"0", 0}, {"0.01", 1}, {"10.1", 1010}, {"100.00", 10000},
		{"90071992547409.91", MaxMoney},
	} {
		t.Run(value.input, func(t *testing.T) {
			amount, err := ParseMoney(value.input)
			require.NoError(t, err)
			assert.Equal(t, value.cents, amount)
			roundTrip, err := ParseMoney(amount.String())
			require.NoError(t, err)
			assert.Equal(t, amount, roundTrip)
		})
	}
	for _, value := range []string{"", " ", " 100", "100 ", "-100", "+100", "1e2", "NaN", "Inf", ".01", "1.", "1.001", "1.2.3", "１００", "90071992547409.92", "9223372036854775807"} {
		_, err := ParseMoney(value)
		assert.ErrorIs(t, err, ErrAmount, value)
	}
	for _, value := range []struct{ before, payable, discount Money }{
		{1010, 960, 50}, {20000, 19000, 1000}, {1, 1, 0},
		{9, 9, 0}, {10, 10, 0}, {11, 10, 1},
	} {
		paid, discount, err := Discount(value.before)
		require.NoError(t, err)
		assert.Equal(t, value.payable, paid)
		assert.Equal(t, value.discount, discount)
	}
	paid, discount, err := Discount(MaxMoney)
	require.NoError(t, err)
	assert.Positive(t, paid)
	assert.Equal(t, MaxMoney, paid+discount)
	for _, value := range []Money{-1, 0, MaxMoney + 1, math.MaxInt64} {
		_, _, err := Discount(value)
		assert.ErrorIs(t, err, ErrAmount)
	}
}

func TestCommissionExamplesAndExactRounding(t *testing.T) {
	for _, test := range []struct {
		name        string
		prior, paid Money
		product     Product
		want        Money
		segments    []Segment
	}{
		{"first threshold", 180000, 50000, TopUp, 16500, []Segment{{20000, 30}, {30000, 35}}},
		{"second threshold", 990000, 40000, TopUp, 15500, []Segment{{10000, 35}, {30000, 40}}},
		{"all thresholds", 0, 8000100, TopUp, 3390050, []Segment{{200000, 30}, {800000, 35}, {2000000, 40}, {5000000, 45}, {100, 50}}},
		{"discounted actual cash", 0, 19000, TopUp, 5700, []Segment{{19000, 30}}},
		{"round once across segments", 199999, 1 + 1, TopUp, 1, []Segment{{1, 30}, {1, 35}}},
		{"below half cent", 0, 1, TopUp, 0, []Segment{{1, 30}}},
		{"exact half cent", 0, 5, TopUp, 2, []Segment{{5, 30}}},
		{"highest tier half cent", 8000000, 1, TopUp, 1, []Segment{{1, 50}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			result, err := CalculateCommission(test.prior, test.paid, test.product, DefaultTiers())
			require.NoError(t, err)
			assert.Equal(t, RuleVersion, result.RuleVersion)
			assert.Equal(t, test.want, result.Amount)
			assert.Equal(t, test.prior, result.PerformanceBefore)
			assert.Equal(t, test.paid, result.Paid)
			assert.Equal(t, test.segments, result.Segments)
		})
	}
	for _, test := range []struct {
		prior, paid Money
		product     Product
	}{
		{-1, 1, TopUp}, {0, 0, TopUp}, {0, -1, TopUp},
		{MaxMoney, 1, TopUp}, {0, MaxMoney + 1, TopUp}, {0, 100, "unknown"},
	} {
		_, err := CalculateCommission(test.prior, test.paid, test.product, DefaultTiers())
		assert.Error(t, err)
	}
	result, err := CalculateCommission(0, MaxMoney, TopUp, DefaultTiers())
	require.NoError(t, err)
	assert.True(t, result.Amount.Valid())
	assert.LessOrEqual(t, result.Amount, MaxMoney/2+1)
}

func TestTierBoundaries(t *testing.T) {
	thresholds := []Money{200000, 1000000, 3000000, 8000000}
	for index, threshold := range thresholds {
		for _, delta := range []Money{-1, 0, 1} {
			tier, err := CurrentTier(threshold+delta, DefaultTiers())
			require.NoError(t, err)
			level := index + 2
			if delta < 0 {
				level--
			}
			assert.Equal(t, level, tier.Level)
			assert.Equal(t, float64(25+level*5), tier.RatePercent)
			if level == 5 {
				assert.Zero(t, tier.Next)
				assert.Zero(t, tier.Remaining)
			} else {
				assert.Equal(t, tier.Next-threshold-delta, tier.Remaining)
			}
		}
	}
	_, err := CurrentTier(-1, DefaultTiers())
	assert.ErrorIs(t, err, ErrAmount)
}

func TestRefundCumulativeRoundingAndHistoricalRates(t *testing.T) {
	var previous, reversed Money
	for _, test := range []struct{ cumulative, reversal Money }{{5000, 1500}, {10000, 1500}, {10000, 0}, {20000, 3000}} {
		refund, err := CalculateRefund(20000, 6000, previous, test.cumulative)
		require.NoError(t, err)
		assert.Equal(t, test.reversal, refund.CommissionReversal)
		assert.Equal(t, test.cumulative-previous, refund.PerformanceReduction)
		reversed += refund.CommissionReversal
		assert.Equal(t, reversed, refund.CumulativeReversal)
		previous = test.cumulative
	}
	assert.Equal(t, Money(6000), reversed)
	// Splitting a 5-cent payment with 2 cents commission must not round every
	// individual refund independently. The full refund exactly reverses 2 cents.
	previous, reversed = 0, 0
	for cumulative := Money(1); cumulative <= 5; cumulative++ {
		refund, err := CalculateRefund(5, 2, previous, cumulative)
		require.NoError(t, err)
		reversed += refund.CommissionReversal
		previous = cumulative
	}
	assert.Equal(t, Money(2), reversed)
	refund, err := CalculateRefund(2, 1, 0, 1)
	require.NoError(t, err)
	assert.Equal(t, Money(1), refund.CommissionReversal, "exact half cent rounds up")
	refund, err = CalculateRefund(MaxMoney, MaxMoney/2, MaxMoney-1, MaxMoney)
	require.NoError(t, err)
	assert.Equal(t, MaxMoney/2, refund.CumulativeReversal, "large valid amounts do not overflow")
	// Accepted PRD example: refunding the first purchase changes future tiers,
	// but does not reprice a later commission earned at a higher tier.
	first, err := CalculateCommission(0, 200000, TopUp, DefaultTiers())
	require.NoError(t, err)
	second, err := CalculateCommission(200000, 800000, TopUp, DefaultTiers())
	require.NoError(t, err)
	refund, err = CalculateRefund(first.Paid, first.Amount, 0, first.Paid)
	require.NoError(t, err)
	assert.Equal(t, Money(280000), first.Amount+second.Amount-refund.CommissionReversal)
	fromZero, err := CalculateCommission(0, 800000, TopUp, DefaultTiers())
	require.NoError(t, err)
	assert.Equal(t, Money(270000), fromZero.Amount)
	for _, test := range []struct{ paid, commission, prior, cumulative Money }{
		{0, 0, 0, 0}, {100, 101, 0, 1}, {100, 30, -1, 1},
		{100, 30, 50, 49}, {100, 30, 0, 101}, {MaxMoney + 1, 1, 0, 1},
	} {
		_, err := CalculateRefund(test.paid, test.commission, test.prior, test.cumulative)
		assert.ErrorIs(t, err, ErrAmount)
	}
}

func TestRefundFundingAndDebtRelease(t *testing.T) {
	for _, test := range []struct {
		name       string
		allocation RefundAllocation
		reversal   Money
		want       RefundFunding
	}{
		{"frozen", RefundAllocation{Frozen: 6000}, 1500, RefundFunding{DeductFrozen: 1500}},
		{"available", RefundAllocation{Available: 6000}, 6000, RefundFunding{DeductAvailable: 6000}},
		{"pending payout", RefundAllocation{Reserved: 6000}, 1500, RefundFunding{DeductReserved: 1500, PauseWithdrawal: true}},
		{"partial payout", RefundAllocation{Available: 1000, Reserved: 2000, Paid: 3000}, 6000, RefundFunding{DeductAvailable: 1000, DeductReserved: 2000, RecoverSpent: 3000, PauseWithdrawal: true}},
		{"previous debt offset", RefundAllocation{Offset: 3000, Available: 2000}, 5000, RefundFunding{DeductAvailable: 2000, RecoverSpent: 3000}},
	} {
		t.Run(test.name, func(t *testing.T) {
			funding, err := AllocateRefund(test.reversal, test.allocation)
			require.NoError(t, err)
			assert.Equal(t, test.want, funding)
			assert.Equal(t, test.reversal, funding.DeductFrozen+funding.DeductAvailable+funding.DeductReserved+funding.RecoverSpent)
		})
	}
	for _, available := range []Money{0, 1000, 3000, 5000} {
		recovery, err := RecoverSpentCommission(3000, available)
		require.NoError(t, err)
		assert.Equal(t, min(Money(3000), available), recovery.DeductAvailable)
		assert.Equal(t, max(Money(3000)-available, 0), recovery.AddDebt)
		assert.Equal(t, Money(3000), recovery.DeductAvailable+recovery.AddDebt)
	}
	// D02/D09: paid commission refunded; later income is frozen normally then
	// pays off debt. Neither debt collection nor payout reduces net income twice.
	recovery, err := RecoverSpentCommission(3000, 0)
	require.NoError(t, err)
	release, err := ReleaseCommission(5000, recovery.AddDebt)
	require.NoError(t, err)
	assert.Equal(t, Release{OffsetDebt: 3000, AddAvailable: 2000}, release)
	release, err = ReleaseCommission(1000, 3000)
	require.NoError(t, err)
	assert.Equal(t, Release{OffsetDebt: 1000, AddAvailable: 0}, release)
	_, err = AllocateRefund(2, RefundAllocation{Frozen: 1})
	assert.ErrorIs(t, err, ErrState)
	_, err = AllocateRefund(1, RefundAllocation{Paid: MaxMoney, Available: 1})
	assert.ErrorIs(t, err, ErrState)
	_, err = RecoverSpentCommission(-1, 0)
	assert.ErrorIs(t, err, ErrAmount)
	_, err = ReleaseCommission(1, -1)
	assert.ErrorIs(t, err, ErrAmount)
}

func TestFreezeAndWithdrawalDates(t *testing.T) {
	settled := time.Date(2026, 11, 1, 15, 35, 0, 0, beijing)
	unlock, err := UnlockAt(settled)
	require.NoError(t, err)
	assert.Equal(t, time.Date(2026, 11, 8, 15, 35, 0, 0, beijing), unlock)
	assert.Equal(t, 168*time.Hour, unlock.Sub(settled))
	for _, delta := range []time.Duration{-time.Nanosecond, 0, time.Nanosecond} {
		ready, err := CanRelease(settled, unlock.Add(delta))
		require.NoError(t, err)
		assert.Equal(t, delta >= 0, ready)
	}
	for _, test := range []struct{ input, want string }{
		{"2026-11-01T00:00:00+08:00", "2026-11-30"},
		{"2026-11-25T23:59:59.999999999+08:00", "2026-11-30"},
		{"2026-11-26T00:00:00+08:00", "2026-12-31"},
		{"2026-11-25T16:00:00Z", "2026-12-31"},
		{"2026-12-26T00:00:00+08:00", "2027-01-31"},
		{"2027-02-25T12:00:00+08:00", "2027-02-28"},
		{"2028-02-25T12:00:00+08:00", "2028-02-29"},
		{"2026-05-01T12:00:00+08:00", "2026-05-31"}, // Sunday remains Sunday.
	} {
		instant, err := time.Parse(time.RFC3339Nano, test.input)
		require.NoError(t, err)
		batch, err := PayoutBatch(instant)
		require.NoError(t, err)
		assert.Equal(t, test.want, batch.Format(time.DateOnly), test.input)
	}
	november, err := PayoutBatch(settled)
	require.NoError(t, err)
	for _, test := range []struct{ processed, want string }{
		{"2026-11-29", "2026-11-30"},
		{"2026-11-30", "2026-12-31"},
		{"2026-12-01", "2026-12-31"},
		{"2026-12-31", "2027-01-31"},
		{"2027-01-01", "2027-01-31"},
	} {
		processed, err := time.ParseInLocation(time.DateOnly, test.processed, beijing)
		require.NoError(t, err)
		next, err := DeferredBatch(november, processed)
		require.NoError(t, err)
		assert.Equal(t, test.want, next.Format(time.DateOnly))
	}
	for _, amount := range []Money{-1, 0, 9999, 10001, MaxMoney + 1} {
		assert.ErrorIs(t, ValidateWithdrawal(amount, 10000), ErrAmount)
	}
	assert.NoError(t, ValidateWithdrawal(10000, 10000))
	assert.NoError(t, ValidateWithdrawal(10000, 20000))
	_, err = UnlockAt(time.Time{})
	assert.ErrorIs(t, err, ErrTime)
	_, err = PayoutBatch(time.Time{})
	assert.ErrorIs(t, err, ErrTime)
}

func TestConfiguredCommissionTiers(t *testing.T) {
	tiers := []TierRule{{Name: "校园新星", Floor: 0, RateBPS: 1250}, {Floor: 10000, RateBPS: 3325}, {Floor: 30000, RateBPS: 0}}
	require.NoError(t, ValidateTiers(tiers))
	require.NoError(t, ValidateTiers([]TierRule{{Name: strings.Repeat("星", 80), Floor: 0, RateBPS: 100}}))
	commission, err := CalculateCommission(5000, 30000, TopUp, tiers)
	require.NoError(t, err)
	assert.EqualValues(t, 7275, commission.Amount)
	assert.Equal(t, []Segment{{5000, 12.5}, {20000, 33.25}, {5000, 0}}, commission.Segments)
	tier, err := CurrentTier(10000, tiers)
	require.NoError(t, err)
	assert.Equal(t, 2, tier.Level)
	assert.Equal(t, 33.25, tier.RatePercent)
	assert.EqualValues(t, 30000, tier.Next)
	full := []TierRule{{Floor: 0, RateBPS: 10000}}
	commission, err = CalculateCommission(0, MaxMoney, TopUp, full)
	require.NoError(t, err)
	assert.Equal(t, MaxMoney, commission.Amount)
	fraction := []TierRule{{Floor: 0, RateBPS: 1250}}
	commission, err = CalculateCommission(0, 4, TopUp, fraction)
	require.NoError(t, err)
	assert.EqualValues(t, 1, commission.Amount)
	commission, err = CalculateSubscriptionCommission(0, 10000, 500)
	require.NoError(t, err)
	assert.EqualValues(t, 500, commission.Amount)
	for _, invalid := range [][]TierRule{
		nil, {}, {{Floor: 1, RateBPS: 100}}, {{Floor: -1, RateBPS: 100}},
		{{Floor: 0, RateBPS: -1}}, {{Floor: 0, RateBPS: 10001}},
		{{Floor: 0, RateBPS: 100}, {Floor: 0, RateBPS: 200}},
		{{Floor: 0, RateBPS: 100}, {Floor: MaxMoney + 1, RateBPS: 200}},
		make([]TierRule, 51),
		{{Name: strings.Repeat("星", 81), Floor: 0, RateBPS: 100}},
		{{Name: string([]byte{0xff}), Floor: 0, RateBPS: 100}},
	} {
		assert.Error(t, ValidateTiers(invalid))
		_, err = CalculateCommission(0, 100, TopUp, invalid)
		assert.Error(t, err)
	}
}

func TestSubscriptionCommissionConfiguredRate(t *testing.T) {
	result, err := CalculateSubscriptionCommission(100, 10000, 1234)
	require.NoError(t, err)
	assert.EqualValues(t, 1234, result.Amount)
	result, err = CalculateSubscriptionCommission(0, MaxMoney, 10000)
	require.NoError(t, err)
	assert.Equal(t, MaxMoney, result.Amount)
	for _, rate := range []int64{-1, 10001} {
		_, err := CalculateSubscriptionCommission(0, 100, rate)
		assert.Error(t, err)
	}
	require.NoError(t, ValidatePlanRates([]PlanRate{}))
	assert.Error(t, ValidatePlanRates(nil))
	assert.Error(t, ValidatePlanRates([]PlanRate{{PlanID: 1}, {PlanID: 1}}))
}
