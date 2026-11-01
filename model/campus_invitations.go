package model

import (
	"strconv"
	"strings"

	cp "github.com/QuantumNous/new-api/pkg/campuspartner"
	"gorm.io/gorm"
)

// Administrator identities have a separate response type from masked self history.
type CampusAdminInvitation struct {
	UserID             int      `json:"user_id"`
	Username           string   `json:"username"`
	DisplayName        string   `json:"display_name"`
	InviterID          int      `json:"inviter_id"`
	InviterUsername    string   `json:"inviter_username"`
	InviterDisplayName string   `json:"inviter_display_name"`
	BoundAt            int64    `json:"bound_at"`
	RegisteredAt       int64    `json:"registered_at"`
	Paid               cp.Money `json:"paid_cents"`
	Commission         cp.Money `json:"commission_cents"`
}

type CampusInvitationFilter struct {
	Inviter        string `form:"inviter" binding:"max=100"`
	Invitee        string `form:"invitee" binding:"max=100"`
	StartTimestamp *int64 `form:"start_timestamp" binding:"omitempty,gte=0,lte=253402300799"`
	EndTimestamp   *int64 `form:"end_timestamp" binding:"omitempty,gte=0,lte=253402300799"`
}

func campusInvitationTotals() *gorm.DB {
	return DB.Model(&CampusPayment{}).
		Select("user_id, inviter_id, SUM(paid - refunded) AS paid, SUM(commission - reversed) AS commission").
		Where("eligibility = ? AND settled_at > 0", string(cp.Eligible)).
		Group("user_id, inviter_id")
}

func CampusListAdminInvitations(filter CampusInvitationFilter, page, size int) (any, int64, error) {
	page = max(page, 1)
	size = min(max(size, 1), 100)
	query := DB.Model(&CampusMember{}).
		Joins("LEFT JOIN users AS invitee ON invitee.id = campus_members.user_id").
		Joins("LEFT JOIN users AS inviter ON inviter.id = campus_members.inviter_id").
		Where("campus_members.inviter_id > 0")
	for _, search := range []struct{ keyword, alias, idColumn string }{
		{filter.Inviter, "inviter", "campus_members.inviter_id"},
		{filter.Invitee, "invitee", "campus_members.user_id"},
	} {
		keyword := strings.TrimSpace(search.keyword)
		if keyword == "" {
			continue
		}
		// Names are literal substrings; user input cannot introduce LIKE wildcards.
		pattern := "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(strings.ToLower(keyword)) + "%"
		condition := "LOWER(" + search.alias + ".username) LIKE ? ESCAPE '!' OR LOWER(" + search.alias + ".display_name) LIKE ? ESCAPE '!'"
		args := []any{pattern, pattern}
		if id, err := strconv.Atoi(strings.TrimPrefix(keyword, "#")); err == nil && id > 0 {
			condition += " OR " + search.idColumn + " = ?"
			args = append(args, id)
		}
		query = query.Where("("+condition+")", args...)
	}
	if filter.StartTimestamp != nil {
		query = query.Where("campus_members.bound_at >= ?", *filter.StartTimestamp)
	}
	if filter.EndTimestamp != nil {
		query = query.Where("campus_members.bound_at <= ?", *filter.EndTimestamp)
	}
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return nil, 0, err
	}
	rows := []CampusAdminInvitation{}
	err := query.Select("campus_members.user_id, campus_members.inviter_id, campus_members.bound_at, COALESCE(invitee.username, '') AS username, COALESCE(invitee.display_name, '') AS display_name, COALESCE(inviter.username, '') AS inviter_username, COALESCE(inviter.display_name, '') AS inviter_display_name, COALESCE(invitee.created_at, 0) AS registered_at, COALESCE(totals.paid, 0) AS paid, COALESCE(totals.commission, 0) AS commission").
		Joins("LEFT JOIN (?) AS totals ON totals.user_id = campus_members.user_id AND totals.inviter_id = campus_members.inviter_id", campusInvitationTotals()).
		Order("campus_members.bound_at desc, campus_members.user_id desc").
		Offset((page - 1) * size).Limit(size).Scan(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	return &rows, count, nil
}
