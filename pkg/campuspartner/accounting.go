package campuspartner

// Recovery separates a cash commission reversal from movements between balance
// buckets. Only CommissionReversal reduces lifetime net commission; collecting
// Debt or withdrawing funds must not subtract from that total again.
type Recovery struct {
	DeductAvailable Money `json:"deduct_available_cents"`
	AddDebt         Money `json:"add_debt_cents"`
}

// RecoverSpentCommission is used only for the portion already paid out (or
// previously spent settling debt). Do not pass the whole refund if part of its
// original commission is still frozen, available or reserved for withdrawal.
// Frozen and reserved funds from other orders are not prematurely consumed.
func RecoverSpentCommission(reversal, available Money) (Recovery, error) {
	if !reversal.Valid() || !available.Valid() {
		return Recovery{}, ErrAmount
	}
	deduct := min(reversal, available)
	return Recovery{DeductAvailable: deduct, AddDebt: reversal - deduct}, nil
}

type Release struct {
	OffsetDebt   Money `json:"offset_debt_cents"`
	AddAvailable Money `json:"add_available_cents"`
}

// ReleaseCommission distributes a matured commission's remaining valid amount.
// The adapter checks its stored first-settlement unlock time and marks the lot
// released atomically, so repeated unlock jobs cannot release it a second time.
func ReleaseCommission(matured, debt Money) (Release, error) {
	if !matured.Valid() || !debt.Valid() {
		return Release{}, ErrAmount
	}
	offset := min(matured, debt)
	return Release{OffsetDebt: offset, AddAvailable: matured - offset}, nil
}

// RefundAllocation describes how much of an order's reversal belongs to each
// current funding bucket. Paid is the remaining recoverable allocation, not a
// rewrite of the historical transfer amount. Offset is commission that has
// already been used to collect an earlier debt; reversing it creates recovery
// just like reversing an already paid commission.
type RefundAllocation struct {
	Frozen    Money
	Available Money
	Reserved  Money
	Paid      Money
	Offset    Money
}

type RefundFunding struct {
	DeductFrozen    Money
	DeductAvailable Money
	DeductReserved  Money
	RecoverSpent    Money
	// Every affected reservation must be paused and re-reviewed. A resulting
	// withdrawal below MinimumWithdrawal must be cancelled and its remainder
	// released. These effects belong in the same transaction as the refund.
	PauseWithdrawal bool
}

// AllocateRefund consumes unspent portions first, then spent allocations. The
// input must come from the locked per-order allocation ledger, not account-wide
// balances. Refund IDs and cumulative reversals are enforced by the adapter.
func AllocateRefund(reversal Money, allocation RefundAllocation) (RefundFunding, error) {
	if !reversal.Valid() {
		return RefundFunding{}, ErrAmount
	}
	var total Money
	for _, amount := range []Money{allocation.Frozen, allocation.Available, allocation.Reserved, allocation.Paid, allocation.Offset} {
		if !amount.Valid() || amount > MaxMoney-total {
			return RefundFunding{}, ErrState
		}
		total += amount
	}
	if reversal > total {
		return RefundFunding{}, ErrState
	}
	result := RefundFunding{}
	result.DeductFrozen = min(reversal, allocation.Frozen)
	reversal -= result.DeductFrozen
	result.DeductAvailable = min(reversal, allocation.Available)
	reversal -= result.DeductAvailable
	result.DeductReserved = min(reversal, allocation.Reserved)
	reversal -= result.DeductReserved
	result.RecoverSpent = reversal
	result.PauseWithdrawal = result.DeductReserved > 0
	return result, nil
}
