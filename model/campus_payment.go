package model

import (
	"errors"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	cp "github.com/QuantumNous/new-api/pkg/campuspartner"
	"gorm.io/gorm"
)

// InsertCampusTopUp persists the order and its immutable campaign checkout
// facts together. Call this before contacting the payment provider.
func InsertCampusTopUp(order *TopUp, mainSite bool, currency string, coupon bool) error {
	if !DB.Migrator().HasTable(&CampusCampaign{}) {
		if coupon {
			return ErrCampusCoupon
		}
		return order.Insert()
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		payment := CampusPayment{TradeNo: order.TradeNo, UserID: order.UserId, MainSite: mainSite, Currency: currency, Product: cp.TopUp, Coupon: coupon}
		paid, err := cp.ParseMoney(strconv.FormatFloat(order.Money, 'f', 2, 64))
		if err != nil {
			return err
		}
		payment.Paid, payment.Before = paid, paid
		if err := campusCheckoutTx(tx, &payment); err != nil {
			return err
		}
		order.Money = float64(payment.Paid) / 100
		return tx.Create(order).Error
	})
}
func InsertCampusSubscription(order *SubscriptionOrder, mainSite bool, currency string) error {
	if !DB.Migrator().HasTable(&CampusCampaign{}) {
		return order.Insert()
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		payment := CampusPayment{TradeNo: order.TradeNo, UserID: order.UserId, MainSite: mainSite, Currency: currency, PlanID: order.PlanId}
		paid, err := cp.ParseMoney(strconv.FormatFloat(order.Money, 'f', 2, 64))
		if err != nil {
			return err
		}
		payment.Paid, payment.Before = paid, paid
		if err := campusCheckoutTx(tx, &payment); err != nil {
			return err
		}
		return tx.Create(order).Error
	})
}
func campusCheckoutTx(tx *gorm.DB, payment *CampusPayment) error {
	config, err := campusLock(tx)
	if err != nil {
		return err
	}
	if payment.PlanID != 0 {
		payment.PlanMappingKnown = config.PlusPlanID > 0 && config.UltraPlanID > 0
		switch payment.PlanID {
		case config.PlusPlanID:
			payment.Product = cp.Plus
		case config.UltraPlanID:
			payment.Product = cp.Ultra
		}
	}
	if payment.Coupon {
		if !payment.MainSite || payment.Currency != "CNY" || payment.Product != cp.TopUp {
			return ErrCampusCoupon
		}
		member, err := campusMember(tx, payment.UserID)
		if err != nil {
			return err
		}
		if member.CouponState != "available" {
			return ErrCampusCoupon
		}
		payment.Paid, _, err = cp.Discount(payment.Before)
		if err != nil {
			return err
		}
		member.CouponState, member.CouponTrade = "reserved", payment.TradeNo
		if err := tx.Save(member).Error; err != nil {
			return err
		}
	}
	return tx.Create(payment).Error
}

