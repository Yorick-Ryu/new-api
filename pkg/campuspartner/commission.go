package campuspartner

import (
	"errors"
	"math"
	"math/big"
)

const RuleVersion = "campus-partner-v1"

// Product must be resolved from a configured plan ID and the external funding
// source, never from a client field or a plan title.
type Product string

const (
	TopUp        Product = "topup"
	Subscription Product = "subscription"
)

type Segment struct {
	Base        Money   `json:"base_cents"`
	RatePercent float64 `json:"rate_percent"`
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
	Level       int     `json:"level"`
	RatePercent float64 `json:"rate_percent"`
	Floor       Money   `json:"floor_cents"`
	// Zero at the highest tier; there is no further upgrade target.
	Next      Money `json:"next_cents"`
	Remaining Money `json:"remaining_cents"`
}

// Upper bounds are the next tier's floor; the final tier has no upper bound.
// Rates use integer basis points to preserve two decimal places of percent.
type TierRule struct {
	Floor   Money `json:"floor_cents"`
	RateBPS int64 `json:"rate_bps"`
}

type PlanRate struct {
	PlanID  int   `json:"plan_id"`
	RateBPS int64 `json:"rate_bps"`
}

func ValidatePlanRates(plans []PlanRate) error {
	if plans == nil || len(plans) > 100 {
		return ErrTiers
	}
	seen := make(map[int]bool, len(plans))
	for _, plan := range plans {
		if plan.PlanID <= 0 || plan.RateBPS < 0 || plan.RateBPS > 10000 || seen[plan.PlanID] {
			return ErrTiers
		}
		seen[plan.PlanID] = true
	}
	return nil
}

var ErrTiers = errors.New("Invalid commission tiers")

func DefaultTiers() []TierRule {
	return []TierRule{{0, 3000}, {200_000, 3500}, {1_000_000, 4000}, {3_000_000, 4500}, {8_000_000, 5000}}
}

func ValidateTiers(tiers []TierRule) error {
	if len(tiers) == 0 || len(tiers) > 50 || tiers[0].Floor != 0 {
		return ErrTiers
	}
	for i, tier := range tiers {
		if !tier.Floor.Valid() || tier.RateBPS < 0 || tier.RateBPS > 10000 || (i > 0 && tier.Floor <= tiers[i-1].Floor) {
			return ErrTiers
		}
	}
	return nil
}

func CurrentTier(performance Money, tiers []TierRule) (Tier, error) {
	if !performance.Valid() {
		return Tier{}, ErrAmount
	}
	if err := ValidateTiers(tiers); err != nil {
		return Tier{}, err
	}
	index := len(tiers) - 1
	for index > 0 && performance < tiers[index].Floor {
		index--
	}
	tier := Tier{Level: index + 1, RatePercent: float64(tiers[index].RateBPS) / 100, Floor: tiers[index].Floor}
	if index+1 < len(tiers) {
		tier.Next = tiers[index+1].Floor
		tier.Remaining = tier.Next - performance
	}
	return tier, nil
}

// CalculateCommission uses the inviter's locked net performance immediately
// before this transaction. Round only after adding all exact segment products.
// The returned snapshot must be stored, not recomputed at refund time.
func CalculateCommission(performance, paid Money, product Product, tiers []TierRule) (Commission, error) {
	if err := ValidateTiers(tiers); err != nil {
		return Commission{}, err
	}
	if !performance.Valid() || !paid.Valid() || paid == 0 || paid > MaxMoney-performance {
		return Commission{}, ErrAmount
	}
	result := Commission{RuleVersion: RuleVersion, Product: product, PerformanceBefore: performance, Paid: paid}
	switch product {
	case TopUp:
		remaining := paid
		for remaining > 0 {
			tier, _ := CurrentTier(performance, tiers)
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
	result.Amount = commissionAmount(result.Segments)
	return result, nil
}

func CalculateSubscriptionCommission(performance, paid Money, rateBPS int64) (Commission, error) {
	if !performance.Valid() || !paid.Valid() || paid == 0 || paid > MaxMoney-performance || rateBPS < 0 || rateBPS > 10000 {
		return Commission{}, ErrAmount
	}
	result := Commission{RuleVersion: RuleVersion, Product: Subscription, PerformanceBefore: performance, Paid: paid, Segments: []Segment{{Base: paid, RatePercent: float64(rateBPS) / 100}}}
	result.Amount = commissionAmount(result.Segments)
	return result, nil
}

func commissionAmount(segments []Segment) Money {
	var weighted, productAmount big.Int
	for _, segment := range segments {
		// Public snapshots retain percentages; the validated rate has at most
		// two decimal places. Products can exceed int64 at MaxMoney and 100%.
		bps := int64(math.Round(segment.RatePercent * 100))
		productAmount.Mul(big.NewInt(int64(segment.Base)), big.NewInt(bps))
		weighted.Add(&weighted, &productAmount)
	}
	weighted.Add(&weighted, big.NewInt(5000))
	weighted.Quo(&weighted, big.NewInt(10000))
	return Money(weighted.Int64())
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
