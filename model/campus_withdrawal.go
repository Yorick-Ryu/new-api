package model

import (
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	cp "github.com/QuantumNous/new-api/pkg/campuspartner"
	"gorm.io/gorm"
)

var campusAlipayAccountPattern = regexp.MustCompile(`^(1[3-9][0-9]{9}|\+[1-9][0-9]{6,14}|[^\s@]+@[^\s@.]+(\.[^\s@.]+)+)$`)

func CampusRequestWithdrawal(userID int, requestID, account, name string, amount cp.Money) (*CampusWithdrawal, error) {
	account, name = strings.TrimSpace(account), strings.TrimSpace(name)
	if len(requestID) < 16 || len(requestID) > 64 || len(account) < 3 || len(account) > 128 || name == "" || len(name) > 128 {
		return nil, ErrCampusState
	}
	if !campusAlipayAccountPattern.MatchString(account) {
		return nil, common.NewMessage("Enter a valid Alipay phone number or email address")
	}
	var result CampusWithdrawal
	err := DB.Transaction(func(tx *gorm.DB) error {
		if _, err := campusLock(tx); err != nil {
			return err
		}
		err := lockForUpdate(tx).Where("user_id = ? AND request_id = ?", userID, requestID).First(&result).Error
		if err == nil {
			if result.OriginalAmount != amount || result.Account != account || result.RealName != name {
				return ErrCampusState
			}
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		member, err := campusMember(tx, userID)
		if err != nil {
			return err
		}
		now := time.Now()
		if err := campusUnlockTx(tx, member, now.Unix()); err != nil {
			return err
		}
		var payments []CampusPayment
		if err := lockForUpdate(tx).Where("inviter_id = ? AND available > 0", userID).Order("id").Find(&payments).Error; err != nil {
			return err
		}
		var available cp.Money
		for _, p := range payments {
			available += p.Available
		}
		if err := cp.ValidateWithdrawal(amount, available); err != nil {
			return common.NewMessage("Withdrawal must be at least CNY 100 and within available commission")
		}
		batch, err := cp.PayoutBatch(now)
		if err != nil {
			return err
		}
		result = CampusWithdrawal{UserID: userID, RequestID: requestID, Amount: amount, OriginalAmount: amount, Account: account, RealName: name, State: "pending", Batch: batch.Format(time.DateOnly), CreatedAt: now.Unix(), UpdatedAt: now.Unix()}
		if err := tx.Create(&result).Error; err != nil {
			return err
		}
		left := amount
		for i := range payments {
			if left == 0 {
				break
			}
			p := &payments[i]
			take := min(left, p.Available)
			left -= take
			p.Available -= take
			p.Reserved += take
			if err := tx.Save(p).Error; err != nil {
				return err
			}
			if err := tx.Create(&CampusAllocation{WithdrawalID: result.ID, PaymentID: p.ID, Amount: take}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	return &result, err
}

// campusReleaseWithdrawalTx releases only remaining reserved allocations.
// This also covers cancellation after a refund takes the request below minimum.
func campusReleaseWithdrawalTx(tx *gorm.DB, w *CampusWithdrawal) error {
	var rows []CampusAllocation
	if err := lockForUpdate(tx).Where("withdrawal_id = ? AND amount > 0", w.ID).Find(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		var p CampusPayment
		if err := lockForUpdate(tx).First(&p, row.PaymentID).Error; err != nil {
			return err
		}
		if row.Amount > p.Reserved {
			return ErrCampusState
		}
		p.Reserved -= row.Amount
		p.Available += row.Amount
		if err := tx.Save(&p).Error; err != nil {
			return err
		}
		if err := tx.Model(&row).Update("amount", 0).Error; err != nil {
			return err
		}
	}
	return nil
}
func CampusActWithdrawal(id int64, actor int, action, reason, receipt string, paidAt int64) error {
	reason, receipt = strings.TrimSpace(reason), strings.TrimSpace(receipt)
	if len(reason) > 2000 || len(receipt) > 255 {
		return ErrCampusState
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if _, err := campusLock(tx); err != nil {
			return err
		}
		var w CampusWithdrawal
		if err := lockForUpdate(tx).First(&w, id).Error; err != nil {
			return err
		}
		now := time.Now()
		beijing := time.FixedZone("Asia/Shanghai", 28800)
		if w.State == "paid" {
			if action == "paid" && receipt == w.Receipt && paidAt == w.PaidAt {
				return nil
			}
			return ErrCampusState
		}
		if w.State == "rejected" || w.State == "failed" || w.State == "cancelled" {
			return ErrCampusState
		}
		switch action {
		case "approve":
			if w.State != "pending" {
				return ErrCampusState
			}
			w.State = "approved"
		case "pause":
			if w.State == "unknown" {
				return ErrCampusState
			}
			w.State = "paused"
		case "resume":
			if w.State != "paused" {
				return ErrCampusState
			}
			w.State = "pending"
			batch, err := cp.PayoutBatch(now)
			if err != nil {
				return err
			}
			w.Batch = batch.Format(time.DateOnly)
		case "reject", "failed":
			if action == "reject" && w.State == "unknown" {
				return ErrCampusState
			}
			if err := campusReleaseWithdrawalTx(tx, &w); err != nil {
				return err
			}
			w.State = "rejected"
			if action == "failed" {
				w.State = "failed"
			}
		case "unknown":
			if w.State != "approved" {
				return ErrCampusState
			}
			w.State = "unknown"
		case "defer":
			if w.State == "unknown" {
				return ErrCampusState
			}
			batch, err := time.ParseInLocation(time.DateOnly, w.Batch, beijing)
			if err != nil {
				return err
			}
			next, err := cp.DeferredBatch(batch, now)
			if err != nil {
				return err
			}
			w.Batch = next.Format(time.DateOnly)
		case "paid":
			if (w.State != "approved" && w.State != "unknown") || receipt == "" || paidAt < w.CreatedAt || paidAt > now.Unix() {
				return ErrCampusState
			}
			actual := time.Unix(paidAt, 0).In(beijing)
			last := time.Date(actual.Year(), actual.Month()+1, 0, 0, 0, 0, 0, beijing)
			if actual.Day() != last.Day() || actual.Format(time.DateOnly) < w.Batch {
				return common.NewMessage("Record the actual month-end transfer date and receipt")
			}
			var count int64
			if err := tx.Model(&CampusWithdrawal{}).Where("receipt = ? AND state = ?", receipt, "paid").Count(&count).Error; err != nil {
				return err
			}
			if count > 0 {
				return ErrCampusState
			}
			var allocations []CampusAllocation
			if err := lockForUpdate(tx).Where("withdrawal_id = ? AND amount > 0", w.ID).Find(&allocations).Error; err != nil {
				return err
			}
			for _, a := range allocations {
				var p CampusPayment
				if err := lockForUpdate(tx).First(&p, a.PaymentID).Error; err != nil {
					return err
				}
				if a.Amount > p.Reserved {
					return ErrCampusState
				}
				p.Reserved -= a.Amount
				p.PaidOut += a.Amount
				if err := tx.Save(&p).Error; err != nil {
					return err
				}
			}
			w.State, w.Receipt, w.PaidAt = "paid", receipt, paidAt
		default:
			return ErrCampusState
		}
		w.Reason, w.ActorID, w.UpdatedAt = reason, actor, now.Unix()
		if err := tx.Save(&w).Error; err != nil {
			return err
		}
		return nil
	})
}

// Only unfinished reviews roll forward automatically. An approved request may
// already have been transferred at month end and recorded later; preserve its
// original batch until the operator reconciles the actual outcome.
func CampusAdvanceBatches() error {
	return DB.Transaction(func(tx *gorm.DB) error {
		if _, err := campusLock(tx); err != nil {
			return err
		}
		zone := time.FixedZone("Asia/Shanghai", 28800)
		now := time.Now().In(zone)
		var rows []CampusWithdrawal
		if err := lockForUpdate(tx).Where("batch < ? AND state IN ?", now.Format(time.DateOnly), []string{"pending", "paused"}).Find(&rows).Error; err != nil {
			return err
		}
		for i := range rows {
			w := &rows[i]
			batch, err := time.ParseInLocation(time.DateOnly, w.Batch, zone)
			if err != nil {
				return err
			}
			next, err := cp.DeferredBatch(batch, now)
			if err != nil {
				return err
			}
			w.Batch = next.Format(time.DateOnly)
			w.Reason = "Month-end batch missed; review or transfer was not completed. Follow-up required."
			w.UpdatedAt = now.Unix()
			if err := tx.Save(w).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