// CampusSettleTx runs only after verified fulfillment, at the end of the same
// database transaction. It must never be called from a plain browser redirect.
func CampusSettleTx(tx *gorm.DB, trade string, userID int, proofs ...CampusPaymentProof) error {
	if !tx.Migrator().HasTable(&CampusCampaign{}) {
		return nil
	} // Older schemas have no campaign to settle.
	config, err := campusLock(tx)
	if err != nil {
		return err
	}
	var payment CampusPayment
	err = lockForUpdate(tx).Where("trade_no = ?", trade).First(&payment).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if payment.SettledAt != 0 {
		return nil
	}
	now := time.Now().Unix()
	member, err := campusMember(tx, userID)
	if err != nil {
		return err
	}
	if member.FirstPaidAt == 0 {
		member.FirstPaidAt = now
	}
	if payment.ID == 0 {
		// Older orders have no trusted site/currency snapshot. They still close
		// late-binding eligibility, but cannot become campaign sales retroactively.
		payment = CampusPayment{TradeNo: trade, UserID: userID, Eligibility: string(cp.OutsideMainSite)}
	}
	if payment.UserID != userID {
		return ErrCampusState
	}
	// Orders created before the first plan mapping was configured retain the
	// actual plan ID. Resolve it at first settlement; an already-known mapping
	// (including an excluded product) is never reinterpreted after checkout.
	if payment.PlanID > 0 && !payment.PlanMappingKnown && payment.Product == "" {
		if payment.PlanID == config.PlusPlanID {
			payment.Product = cp.Plus
		}
		if payment.PlanID == config.UltraPlanID {
			payment.Product = cp.Ultra
		}
		payment.PlanMappingKnown = true
	}
	payment.SettledAt, payment.RuleVersion = now, config.Version
	if len(proofs) == 1 {
		reference := "epay:" + proofs[0].Transaction
		payment.ProviderTrade = &reference
	}
	payment.InviterID = member.InviterID
	if payment.Coupon {
		if member.CouponState != "reserved" || member.CouponTrade != trade {
			return ErrCampusCoupon
		}
		member.CouponState = "used"
	}
	if err := tx.Save(member).Error; err != nil {
		return err
	}
	if payment.Paid > 0 {
		var rows []CampusWindow
		if err := lockForUpdate(tx).Order("id").Find(&rows).Error; err != nil {
			return err
		}
		windows := make([]cp.ActivityWindow, 0, len(rows))
		for _, row := range rows {
			if row.Stop != 0 && row.Stop == row.Start {
				continue
			}
			window := cp.ActivityWindow{StartedAt: time.Unix(row.Start, 0)}
			if row.Stop != 0 {
				window.StoppedAt = time.Unix(row.Stop, 0)
			}
			windows = append(windows, window)
		}
		var bound time.Time
		if member.BoundAt != 0 {
			bound = time.Unix(member.BoundAt, 0)
		}
		eligible, err := cp.SettlementEligibility(cp.SettlementFacts{MainSite: payment.MainSite, ExternalPayment: true, Currency: payment.Currency, Product: payment.Product, Paid: payment.Paid, FirstSettledAt: time.Unix(now, 0), InviterID: member.InviterID, BoundAt: bound}, windows)
		if err != nil {
			return err
		}
		payment.Eligibility = string(eligible)
		if eligible == cp.Eligible {
			inviter, err := campusMember(tx, member.InviterID)
			if err != nil {
				return err
			}
			commission, err := cp.CalculateCommission(inviter.Performance, payment.Paid, payment.Product)
			if err != nil {
				return err
			}
			snapshot, err := common.Marshal(commission.Segments)
			if err != nil {
				return err
			}
			payment.Commission, payment.Frozen, payment.Segments = commission.Amount, commission.Amount, string(snapshot)
			refund, err := cp.CalculateRefund(payment.Paid, payment.Commission, 0, payment.Refunded)
			if err != nil {
				return err
			}
			payment.Reversed, payment.Frozen = refund.CumulativeReversal, payment.Frozen-refund.CumulativeReversal
			inviter.Performance += payment.Paid - payment.Refunded
			if err := tx.Save(inviter).Error; err != nil {
				return err
			}
		}
	}
	if err := tx.Save(&payment).Error; err != nil {
		return err
	}
	if len(proofs) == 1 && proofs[0].ActorID > 0 {
		if err := campusEntry(tx, userID, payment.ID, 0, "payment_reconciled", payment.Paid, proofs[0].ActorID, proofs[0].Evidence); err != nil {
			return err
		}
	}
	if payment.Eligibility == string(cp.Eligible) {
		if err := campusEntry(tx, payment.InviterID, payment.ID, 0, "commission", payment.Commission, 0, "First verified settlement"); err != nil {
			return err
		}
		if payment.Reversed > 0 {
			return campusEntry(tx, payment.InviterID, payment.ID, 0, "refund", -payment.Reversed, 0, "Refund recorded before settlement")
		}
	}
	return nil
}

// Release is deliberately explicit: only a trusted, final cancellation/failure
// result permits it. Timeouts and client abandonment do not release a coupon.
func CampusReleaseCouponTx(tx *gorm.DB, trade string) error {
	if !tx.Migrator().HasTable(&CampusCampaign{}) {
		return nil
	}
	if _, err := campusLock(tx); err != nil {
		return err
	}
	var payment CampusPayment
	if err := lockForUpdate(tx).Where("trade_no = ?", trade).First(&payment).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if !payment.Coupon || payment.SettledAt != 0 {
		return nil
	}
	return tx.Model(&CampusMember{}).Where("user_id = ? AND coupon_trade = ? AND coupon_state = ?", payment.UserID, trade, "reserved").Updates(map[string]any{"coupon_state": "available", "coupon_trade": ""}).Error
}
func campusUnlockTx(tx *gorm.DB, member *CampusMember, now int64) error {
	var payments []CampusPayment
	if err := lockForUpdate(tx).Where("inviter_id = ? AND frozen > 0 AND settled_at <= ? AND settled_at > 0", member.UserID, now-int64(cp.FreezePeriod/time.Second)).Order("id").Find(&payments).Error; err != nil {
		return err
	}
	for i := range payments {
		p := &payments[i]
		release, err := cp.ReleaseCommission(p.Frozen, member.Debt)
		if err != nil {
			return err
		}
		member.Debt -= release.OffsetDebt
		p.Available += release.AddAvailable
		p.Offset += release.OffsetDebt
		p.Frozen = 0
		if err := tx.Save(p).Error; err != nil {
			return err
		}
		if release.OffsetDebt > 0 {
			if err := campusEntry(tx, member.UserID, p.ID, 0, "offset", -release.OffsetDebt, 0, "Matured commission collected against refund debt"); err != nil {
				return err
			}
		}
	}
	return tx.Save(member).Error
}

