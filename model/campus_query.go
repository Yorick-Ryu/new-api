package model

import (
	"time"

	"github.com/QuantumNous/new-api/common"
	cp "github.com/QuantumNous/new-api/pkg/campuspartner"
	"gorm.io/gorm"
)

type CampusOverview struct {
	ExpectedBatch string             `json:"expected_batch"`
	Enabled       bool               `json:"enabled"`
	Version       string             `json:"version"`
	Member        *CampusMember      `json:"member" gorm:"-"`
	CanBind       bool               `json:"can_bind"`
	Frozen        cp.Money           `json:"frozen_cents"`
	Available     cp.Money           `json:"available_cents"`
	Processing    cp.Money           `json:"processing_cents"`
	Paid          cp.Money           `json:"paid_cents"`
	Net           cp.Money           `json:"net_cents"`
	Invited       int64              `json:"invited"`
	ThisMonth     int64              `json:"this_month"`
	Tier          cp.Tier            `json:"tier" gorm:"-"`
	Tiers         []cp.TierRule      `json:"tiers" gorm:"-"`
	PlanRates     []cp.PlanRate      `json:"plan_rates" gorm:"-"`
	PlanOptions   []CampusPlanOption `json:"plan_options" gorm:"-"`
}

func CampusGetOverview(userID int) (CampusOverview, error) {
	var result CampusOverview
	err := DB.Transaction(func(tx *gorm.DB) error {
		config, err := campusLock(tx)
		if err != nil {
			return err
		}
		result.Enabled, result.Version = config.Enabled, config.Version
		result.Tiers, err = config.CommissionTiers()
		if err != nil {
			return err
		}
		result.PlanRates, err = config.SubscriptionRates()
		if err != nil {
			return err
		}
		if err := tx.Model(&SubscriptionPlan{}).Select("id,title,enabled,price_amount,currency").Order("sort_order desc,id").Scan(&result.PlanOptions).Error; err != nil {
			return err
		}

		member, err := campusMember(tx, userID)
		if err != nil {
			return err
		}
		if err := campusUnlockTx(tx, member, time.Now().Unix()); err != nil {
			return err
		}
		result.Member = member
		result.CanBind = config.Enabled && member.InviterID == 0 && member.FirstPaidAt == 0
		if result.CanBind {
			var n int64
			if err := tx.Model(&TopUp{}).Where("user_id = ? AND status = ?", userID, common.TopUpStatusSuccess).Count(&n).Error; err != nil {
				return err
			}
			result.CanBind = n == 0
			if err := tx.Model(&SubscriptionOrder{}).Where("user_id = ? AND status = ?", userID, common.TopUpStatusSuccess).Count(&n).Error; err != nil {
				return err
			}
			result.CanBind = result.CanBind && n == 0
		}
		var totals struct{ Frozen, Available, Processing, Net cp.Money }
		if err := tx.Model(&CampusPayment{}).Select("COALESCE(SUM(frozen),0) AS frozen, COALESCE(SUM(available),0) AS available, COALESCE(SUM(reserved),0) AS processing, COALESCE(SUM(commission - reversed),0) AS net").Where("inviter_id = ?", userID).Scan(&totals).Error; err != nil {
			return err
		}
		result.Frozen, result.Available, result.Processing, result.Net = totals.Frozen, totals.Available, totals.Processing, totals.Net
		if err := tx.Model(&CampusWithdrawal{}).Select("COALESCE(SUM(amount),0)").Where("user_id = ? AND state = ?", userID, "paid").Scan(&result.Paid).Error; err != nil {
			return err
		}
		if err := tx.Model(&CampusMember{}).Where("inviter_id = ?", userID).Count(&result.Invited).Error; err != nil {
			return err
		}
		now := time.Now().In(time.FixedZone("Asia/Shanghai", 28800))
		start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location()).Unix()
		if err := tx.Model(&CampusMember{}).Where("inviter_id = ? AND bound_at >= ?", userID, start).Count(&result.ThisMonth).Error; err != nil {
			return err
		}
		batch, err := cp.PayoutBatch(now)
		if err != nil {
			return err
		}
		result.ExpectedBatch = batch.Format(time.DateOnly)
		result.Tier, err = cp.CurrentTier(member.Performance, result.Tiers)
		return err
	})
	return result, err
}
func CampusReminder(userID int) (bool, error) {
	show := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		config, err := campusLock(tx)
		if err != nil {
			return err
		}
		if !config.Enabled {
			return nil
		}
		member, err := campusMember(tx, userID)
		if err != nil {
			return err
		}
		day := time.Now().In(time.FixedZone("Asia/Shanghai", 28800)).Format(time.DateOnly)
		if member.ReminderDay == day || member.ReminderAccepted == config.Version {
			return nil
		}
		member.ReminderDay = day
		show = true
		return tx.Save(member).Error
	})
	return show, err
}
func CampusList(userID int, admin bool, kind string, page, size int) (any, int64, error) {
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 100 {
		size = 20
	}
	query := DB
	var count int64
	var rows any
	switch kind {
	case "invitations":
		query = query.Model(&CampusMember{})
		if !admin {
			query = query.Where("inviter_id = ?", userID)
		}
		rows = &[]struct {
			UserID  int   `json:"user_id"`
			BoundAt int64 `json:"bound_at"`
		}{}
		query = query.Select("user_id,bound_at").Where("inviter_id > 0")
	case "payments":
		query = query.Model(&CampusPayment{})
		if !admin {
			query = query.Where("inviter_id = ? AND eligibility = ?", userID, string(cp.Eligible))
		}
		rows = &[]CampusPayment{}
	case "entries":
		query = query.Model(&CampusEntry{})
		if !admin {
			query = query.Where("user_id = ?", userID)
		}
		rows = &[]CampusEntry{}
	case "withdrawals":
		query = query.Model(&CampusWithdrawal{})
		if !admin {
			query = query.Where("user_id = ?", userID)
		}
		rows = &[]CampusWithdrawal{}
	case "refunds":
		if !admin {
			return nil, 0, ErrCampusState
		}
		query = query.Model(&CampusRefund{})
		rows = &[]CampusRefund{}
	default:
		return nil, 0, ErrCampusState
	}
	if err := query.Count(&count).Error; err != nil {
		return nil, 0, err
	}
	order := "id desc"
	if kind == "invitations" {
		order = "bound_at desc,user_id desc"
	}
	if err := query.Order(order).Offset((page - 1) * size).Limit(size).Find(rows).Error; err != nil {
		return nil, 0, err
	}
	if !admin && kind == "withdrawals" {
		for i := range *rows.(*[]CampusWithdrawal) {
			w := &(*rows.(*[]CampusWithdrawal))[i]
			r := []rune(w.Account)
			w.Account = "***"
			if len(r) > 4 {
				w.Account += string(r[len(r)-4:])
			}
			w.RealName = "***"
		}
	}
	return rows, count, nil
}
