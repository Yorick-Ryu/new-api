package model

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	cp "github.com/QuantumNous/new-api/pkg/campuspartner"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// The singleton serializes invitation graph changes and settlement ordering
// across processes. UPDATE also obtains a write lock on SQLite. Existing user,
// order and subscription locks must be acquired before this lock, never after.
// Campaign row reads also use FOR UPDATE: MySQL REPEATABLE READ may already
// have a snapshot from fulfillment, so the singleton lock alone is not enough
// to observe another transaction's just-committed cumulative performance.
type CampusCampaign struct {
	ID          int    `json:"id" gorm:"primaryKey"`
	Enabled     bool   `json:"enabled"`
	Version     string `json:"version" gorm:"type:varchar(64)"`
	PlusPlanID  int    `json:"plus_plan_id"`
	UltraPlanID int    `json:"ultra_plan_id"`
	Revision    int64  `json:"revision"`
}
type CampusWindow struct {
	ID    int64 `json:"id" gorm:"primaryKey"`
	Start int64 `json:"start"`
	Stop  int64 `json:"stop"`
}
type CampusMember struct {
	UserID           int      `json:"user_id" gorm:"primaryKey;autoIncrement:false"`
	Code             string   `json:"code" gorm:"type:varchar(32);uniqueIndex"`
	JoinedAt         int64    `json:"joined_at"`
	InviterID        int      `json:"inviter_id" gorm:"index"`
	BoundAt          int64    `json:"bound_at"`
	FirstPaidAt      int64    `json:"first_paid_at"`
	Performance      cp.Money `json:"performance_cents"`
	Debt             cp.Money `json:"debt_cents"`
	CouponState      string   `json:"coupon_state" gorm:"type:varchar(16)"`
	CouponTrade      string   `json:"coupon_trade" gorm:"type:varchar(255)"`
	ReminderDay      string   `json:"-" gorm:"type:varchar(10)"`
	ReminderAccepted string   `json:"-" gorm:"type:varchar(64)"`
}

// Pending orders have no commission. A settled ineligible order is kept too;
// callback replay can never make it eligible later. TradeNo matches both the
// subscription order and its top-up summary, giving one settlement identity.
type CampusPayment struct {
	ProviderTrade *string    `json:"provider_transaction,omitempty" gorm:"type:varchar(255);uniqueIndex"`
	ID            int64      `json:"id" gorm:"primaryKey"`
	TradeNo       string     `json:"trade_no" gorm:"type:varchar(255);uniqueIndex"`
	UserID        int        `json:"user_id" gorm:"index"`
	MainSite      bool       `json:"main_site"`
	Currency      string     `json:"currency" gorm:"type:varchar(8)"`
	Product       cp.Product `json:"product" gorm:"type:varchar(16)"`
	PlanID        int        `json:"plan_id"`
	Paid          cp.Money   `json:"paid_cents"`
	Before        cp.Money   `json:"before_cents"`
	Coupon        bool       `json:"coupon"`
	SettledAt     int64      `json:"settled_at"`
	InviterID     int        `json:"inviter_id" gorm:"index"`
	RuleVersion   string     `json:"rule_version" gorm:"type:varchar(64)"`
	Eligibility   string     `json:"eligibility" gorm:"type:varchar(40)"`
	Commission    cp.Money   `json:"commission_cents"`
	Segments      string     `json:"segments" gorm:"type:text"`
	Refunded      cp.Money   `json:"refunded_cents"`
	Reversed      cp.Money   `json:"reversed_cents"`
	Frozen        cp.Money   `json:"frozen_cents"`
	Available     cp.Money   `json:"available_cents"`
	Reserved      cp.Money   `json:"reserved_cents"`
	PaidOut       cp.Money   `json:"paid_out_cents"`
	Offset        cp.Money   `json:"offset_cents"`
}
type CampusEntry struct {
	ID           int64    `json:"id" gorm:"primaryKey"`
	UserID       int      `json:"user_id" gorm:"index"`
	PaymentID    int64    `json:"payment_id"`
	WithdrawalID int64    `json:"withdrawal_id"`
	Kind         string   `json:"kind" gorm:"type:varchar(32)"`
	Amount       cp.Money `json:"amount_cents"`
	CreatedAt    int64    `json:"created_at"`
	ActorID      int      `json:"actor_id"`
	Reason       string   `json:"reason" gorm:"type:text"`
}
type CampusRefund struct {
	ID        int64    `json:"id" gorm:"primaryKey"`
	Reference string   `json:"reference" gorm:"type:varchar(128);uniqueIndex"`
	TradeNo   string   `json:"trade_no" gorm:"type:varchar(255);index"`
	Amount    cp.Money `json:"amount_cents"`
	Reversal  cp.Money `json:"reversal_cents"`
	Reason    string   `json:"reason" gorm:"type:text"`
	ActorID   int      `json:"actor_id"`
	CreatedAt int64    `json:"created_at"`
}
type CampusWithdrawal struct {
	ID             int64    `json:"id" gorm:"primaryKey"`
	UserID         int      `json:"user_id" gorm:"index;uniqueIndex:idx_campus_withdraw_request,priority:1"`
	RequestID      string   `json:"request_id" gorm:"type:varchar(64);uniqueIndex:idx_campus_withdraw_request,priority:2"`
	Amount         cp.Money `json:"amount_cents"`
	OriginalAmount cp.Money `json:"original_amount_cents"`
	Account        string   `json:"account" gorm:"type:varchar(128)"`
	RealName       string   `json:"real_name" gorm:"type:varchar(128)"`
	State          string   `json:"state" gorm:"type:varchar(24);index"`
	Batch          string   `json:"batch" gorm:"type:varchar(10)"`
	CreatedAt      int64    `json:"created_at"`
	UpdatedAt      int64    `json:"updated_at"`
	PaidAt         int64    `json:"paid_at"`
	Receipt        string   `json:"receipt" gorm:"type:varchar(255)"`
	Reason         string   `json:"reason" gorm:"type:text"`
	ActorID        int      `json:"actor_id"`
}
type CampusAllocation struct {
	ID           int64 `gorm:"primaryKey"`
	WithdrawalID int64 `gorm:"index"`
	PaymentID    int64 `gorm:"index"`
	Amount       cp.Money
}

