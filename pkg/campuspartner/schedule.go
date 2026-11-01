package campuspartner

import "time"

const FreezePeriod = 168 * time.Hour
const MinimumWithdrawal Money = 10_000

// All campaign business dates are Beijing dates, regardless of server timezone.
// China uses UTC+8 throughout this campaign; a fixed zone avoids depending on
// the deployment image's zoneinfo installation.
var beijing = time.FixedZone("Asia/Shanghai", 8*60*60)

func UnlockAt(firstSettlement time.Time) (time.Time, error) {
	if firstSettlement.IsZero() {
		return time.Time{}, ErrTime
	}
	return firstSettlement.Add(FreezePeriod), nil
}

func CanRelease(firstSettlement, now time.Time) (bool, error) {
	unlock, err := UnlockAt(firstSettlement)
	if err != nil || now.IsZero() {
		return false, ErrTime
	}
	return !now.Before(unlock), nil
}

// PayoutBatch returns midnight on the last calendar day of the target month.
// It is a date, not an instruction to transfer money at midnight. Approval and
// a recorded real transfer are still required. Holidays never shift the date.
func PayoutBatch(appliedAt time.Time) (time.Time, error) {
	if appliedAt.IsZero() {
		return time.Time{}, ErrTime
	}
	local := appliedAt.In(beijing)
	month := local.Month()
	if local.Day() >= 26 {
		month++
	}
	return time.Date(local.Year(), month+1, 0, 0, 0, 0, 0, beijing), nil
}

// DeferredBatch chooses the next available month after a missed batch, keeping
// the original application and occupied balance. The caller stores a reason
// and audit event when deferring; this does not reset the commission freeze.
func DeferredBatch(batch, processedAt time.Time) (time.Time, error) {
	if batch.IsZero() || processedAt.IsZero() {
		return time.Time{}, ErrTime
	}
	local := processedAt.In(beijing)
	currentEnd := time.Date(local.Year(), local.Month()+1, 0, 0, 0, 0, 0, beijing)
	if batch.After(currentEnd) {
		return batch, nil
	}
	if local.Day() < currentEnd.Day() {
		return currentEnd, nil
	}
	return time.Date(local.Year(), local.Month()+2, 0, 0, 0, 0, 0, beijing), nil
}

func ValidateWithdrawal(amount, available Money) error {
	if !amount.Valid() || !available.Valid() || amount < MinimumWithdrawal || amount > available {
		return ErrAmount
	}
	return nil
}
