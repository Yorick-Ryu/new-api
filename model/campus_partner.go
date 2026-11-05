package model

import (
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	cp "github.com/QuantumNous/new-api/pkg/campuspartner"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Configuration changes and invitation binding take the exclusive campaign
// lock. Rule-dependent activity writes take its shared lock before member locks.
// Settlement/refund lock the buyer, then their inviter, then accounting rows.
// Invitations are immutable and acyclic, so that member order cannot cycle.
// Existing fulfillment locks must precede these locks, never follow them.
type CampusCampaign struct {
	ID            int                `json:"id" gorm:"primaryKey"`
	Enabled       bool               `json:"enabled"`
	Version       string             `json:"version" gorm:"type:varchar(64)"`
	Revision      int64              `json:"revision"`
	TiersJSON     string             `json:"-" gorm:"type:text"`
	TierRevision  int64              `json:"tier_revision"`
	Tiers         []cp.TierRule      `json:"tiers" gorm:"-"`
	PlanRatesJSON string             `json:"-" gorm:"type:text"`
	PlanRevision  int64              `json:"plan_revision"`
	PlanRates     []cp.PlanRate      `json:"plan_rates" gorm:"-"`
	PlanOptions   []CampusPlanOption `json:"plan_options" gorm:"-"`
}

type CampusPlanOption struct {
	ID          int     `json:"id"`
	Title       string  `json:"title"`
	Enabled     bool    `json:"enabled"`
	PriceAmount float64 `json:"price_amount"`
	Currency    string  `json:"currency"`
}
type CampusMember struct {
	UserID           int      `json:"user_id" gorm:"primaryKey;autoIncrement:false"`
	Code             string   `json:"code" gorm:"type:varchar(32);uniqueIndex"`
	JoinedAt         int64    `json:"joined_at"`
	InviterID        int      `json:"inviter_id" gorm:"index"`
	BoundAt          int64    `json:"bound_at"`
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
	Receipt        *string  `json:"receipt,omitempty" gorm:"type:varchar(255);uniqueIndex"`
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
	tiers, err := common.Marshal(cp.DefaultTiers())
	if err != nil {
		return err
	}
	if err := db.AutoMigrate(&CampusCampaign{}, &CampusMember{}, &CampusPayment{}, &CampusRefund{}, &CampusWithdrawal{}, &CampusAllocation{}); err != nil {
		return err
	}
	if err := db.Clauses(clause.OnConflict{DoNothing: true}).Create(&CampusCampaign{ID: 1, Version: cp.RuleVersion, TiersJSON: string(tiers), PlanRatesJSON: "[]"}).Error; err != nil {
		return err
	}
	return nil
}

// Standalone activity writes use READ COMMITTED so indexed range reads do not
// take MySQL gap locks across unrelated accounts. Member locks protect balances;
// config locks protect rule/binding changes. Fulfillment keeps its outer
// transaction and uses current locking reads in CampusSettleTx.
func campusTransaction(db *gorm.DB, fn func(*gorm.DB) error) error {
	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		return db.Transaction(fn)
	}
	return db.Transaction(fn, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
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

// Shared configuration reads are current reads even inside a MySQL transaction
// whose fulfillment queries have already established a repeatable-read snapshot.
func campusReadConfig(tx *gorm.DB) (*CampusCampaign, error) {
	query := tx
	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		// SQLite has one writer; acquire it before reading to avoid lock upgrades.
		if err := tx.Model(&CampusCampaign{}).Where("id = ?", 1).UpdateColumn("revision", gorm.Expr("revision")).Error; err != nil {
			return nil, err
		}
	} else {
		query = tx.Clauses(clause.Locking{Strength: "SHARE"})
	}
	var config CampusCampaign
	if err := query.First(&config, 1).Error; err != nil {
		return nil, err
	}
	return &config, nil
}

const campusInvitationAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

func validCampusInvitationCode(code string) bool {
	if len(code) != 6 {
		return false
	}
	for _, char := range code {
		if !strings.ContainsRune(campusInvitationAlphabet, char) {
			return false
		}
	}
	return true
}

func campusMember(tx *gorm.DB, userID int) (*CampusMember, error) {
	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		if err := tx.Model(&CampusMember{}).Where("user_id = ?", userID).UpdateColumn("user_id", userID).Error; err != nil {
			return nil, err
		}
	}
	var member CampusMember
	// Do not lock a missing MySQL key: concurrent inserts would both hold gap
	// locks. Uniqueness handles simultaneous creation and random code collisions.
	err := tx.First(&member, "user_id = ?", userID).Error
	if err == nil {
		err = lockForUpdate(tx).First(&member, "user_id = ?", userID).Error
		return &member, err
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	for range 10 {
		var code [6]byte
		for i := range code {
			n, err := rand.Int(rand.Reader, big.NewInt(int64(len(campusInvitationAlphabet))))
			if err != nil {
				return nil, err
			}
			code[i] = campusInvitationAlphabet[n.Int64()]
		}
		member = CampusMember{UserID: userID, Code: string(code[:])}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&member).Error; err != nil {
			return nil, err
		}
		err := lockForUpdate(tx).First(&member, "user_id = ?", userID).Error
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return &member, err
		}
	}
	return nil, ErrCampusState
}