func FailCampusCheckout(trade string) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var order TopUp
		if err := lockForUpdate(tx).Where("trade_no = ?", trade).First(&order).Error; err != nil {
			return err
		}
		if order.Status != common.TopUpStatusPending {
			return ErrCampusState
		}
		order.Status = "failed"
		if err := tx.Save(&order).Error; err != nil {
			return err
		}
		return CampusReleaseCouponTx(tx, trade)
	})
}

func CampusQuoteCoupon(userID int, before float64) (float64, error) {
	var member CampusMember
	if err := DB.First(&member, "user_id = ?", userID).Error; err != nil {
		return 0, ErrCampusCoupon
	}
	if member.CouponState != "available" {
		return 0, ErrCampusCoupon
	}
	amount, err := cp.ParseMoney(strconv.FormatFloat(before, 'f', 2, 64))
	if err != nil {
		return 0, err
	}
	payable, _, err := cp.Discount(amount)
	return float64(payable) / 100, err
}

type CampusPaymentProof struct {
	ActorID     int
	Evidence    string
	Amount      string
	Transaction string
}

// Called under the original order lock before any fulfillment. Legacy orders
// without a campaign checkout retain their existing behavior; new orders must
// match both the signed cash amount and the provider's transaction identity.
func campusVerifyEpayTx(tx *gorm.DB, trade string, proofs []CampusPaymentProof) error {
	if !tx.Migrator().HasTable(&CampusCampaign{}) {
		return nil
	}
	var p CampusPayment
	if err := tx.Where("trade_no = ?", trade).First(&p).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if len(proofs) != 1 || proofs[0].Transaction == "" || len(proofs[0].Transaction) > 200 {
		return ErrCampusState
	}
	amount, err := cp.ParseMoney(proofs[0].Amount)
	if err != nil || amount != p.Paid || p.Currency != "CNY" {
		return ErrCampusState
	}
	reference := "epay:" + proofs[0].Transaction
	if p.ProviderTrade != nil && *p.ProviderTrade != reference {
		return ErrCampusState
	}
	return nil
}

func campusManualEvidenceTx(tx *gorm.DB, trade string, actor int, evidence string) error {
	if !tx.Migrator().HasTable(&CampusCampaign{}) {
		return nil
	}
	var p CampusPayment
	if err := tx.Where("trade_no = ?", trade).First(&p).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	if p.ProviderTrade == nil || len(evidence) < 5 || len(evidence) > 2000 || actor <= 0 {
		return common.NewMessage("Reconcile the original payment and provide collection evidence before completing this order")
	}
	return campusEntry(tx, p.UserID, p.ID, 0, "payment_reconciled", p.Paid, actor, evidence)
}

// The provider must have definitively closed this unpaid order. Operators
// supply reconciliation evidence; an unknown status is never sufficient.
func CampusConfirmClosedOrder(trade string, actor int, evidence string) error {
	if actor <= 0 || len(evidence) < 5 || len(evidence) > 2000 {
		return ErrCampusState
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		var order TopUp
		if err := lockForUpdate(tx).Where("trade_no = ?", trade).First(&order).Error; err != nil {
			return err
		}
		if order.Status != common.TopUpStatusPending {
			return ErrCampusState
		}
		order.Status = "failed"
		if err := tx.Save(&order).Error; err != nil {
			return err
		}
		if err := CampusReleaseCouponTx(tx, trade); err != nil {
			return err
		}
		return campusEntry(tx, order.UserId, 0, 0, "payment_closed", 0, actor, evidence)
	})
}

func CampusReconcilePayment(trade, reference, evidence string, actor int, ip string) error {
	if len(reference) == 0 || len(reference) > 200 || len(evidence) < 5 || len(evidence) > 2000 || actor <= 0 {
		return ErrCampusState
	}
	var subscription SubscriptionOrder
	err := DB.Where("trade_no = ?", trade).First(&subscription).Error
	if err == nil {
		if subscription.PaymentProvider != PaymentProviderEpay {
			return ErrCampusState
		}
		proof := CampusPaymentProof{Amount: strconv.FormatFloat(subscription.Money, 'f', 2, 64), Transaction: reference, ActorID: actor, Evidence: evidence}
		return CompleteSubscriptionOrder(trade, "", PaymentProviderEpay, subscription.PaymentMethod, ip, proof)
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	var order TopUp
	if err := DB.Where("trade_no = ?", trade).First(&order).Error; err != nil {
		return err
	}
	if order.PaymentProvider != PaymentProviderEpay {
		return ManualCompleteTopUpWithEvidence(trade, ip, actor, evidence)
	}
	proof := CampusPaymentProof{Amount: strconv.FormatFloat(order.Money, 'f', 2, 64), Transaction: reference, ActorID: actor, Evidence: evidence}
	_, err = RechargeEpay(trade, order.PaymentMethod, ip, proof)
	return err
}
