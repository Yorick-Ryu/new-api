// Package campuspartner implements the campus partner campaign's cash rules.
// Amounts are RMB cents, never wallet quota or display-currency amounts.
// These functions do not authenticate requests, verify payments, or persist
// state. Callers must apply results inside the payment/ledger transaction.
package campuspartner

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

type Money int64

// MaxMoney keeps integer cents exact in both Go and JavaScript. Invalid amounts
// are rejected, never clamped into a different cash payment.
const MaxMoney Money = 1<<53 - 1

var (
	ErrAmount  = errors.New("invalid campus partner cash amount")
	ErrState   = errors.New("invalid campus partner accounting state")
	ErrProduct = errors.New("unsupported campus partner product")
	ErrTime    = errors.New("invalid campus partner time")
)

func (m Money) Valid() bool { return m >= 0 && m <= MaxMoney }

// ParseMoney accepts an unsigned decimal RMB amount with at most two decimal
// places. It rejects exponents, signs, whitespace and sub-cent input rather
// than silently rounding a withdrawal or a manually registered refund.
func ParseMoney(value string) (Money, error) {
	if len(value) == 0 || len(value) > 17 {
		return 0, ErrAmount
	}
	whole, fraction, hasPoint := strings.Cut(value, ".")
	if whole == "" || (hasPoint && (fraction == "" || len(fraction) > 2)) {
		return 0, ErrAmount
	}
	for _, part := range []string{whole, fraction} {
		for _, digit := range part {
			if digit < '0' || digit > '9' {
				return 0, ErrAmount
			}
		}
	}
	if len(fraction) == 1 {
		fraction += "0"
	}
	if fraction == "" {
		fraction = "00"
	}
	cents, err := strconv.ParseInt(whole+fraction, 10, 64)
	if err != nil || !Money(cents).Valid() {
		return 0, ErrAmount
	}
	return Money(cents), nil
}

func (m Money) String() string {
	return fmt.Sprintf("%d.%02d", m/100, m%100)
}

// Discount returns the payable amount and discount for the single-use 95%
// top-up coupon. Coupon ownership/reservation is handled separately.
func Discount(before Money) (payable Money, discount Money, err error) {
	if !before.Valid() || before == 0 {
		return 0, 0, ErrAmount
	}
	payable = (before*95 + 50) / 100
	return payable, before - payable, nil
}
