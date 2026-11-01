package campuspartner

import "math/big"

const RuleVersion = "campus-partner-v1"

// Product must be resolved from a configured plan ID and the external funding
// source, never from a client field or a plan title.
type Product string

const (
	TopUp Product = "topup"
	Plus  Product = "plus"
	Ultra Product = "ultra"
)

type Segment struct {
	Base        Money `json:"base_cents"`
	RatePercent int64 `json:"rate_percent"`
}

type Commission struct {
	RuleVersion       string    `json:"rule_version"`
	Product           Product   `json:"product"`
	PerformanceBefore Money     `json:"performance_before_cents"`
	Paid              Money     `json:"paid_cents"`
	Amount            Money     `json:"commission_cents"`
	Segments          []Segment `json:"segments"`
}

type Tier struct {
	Level       int   `json:"level"`
	RatePercent int64 `json:"rate_percent"`
	Floor       Money `json:"floor_cents"`
	// Zero at the highest tier; there is no further upgrade target.
	Next      Money `json:"next_cents"`
	Remaining Money `json:"remaining_cents"`
}

var tierFloors = [...]Money{0, 200_000, 1_000_000, 3_000_000, 8_000_000}

func CurrentTier(performance Money) (Tier, error) {
	if !performance.Valid() {
		return Tier{}, ErrAmount
	}
	index := len(tierFloors) - 1
	for index > 0 && performance < tierFloors[index] {
		index--
	}
	tier := Tier{Level: index + 1, RatePercent: int64(30 + index*5), Floor: tierFloors[index]}
	if index+1 < len(tierFloors) {
		tier.Next = tierFloors[index+1]
		tier.Remaining = tier.Next - performance
	}
	return tier, nil
}

// CalculateCommission uses the inviter's locked net performance immediately
// before this transaction. Round only after adding all exact segment products.
// The returned snapshot must be stored, not recomputed at refund time.
func CalculateCommission(performance, paid Money, product Product) (Commission, error) {
	if !performance.Valid() || !paid.Valid() || paid == 0 || paid > MaxMoney-performance {
		return Commission{}, ErrAmount
	}
	result := Commission{RuleVersion: RuleVersion, Product: product, PerformanceBefore: performance, Paid: paid}
	switch product {
	case Plus:
		result.Segments = []Segment{{Base: paid, RatePercent: 5}}
	case Ultra:
		result.Segments = []Segment{{Base: paid, RatePercent: 10}}
	case TopUp:
		remaining := paid
		for remaining > 0 {
			tier, _ := CurrentTier(performance)
			base := remaining
			if tier.Next != 0 {
				base = min(base, tier.Remaining)
			}
			result.Segments = append(result.Segments, Segment{Base: base, RatePercent: tier.RatePercent})
			performance += base
			remaining -= base
		}
	default:
		return Commission{}, ErrProduct
	}
	var weighted int64
	for _, segment := range result.Segments {
		// MaxMoney * 50 is below MaxInt64, including the rounding term.
		weighted += int64(segment.Base) * segment.RatePercent
	}
	result.Amount = Money((weighted + 50) / 100)
	return result, nil
}

type Refund struct {
	PerformanceReduction Money `json:"performance_reduction_cents"`
	CommissionReversal   Money `json:"commission_reversal_cents"`
	CumulativeReversal   Money `json:"cumulative_reversal_cents"`
}

// CalculateRefund accepts cumulative refunded cash, including already posted
// refunds. Duplicate totals are a no-op. The adapter must separately deduplicate
// refund IDs and reject conflicting retries inside its transaction.
func CalculateRefund(paid, commission, previousRefund, cumulativeRefund Money) (Refund, error) {
	if !paid.Valid() || paid == 0 || !commission.Valid() || commission > paid ||
		!previousRefund.Valid() || !cumulativeRefund.Valid() ||
		previousRefund > cumulativeRefund || cumulativeRefund > paid {
		return Refund{}, ErrAmount
	}
	previous := proportionalReversal(paid, commission, previousRefund)
	cumulative := proportionalReversal(paid, commission, cumulativeRefund)
	return Refund{
		PerformanceReduction: cumulativeRefund - previousRefund,
		CommissionReversal:   cumulative - previous,
		CumulativeReversal:   cumulative,
	}, nil
}

// Integer multiplication may exceed int64 even when each money amount is valid.
// Quotient/remainder implements exact half-up rounding without float conversion.
func proportionalReversal(paid, commission, refunded Money) Money {
	var numerator, denominator, remainder big.Int
	numerator.Mul(big.NewInt(int64(commission)), big.NewInt(int64(refunded)))
	denominator.SetInt64(int64(paid))
	numerator.QuoRem(&numerator, &denominator, &remainder)
	remainder.Lsh(&remainder, 1)
	if remainder.Cmp(&denominator) >= 0 {
		numerator.Add(&numerator, big.NewInt(1))
	}
	// The quotient cannot exceed the validated original commission.
	return Money(numerator.Int64())
}
