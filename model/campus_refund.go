package model

import (
	"errors"
	"strings"
	"time"

	cp "github.com/QuantumNous/new-api/pkg/campuspartner"
	"gorm.io/gorm"
)

type CampusRefundPreview struct {
	ExpectedRefunded cp.Money `json:"expected_refunded_cents"`
	Refund           cp.Money `json:"refund_cents"`
	Reversal         cp.Money `json:"reversal_cents"`
	Immediate        cp.Money `json:"immediate_cents"`
	Debt             cp.Money `json:"debt_cents"`
	Performance      cp.Money `json:"performance_cents"`
}

var errCampusPreview = errors.New("campus refund preview rollback")

func CampusRegisterRefund(trade, reference, reason string, amount cp.Money, actor int, preview bool, expected ...cp.Money) (CampusRefundPreview, error) {
	var result CampusRefundPreview
	if trade == "" || len(reference) < 1 || len(reference) > 128 || strings.TrimSpace(reason) == "" || len(reason) > 2000 || !amount.Valid() || amount == 0 {
		return result, ErrCampusState
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		if _, err := campusLock(tx); err != nil {
			return err
		}
		var old CampusRefund
		err := lockForUpdate(tx).Where("reference = ?", reference).First(&old).Error
		if err == nil {
			if old.TradeNo != trade || old.Amount != amount {
				return ErrCampusState
			}
			result.Refund, result.Reversal = old.Amount, old.Reversal
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var p CampusPayment
		if err := lockForUpdate(tx).Where("trade_no = ?", trade).First(&p).Error; err != nil {
			return err
		}
		result.ExpectedRefunded = p.Refunded
		if len(expected) > 0 && expected[0] != p.Refunded {
			return ErrCampusState
		}
		if amount > p.Paid-p.Refunded {
			return ErrCampusState
		}
		refund, err := cp.CalculateRefund(p.Paid, p.Commission, p.Refunded, p.Refunded+amount)
		if err != nil {
			return err
		}
		result.Refund, result.Reversal = amount, refund.CommissionReversal
		p.Refunded += amount
		p.Reversed = refund.CumulativeReversal
		if p.Eligibility == string(cp.Eligible) {
			member, err := campusMember(tx, p.InviterID)
			if err != nil {
				return err
			}
			if err := campusUnlockTx(tx, member, time.Now().Unix()); err != nil {
				return err
			}
			// Unlock can change this lot; reload its buckets without losing refund totals.
			var current CampusPayment
			if err := lockForUpdate(tx).First(&current, p.ID).Error; err != nil {
				return err
			}
			p.Frozen, p.Available, p.Offset = current.Frozen, current.Available, current.Offset
			funding, err := cp.AllocateRefund(refund.CommissionReversal, cp.RefundAllocation{Frozen: p.Frozen, Available: p.Available, Reserved: p.Reserved, Paid: p.PaidOut, Offset: p.Offset})
			if err != nil {
				return err
			}
			p.Frozen -= funding.DeductFrozen
			p.Available -= funding.DeductAvailable
			p.Reserved -= funding.DeductReserved
			spent := funding.RecoverSpent
			fromPaid := min(spent, p.PaidOut)
			p.PaidOut -= fromPaid
			p.Offset -= spent - fromPaid
			if member.Performance < amount {
				return ErrCampusState
			}
			member.Performance -= amount
			result.Performance = member.Performance
			result.Immediate = funding.DeductFrozen + funding.DeductAvailable + funding.DeductReserved
			if err := tx.Save(&p).Error; err != nil {
				return err
			}
			if funding.DeductReserved > 0 {
				left := funding.DeductReserved
				var allocations []CampusAllocation
				if err := lockForUpdate(tx).Where("payment_id = ? AND amount > 0", p.ID).Order("id").Find(&allocations).Error; err != nil {
					return err
				}
				for i := range allocations {
					if left == 0 {
						break
					}
					a := &allocations[i]
					var w CampusWithdrawal
					if err := lockForUpdate(tx).First(&w, a.WithdrawalID).Error; err != nil {
						return err
					}
					if w.State == "unknown" {
						return ErrCampusState
					}
					if w.State == "paid" || w.State == "rejected" || w.State == "failed" || w.State == "cancelled" {
						continue
					}
					take := min(left, a.Amount)
					left -= take
					a.Amount -= take
					w.Amount -= take
					if err := tx.Save(a).Error; err != nil {
						return err
					}
					w.State, w.Reason = "paused", "Refund changed reserved commission; review required"
					if w.Amount < cp.MinimumWithdrawal {
						if err := campusReleaseWithdrawalTx(tx, &w); err != nil {
							return err
						}
						w.State = "cancelled"
					}
					w.UpdatedAt, w.ActorID = time.Now().Unix(), actor
					if err := tx.Save(&w).Error; err != nil {
						return err
					}
					if err := campusEntry(tx, w.UserID, p.ID, w.ID, "refund_withdrawal_adjustment", -take, actor, w.Reason); err != nil {
						return err
					}
				}
				if left != 0 {
					return ErrCampusState
				}
			}
			// Collect from currently available lots only, including balances just
			// released by a cancelled small withdrawal. Frozen lots are never advanced.
			left := funding.RecoverSpent
			var available []CampusPayment
			if err := lockForUpdate(tx).Where("inviter_id = ? AND available > 0", p.InviterID).Order("id").Find(&available).Error; err != nil {
				return err
			}
			for i := range available {
				if left == 0 {
					break
				}
				other := &available[i]
				take := min(left, other.Available)
				left -= take
				other.Available -= take
				other.Offset += take
				if err := tx.Save(other).Error; err != nil {
					return err
				}
				if err := campusEntry(tx, p.InviterID, other.ID, 0, "offset", -take, actor, "Collected commission after refund"); err != nil {
					return err
				}
			}
			if left > cp.MaxMoney-member.Debt {
				return ErrCampusState
			}
			member.Debt += left
			result.Debt = left
			result.Immediate += funding.RecoverSpent - left
			if err := tx.Save(member).Error; err != nil {
				return err
			}
			if err := campusEntry(tx, p.InviterID, p.ID, 0, "refund", -refund.CommissionReversal, actor, reason); err != nil {
				return err
			}
		} else {
			if err := tx.Save(&p).Error; err != nil {
				return err
			}
		}
		if preview {
			return errCampusPreview
		}
		return tx.Create(&CampusRefund{Reference: reference, TradeNo: trade, Amount: amount, Reversal: refund.CommissionReversal, Reason: reason, ActorID: actor, CreatedAt: time.Now().Unix()}).Error
	})
	if errors.Is(err, errCampusPreview) {
		err = nil
	}
	return result, err
}
