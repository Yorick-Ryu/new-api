package model

import (
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	cp "github.com/QuantumNous/new-api/pkg/campuspartner"
	"gorm.io/gorm"
)

type CampusOverview struct {
	WithdrawalCutoff       string             `json:"withdrawal_cutoff"`
	WithdrawalNextStart    string             `json:"withdrawal_next_start"`
	WithdrawalMonthEnd     string             `json:"withdrawal_month_end"`
	WithdrawalNextMonthEnd string             `json:"withdrawal_next_month_end"`
	WithdrawalAccount      string             `json:"withdrawal_account"`
	WithdrawalName         string             `json:"withdrawal_name"`
	ExpectedBatch          string             `json:"expected_batch"`
	Enabled                bool               `json:"enabled"`
	Version                string             `json:"version"`
	Member                 *CampusMember      `json:"member" gorm:"-"`
	CanBind                bool               `json:"can_bind"`
	Frozen                 cp.Money           `json:"frozen_cents"`
	Available              cp.Money           `json:"available_cents"`
	Processing             cp.Money           `json:"processing_cents"`
	Paid                   cp.Money           `json:"paid_cents"`
	Net                    cp.Money           `json:"net_cents"`
	Invited                int64              `json:"invited"`
	ThisMonth              int64              `json:"this_month"`
	Tier                   cp.Tier            `json:"tier" gorm:"-"`
	Tiers                  []cp.TierRule      `json:"tiers" gorm:"-"`
	PlanRates              []cp.PlanRate      `json:"plan_rates" gorm:"-"`
	PlanOptions            []CampusPlanOption `json:"plan_options" gorm:"-"`
}

type CampusInvitation struct {
	UserID       int      `json:"user_id"`
	BoundAt      int64    `json:"bound_at"`
	MaskedName   string   `json:"masked_name"`
	RegisteredAt int64    `json:"registered_at"`
	Paid         cp.Money `json:"paid_cents"`
	Commission   cp.Money `json:"commission_cents"`
}

