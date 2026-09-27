package model

import (
	"errors"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

var ErrNoEligibleSubscription = errors.New("no active subscription for this group")

// Empty/NULL is the legacy unrestricted policy. A nonempty list matches the
// actual routing group, never the user's membership or the token's "auto".
func ParseSubscriptionBillingGroups(raw *string) ([]string, error) {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return nil, nil
	}
	var groups []string
	if len(*raw) > 16384 {
		return nil, errors.New("subscription billing groups are too large")
	}
	if err := common.UnmarshalJsonStr(*raw, &groups); err != nil || groups == nil {
		return nil, errors.New("subscription billing groups must be a JSON array")
	}
	if len(groups) > 128 {
		return nil, errors.New("at most 128 subscription billing groups are allowed")
	}
	for _, group := range groups {
		if group == "" || group == "auto" || len(group) > 64 || strings.TrimSpace(group) != group || strings.ContainsAny(group, ",*\r\n") {
			return nil, errors.New("subscription billing groups must contain exact group names")
		}
	}
	return groups, nil
}

func NormalizeSubscriptionBillingGroups(raw *string) (*string, error) {
	if raw == nil {
		return nil, nil
	}
	groups, err := ParseSubscriptionBillingGroups(raw)
	if err != nil {
		return nil, err
	}
	if len(groups) == 0 {
		return common.GetPointer(""), nil
	}
	slices.Sort(groups)
	encoded, err := common.Marshal(slices.Compact(groups))
	return common.GetPointer(string(encoded)), err
}

func (p *SubscriptionPlan) AllowsBillingGroup(group string) (bool, error) {
	groups, err := ParseSubscriptionBillingGroups(p.BillingGroups)
	if err != nil {
		return false, err
	}
	return len(groups) == 0 || slices.Contains(groups, group), nil
}

type SubscriptionBillingEligibility struct {
	HasActive           bool
	HasEligible         bool
	HasRestrictions     bool
	AllowWalletOverflow bool
}

// Only eligible subscriptions participate in the quota-exhaustion policy.
// An unrelated strict subscription must not block this group's wallet usage.
func GetSubscriptionBillingEligibility(userID int, group string) (SubscriptionBillingEligibility, error) {
	result := SubscriptionBillingEligibility{AllowWalletOverflow: true}
	if userID <= 0 {
		return result, errors.New("invalid userId")
	}
	var subs []UserSubscription
	if err := DB.Where("user_id = ? AND status = ? AND end_time > ?", userID, "active", GetDBTimestamp()).Find(&subs).Error; err != nil {
		return result, err
	}
	result.HasActive = len(subs) > 0
	for _, sub := range subs {
		plan, err := GetSubscriptionPlanById(sub.PlanId)
		if err != nil {
			return result, err
		}
		groups, err := ParseSubscriptionBillingGroups(plan.BillingGroups)
		if err != nil {
			return result, err
		}
		result.HasRestrictions = result.HasRestrictions || len(groups) > 0
		if len(groups) > 0 && !slices.Contains(groups, group) {
			continue
		}
		result.HasEligible = true
		if !sub.AllowWalletOverflow {
			result.AllowWalletOverflow = false
		}
	}
	return result, nil
}