var ErrCampusDisabled = common.NewMessage("Campus partner enrollment is currently closed")
var ErrCampusBinding = common.NewMessage("This invitation cannot be bound to your account")
var ErrCampusCoupon = common.NewMessage("This coupon is unavailable or reserved by another order")
var ErrCampusState = common.NewMessage("The record has changed; refresh and try again")

func InitializeCampusPartner(db *gorm.DB) error {
	if err := db.AutoMigrate(&CampusCampaign{}, &CampusWindow{}, &CampusMember{}, &CampusPayment{}, &CampusEntry{}, &CampusRefund{}, &CampusWithdrawal{}, &CampusAllocation{}); err != nil {
		return err
	}
	if err := db.Clauses(clause.OnConflict{DoNothing: true}).Create(&CampusCampaign{ID: 1, Version: cp.RuleVersion}).Error; err != nil {
		return err
	}
	return nil
}
func campusLock(tx *gorm.DB) (*CampusCampaign, error) {
	if err := tx.Model(&CampusCampaign{}).Where("id = ?", 1).UpdateColumn("revision", gorm.Expr("revision + 1")).Error; err != nil {
		return nil, err
	}
	var config CampusCampaign
	if err := lockForUpdate(tx).First(&config, 1).Error; err != nil {
		return nil, err
	}
	return &config, nil
}
func campusMember(tx *gorm.DB, userID int) (*CampusMember, error) {
	var member CampusMember
	err := lockForUpdate(tx).First(&member, "user_id = ?", userID).Error
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return &member, err
	}
	var random [10]byte
	if _, err := rand.Read(random[:]); err != nil {
		return nil, err
	}
	member = CampusMember{UserID: userID, Code: "CP" + strings.ToUpper(hex.EncodeToString(random[:]))}
	return &member, tx.Create(&member).Error
}
func campusEntry(tx *gorm.DB, userID int, paymentID, withdrawalID int64, kind string, amount cp.Money, actor int, reason string) error {
	return tx.Create(&CampusEntry{UserID: userID, PaymentID: paymentID, WithdrawalID: withdrawalID, Kind: kind, Amount: amount, CreatedAt: time.Now().Unix(), ActorID: actor, Reason: reason}).Error
}
func CampusConfigure(enabled bool, plus, ultra, actor int) error {
	if plus < 0 || ultra < 0 || (plus != 0 && plus == ultra) {
		return ErrCampusState
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		config, err := campusLock(tx)
		if err != nil {
			return err
		}
		for _, id := range []int{plus, ultra} {
			if id == 0 {
				continue
			}
			var n int64
			if err := tx.Model(&SubscriptionPlan{}).Where("id = ?", id).Count(&n).Error; err != nil {
				return err
			}
			if n != 1 {
				return ErrCampusState
			}
		}
		if enabled && (plus == 0 || ultra == 0) {
			return ErrCampusState
		}
		now := time.Now().Unix()
		if enabled != config.Enabled {
			if enabled {
				if err := tx.Create(&CampusWindow{Start: now}).Error; err != nil {
					return err
				}
			} else {
				if err := tx.Model(&CampusWindow{}).Where("stop = 0").Update("stop", now).Error; err != nil {
					return err
				}
			}
		}
		config.Enabled, config.PlusPlanID, config.UltraPlanID = enabled, plus, ultra
		if err := tx.Save(config).Error; err != nil {
			return err
		}
		return campusEntry(tx, 0, 0, 0, "configure", 0, actor, "Campaign configuration updated")
	})
}
func CampusJoin(userID int) (*CampusMember, error) {
	var result *CampusMember
	err := DB.Transaction(func(tx *gorm.DB) error {
		config, err := campusLock(tx)
		if err != nil {
			return err
		}
		result, err = campusMember(tx, userID)
		if err != nil {
			return err
		}
		if result.JoinedAt == 0 {
			if !config.Enabled {
				return ErrCampusDisabled
			}
			result.JoinedAt = time.Now().Unix()
		}
		result.ReminderAccepted = config.Version
		return tx.Save(result).Error
	})
	return result, err
}
func CampusValidateCode(code string) (string, error) {
	var inviter CampusMember
	var config CampusCampaign
	if err := DB.First(&config, 1).Error; err != nil {
		return "", err
	}
	if !config.Enabled {
		return "", ErrCampusDisabled
	}
	if !strings.HasPrefix(code, "CP") || len(code) != 22 {
		return "", ErrCampusBinding
	}
	if err := DB.Where("code = ? AND joined_at > 0", code).First(&inviter).Error; err != nil {
		return "", ErrCampusBinding
	}
	var user User
	if err := DB.Select("id", "display_name", "status").First(&user, inviter.UserID).Error; err != nil || user.Status != common.UserStatusEnabled {
		return "", ErrCampusBinding
	}
	name := []rune(user.DisplayName)
	if len(name) == 0 {
		return "***", nil
	}
	return string(name[:1]) + "***", nil
}
func CampusBind(userID int, code string) error {
	return DB.Transaction(func(tx *gorm.DB) error { return CampusBindTx(tx, userID, code) })
}