func campusListInvitations(userID int, page, size int) (any, int64, error) {
	query := DB.Model(&CampusMember{}).Where("campus_members.inviter_id > 0 AND campus_members.inviter_id = ?", userID)
	totals := campusInvitationTotals().Where("inviter_id = ?", userID)
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return nil, 0, err
	}
	rows := []CampusInvitation{}
	err := query.Select("campus_members.user_id, campus_members.bound_at, COALESCE(NULLIF(users.display_name, ''), users.username, '') AS masked_name, COALESCE(users.created_at, 0) AS registered_at, COALESCE(totals.paid, 0) AS paid, COALESCE(totals.commission, 0) AS commission").
		Joins("LEFT JOIN users ON users.id = campus_members.user_id AND users.deleted_at IS NULL").
		Joins("LEFT JOIN (?) AS totals ON totals.user_id = campus_members.user_id AND totals.inviter_id = campus_members.inviter_id", totals).
		Order("campus_members.bound_at desc, campus_members.user_id desc").
		Offset((page - 1) * size).Limit(size).Scan(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	// Only the masked display name may leave this read-only history query.
	for i := range rows {
		name := []rune(strings.TrimSpace(rows[i].MaskedName))
		rows[i].MaskedName = "***"
		if len(name) > 0 {
			rows[i].MaskedName = string(name[:1]) + "**"
		}
	}
	return &rows, count, nil
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
		var recipient CampusWithdrawal
		if err := tx.Select("account, real_name").Where("user_id = ?", userID).Order("id desc").Limit(1).Find(&recipient).Error; err != nil {
			return err
		}
		result.WithdrawalAccount, result.WithdrawalName = recipient.Account, recipient.RealName
		localNow := time.Now().In(time.FixedZone("Asia/Shanghai", 28800))
		year, month, _ := localNow.Date()
		date := func(month time.Month, day int) string {
			return time.Date(year, month, day, 0, 0, 0, 0, localNow.Location()).Format(time.DateOnly)
		}
		result.WithdrawalCutoff = date(month, 25)
		result.WithdrawalNextStart = date(month, 26)
		result.WithdrawalMonthEnd = date(month+1, 0)
		result.WithdrawalNextMonthEnd = date(month+2, 0)

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
		if admin {
			return CampusListAdminInvitations(CampusInvitationFilter{}, page, size)
		}
		return campusListInvitations(userID, page, size)
	case "payments":
		query = query.Model(&CampusPayment{}).Where("inviter_id > 0 AND settled_at > 0 AND eligibility = ?", string(cp.Eligible))
		if !admin {
			query = query.Where("inviter_id = ? AND eligibility = ?", userID, string(cp.Eligible))
		}
		rows = &[]CampusPayment{}
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
	if err := query.Order("id desc").Offset((page - 1) * size).Limit(size).Find(rows).Error; err != nil {
		return nil, 0, err
	}
	if admin && kind == "payments" {
		type paymentRecord struct {
			CampusPayment
			Username           string `json:"username"`
			DisplayName        string `json:"display_name"`
			InviterUsername    string `json:"inviter_username"`
			InviterDisplayName string `json:"inviter_display_name"`
		}
		result := make([]paymentRecord, 0)
		err := DB.Table("campus_payments AS p").
			Where("p.inviter_id > 0 AND p.settled_at > 0 AND p.eligibility = ?", string(cp.Eligible)).
			Select("p.*, u.username, u.display_name, i.username AS inviter_username, i.display_name AS inviter_display_name").
			Joins("LEFT JOIN users AS u ON u.id = p.user_id").
			Joins("LEFT JOIN users AS i ON i.id = p.inviter_id").
			Order("p.id desc").Offset((page - 1) * size).Limit(size).Scan(&result).Error
		return result, count, err
	}
	if admin && kind == "refunds" {
		type refundRecord struct {
			CampusRefund
			UserID      int    `json:"user_id"`
			Username    string `json:"username"`
			DisplayName string `json:"display_name"`
		}
		result := make([]refundRecord, 0)
		err := DB.Table("campus_refunds AS r").
			Select("r.*, p.user_id, u.username, u.display_name").
			Joins("LEFT JOIN campus_payments AS p ON p.trade_no = r.trade_no").
			Joins("LEFT JOIN users AS u ON u.id = p.user_id").
			Order("r.id desc").Offset((page - 1) * size).Limit(size).Scan(&result).Error
		return result, count, err
	}
	if admin && kind == "withdrawals" {
		type withdrawalRecord struct {
			CampusWithdrawal
			Username        string   `json:"username"`
			DisplayName     string   `json:"display_name"`
			PartnerTierName string   `json:"partner_tier_name"`
			PartnerTier     *cp.Tier `json:"partner_tier,omitempty"`
			Performance     cp.Money `json:"performance_cents"`
		}
		withdrawals := *rows.(*[]CampusWithdrawal)
		ids := make([]int, 0, len(withdrawals))
		for _, withdrawal := range withdrawals {
			ids = append(ids, withdrawal.UserID)
		}
		var users []User
		if len(ids) > 0 {
			if err := DB.Select("id", "username", "display_name").Where("id IN ?", ids).Find(&users).Error; err != nil {
				return nil, 0, err
			}
		}
		names := make(map[int]User, len(users))
		for _, user := range users {
			names[user.Id] = user
		}
		var members []CampusMember
		if len(ids) > 0 {
			if err := DB.Select("user_id", "performance").Where("user_id IN ?", ids).Find(&members).Error; err != nil {
				return nil, 0, err
			}
		}
		config, err := CampusGetConfig()
		if err != nil {
			return nil, 0, err
		}
		memberByID := make(map[int]CampusMember, len(members))
		for _, member := range members {
			memberByID[member.UserID] = member
		}
		result := make([]withdrawalRecord, 0, len(withdrawals))
		for _, withdrawal := range withdrawals {
			user := names[withdrawal.UserID]
			record := withdrawalRecord{CampusWithdrawal: withdrawal, Username: user.Username, DisplayName: user.DisplayName}
			if member, ok := memberByID[withdrawal.UserID]; ok {
				tier, err := cp.CurrentTier(member.Performance, config.Tiers)
				if err != nil {
					return nil, 0, err
				}
				record.PartnerTier, record.Performance = &tier, member.Performance
				record.PartnerTierName = config.Tiers[tier.Level-1].Name
			}
			result = append(result, record)
		}
		return result, count, nil
	}
	if !admin && kind == "payments" {
		type paymentRecord struct {
			CampusPayment
			MaskedName string `json:"masked_name"`
		}
		payments := *rows.(*[]CampusPayment)
		ids := make([]int, 0, len(payments))
		for _, payment := range payments {
			ids = append(ids, payment.UserID)
		}
		var users []User
		if len(ids) > 0 {
			if err := DB.Select("id,display_name,username").Where("id IN ?", ids).Find(&users).Error; err != nil {
				return nil, 0, err
			}
		}
		names := make(map[int]string, len(users))
		for _, user := range users {
			name := strings.TrimSpace(user.DisplayName)
			if name == "" {
				name = strings.TrimSpace(user.Username)
			}
			if chars := []rune(name); len(chars) > 0 {
				names[user.Id] = string(chars[:1]) + "**"
			}
		}
		result := make([]paymentRecord, 0, len(payments))
		for _, payment := range payments {
			name := names[payment.UserID]
			if name == "" {
				name = "***"
			}
			trade := []rune(payment.TradeNo)
			payment.TradeNo = "***"
			if len(trade) > 8 {
				payment.TradeNo = string(trade[:4]) + "***" + string(trade[len(trade)-4:])
			}
			payment.ProviderTrade = nil
			result = append(result, paymentRecord{CampusPayment: payment, MaskedName: name})
		}
		return &result, count, nil
	}
	if !admin && kind == "withdrawals" {
		for i := range *rows.(*[]CampusWithdrawal) {
			row := &(*rows.(*[]CampusWithdrawal))[i]
			row.RealName = campusMaskedRealName(row.RealName)
			row.Account = campusMaskedAlipayAccount(row.Account)
		}
	}
	return rows, count, nil
}