func (config *CampusCampaign) CommissionTiers() ([]cp.TierRule, error) {
	var tiers []cp.TierRule
	if err := common.UnmarshalJsonStr(config.TiersJSON, &tiers); err != nil {
		return nil, err
	}
	if err := cp.ValidateTiers(tiers); err != nil {
		return nil, err
	}
	return tiers, nil
}

func (config *CampusCampaign) CommissionVersion() string {
	version := config.Version
	if config.TierRevision > 0 {
		version += fmt.Sprintf("-tiers-%d", config.TierRevision)
	}
	if config.PlanRevision > 0 {
		version += fmt.Sprintf("-plans-%d", config.PlanRevision)
	}
	return version
}

func (config *CampusCampaign) SubscriptionRates() ([]cp.PlanRate, error) {
	plans := make([]cp.PlanRate, 0)

	if err := common.UnmarshalJsonStr(config.PlanRatesJSON, &plans); err != nil {
		return nil, err
	}
	if err := cp.ValidatePlanRates(plans); err != nil {
		return nil, err
	}
	return plans, nil
}

func CampusGetConfig() (CampusCampaign, error) {
	var config CampusCampaign
	if err := DB.First(&config, 1).Error; err != nil {
		return config, err
	}
	var err error
	config.Tiers, err = config.CommissionTiers()
	if err != nil {
		return config, err
	}
	config.PlanRates, err = config.SubscriptionRates()
	if err != nil {
		return config, err
	}
	err = DB.Model(&SubscriptionPlan{}).Select("id,title,enabled,price_amount,currency").Order("sort_order desc,id").Scan(&config.PlanOptions).Error
	return config, err
}

func CampusConfigurePlanRates(plans []cp.PlanRate, expectedRevision int64, actor int) error {
	if err := cp.ValidatePlanRates(plans); err != nil {
		return common.NewMessage("Invalid subscription commission settings")
	}
	return campusTransaction(DB, func(tx *gorm.DB) error {
		config, err := campusLock(tx)
		if err != nil {
			return err
		}
		if config.PlanRevision != expectedRevision {
			return ErrCampusState
		}
		ids := make([]int, 0, len(plans))
		for _, plan := range plans {
			ids = append(ids, plan.PlanID)
		}
		if len(ids) > 0 {
			var count int64
			if err := tx.Model(&SubscriptionPlan{}).Where("id IN ?", ids).Count(&count).Error; err != nil {
				return err
			}
			if count != int64(len(ids)) {
				return common.NewMessage("Selected subscription plan no longer exists")
			}
		}
		encoded, err := common.Marshal(plans)
		if err != nil {
			return err
		}
		config.PlanRatesJSON = string(encoded)
		config.PlanRevision++
		if err := tx.Save(config).Error; err != nil {
			return err
		}
		return nil
	})
}

func CampusConfigureTiers(tiers []cp.TierRule, expectedRevision int64, actor int) error {
	if err := cp.ValidateTiers(tiers); err != nil {
		return common.NewMessage("Invalid commission tiers")
	}
	return campusTransaction(DB, func(tx *gorm.DB) error {
		config, err := campusLock(tx)
		if err != nil {
			return err
		}
		if config.TierRevision != expectedRevision {
			return ErrCampusState
		}
		encoded, err := common.Marshal(tiers)
		if err != nil {
			return err
		}
		config.TiersJSON = string(encoded)
		config.TierRevision++
		if err := tx.Save(config).Error; err != nil {
			return err
		}
		return nil
	})
}
func CampusConfigure(enabled bool, actor int) error {
	return campusTransaction(DB, func(tx *gorm.DB) error {
		config, err := campusLock(tx)
		if err != nil {
			return err
		}
		config.Enabled = enabled
		if err := tx.Save(config).Error; err != nil {
			return err
		}
		return nil
	})
}
func CampusJoin(userID int) (*CampusMember, error) {
	var result *CampusMember
	err := campusTransaction(DB, func(tx *gorm.DB) error {
		config, err := campusReadConfig(tx)
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
	code = strings.ToUpper(strings.TrimSpace(code))
	if !validCampusInvitationCode(code) {
		return "", ErrCampusBinding
	}
	var inviter CampusMember
	var config CampusCampaign
	if err := DB.First(&config, 1).Error; err != nil {
		return "", err
	}
	if !config.Enabled {
		return "", ErrCampusDisabled
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
	return campusTransaction(DB, func(tx *gorm.DB) error { return CampusBindTx(tx, userID, code) })
}

// Used inside registration transactions as well as the authenticated late-bind
// endpoint. All binding graph changes and payment settlements share this lock.
func CampusBindTx(tx *gorm.DB, userID int, code string) error {
	code = strings.ToUpper(strings.TrimSpace(code))
	if !validCampusInvitationCode(code) {
		return ErrCampusBinding
	}
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
	if member.InviterID != 0 || inviter.UserID == userID {
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
	return nil
}
