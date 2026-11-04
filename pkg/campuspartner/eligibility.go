package campuspartner

import "time"

// SettlementFacts must come from verified payment and stored order/binding
// records. In particular MainSite cannot come from a callback Host, client
// parameter, Origin/Referer, or a shared account's current browser session.
// A manual completion supplies ExternalPayment only after real funds have been
// reconciled with the original transaction. Other brands and unknown origins
// fail closed. Registration eligibility is a separate account-level check.
type SettlementFacts struct {
	MainSite        bool
	ExternalPayment bool
	Currency        string
	Product         Product
	Paid            Money
	FirstSettledAt  time.Time
	InviterID       int
	BoundAt         time.Time
}

type Eligibility string

const (
	Eligible              Eligibility = "eligible"
	OutsideMainSite       Eligibility = "outside_main_site"
	NotExternalPayment    Eligibility = "not_external_payment"
	NotRMB                Eligibility = "not_rmb"
	UnsupportedProduct    Eligibility = "unsupported_product"
	OutsideActivity       Eligibility = "outside_activity"
	NoBindingAtSettlement Eligibility = "no_binding_at_settlement"
)

// SettlementEligibility is evaluated once, under the same transaction/ordering
// as first successful payment and invitation binding. Persist even ineligible
// results; duplicate callbacks must return that snapshot without re-evaluation.
// Use the activity switch locked at first settlement; later toggles do not
// change the persisted eligibility.
func SettlementEligibility(facts SettlementFacts, enabled bool) (Eligibility, error) {
	if facts.FirstSettledAt.IsZero() {
		return "", ErrTime
	}
	if !facts.Paid.Valid() || facts.Paid == 0 {
		return "", ErrAmount
	}
	if !facts.MainSite {
		return OutsideMainSite, nil
	}
	if !facts.ExternalPayment {
		return NotExternalPayment, nil
	}
	if facts.Currency != "CNY" {
		return NotRMB, nil
	}
	if facts.Product != TopUp && facts.Product != Subscription {
		return UnsupportedProduct, nil
	}
	if !enabled {
		return OutsideActivity, nil
	}
	if facts.InviterID <= 0 || facts.BoundAt.IsZero() || facts.BoundAt.After(facts.FirstSettledAt) {
		return NoBindingAtSettlement, nil
	}
	return Eligible, nil
}