func campusMaskedRealName(name string) string {
	chars := []rune(strings.TrimSpace(name))
	if len(chars) <= 1 {
		return "*"
	}
	keep := 1
	if len(chars) > 2 {
		switch string(chars[:2]) {
		case "欧阳", "歐陽", "司马", "司馬", "上官", "诸葛", "諸葛", "东方", "東方", "皇甫", "尉迟", "尉遲", "公孙", "公孫", "慕容", "宇文", "司徒", "司空", "令狐", "长孙", "長孫", "夏侯", "闻人", "聞人", "澹台", "赫连", "赫連", "宗政", "濮阳", "濮陽", "淳于", "单于", "單于", "太叔", "申屠", "公羊", "仲孙", "仲孫", "轩辕", "軒轅", "钟离", "鍾離", "闾丘", "閭丘", "鲜于", "鮮于", "段干", "百里", "东郭", "東郭", "南宫", "南宮", "呼延", "羊舌", "微生", "梁丘", "左丘", "东门", "東門", "西门", "西門", "第五":
			keep = 2
		}
	}
	return string(chars[:keep]) + strings.Repeat("*", len(chars)-keep)
}

func campusMaskedAlipayAccount(account string) string {
	account = strings.TrimSpace(account)
	if local, domain, ok := strings.Cut(account, "@"); ok {
		chars := []rune(local)
		if len(chars) == 0 {
			return "***@" + domain
		}
		return string(chars[:1]) + "***@" + domain
	}
	chars := []rune(account)
	if len(chars) < 8 {
		return "***"
	}
	return string(chars[:3]) + strings.Repeat("*", len(chars)-7) + string(chars[len(chars)-4:])
}