// Used inside registration transactions as well as the authenticated late-bind
// endpoint. All graph edges and first-success payment checks share this lock.
func CampusBindTx(tx *gorm.DB, userID int, code string) error {
	config, err := campusLock(tx)
	if err != nil {
		return err
	}
	if !config.Enabled {
		return ErrCampusDisabled
	}
	member, err := campusMember(tx, userID)
	if err != nil {
		return err
	}
	var inviter CampusMember
	if err := lockForUpdate(tx).Where("code = ? AND joined_at > 0", code).First(&inviter).Error; err != nil {
		return ErrCampusBinding
	}
	var inviterUser User
	if err := tx.Select("id", "status").First(&inviterUser, inviter.UserID).Error; err != nil || inviterUser.Status != common.UserStatusEnabled {
		return ErrCampusBinding
	}
	if member.InviterID == inviter.UserID {
		return nil
	}
	if member.InviterID != 0 || member.FirstPaidAt != 0 || inviter.UserID == userID {
		return ErrCampusBinding
	}
	var count int64
	if err := tx.Model(&TopUp{}).Where("user_id = ? AND status = ?", userID, common.TopUpStatusSuccess).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return ErrCampusBinding
	}
	if err := tx.Model(&SubscriptionOrder{}).Where("user_id = ? AND status = ?", userID, common.TopUpStatusSuccess).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return ErrCampusBinding
	}
	seen := map[int]bool{userID: true}
	cursor := inviter
	for {
		if seen[cursor.UserID] {
			return ErrCampusBinding
		}
		seen[cursor.UserID] = true
		if cursor.InviterID == 0 {
			break
		}
		next := cursor.InviterID
		cursor = CampusMember{}
		if err := lockForUpdate(tx).First(&cursor, "user_id = ?", next).Error; err != nil {
			return err
		}
	}
	member.InviterID, member.BoundAt, member.CouponState = inviter.UserID, time.Now().Unix(), "available"
	if err := tx.Save(member).Error; err != nil {
		return err
	}
	return campusEntry(tx, userID, 0, 0, "bound", 0, userID, "Invitation bound; one personal top-up coupon issued")
}
