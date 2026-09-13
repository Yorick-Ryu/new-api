# Same-plan subscription renewal

The wallet offers **Renew Subscription** for active or expired subscriptions
whose plan is still available. Cancelled subscriptions cannot be renewed.

- Payment requests accept optional `renewal_subscription_id`; the order stores
  that ID. Omitting it preserves the existing new-purchase behavior.
- The ID must belong to the paying user and match `plan_id`. A valid renewal
  bypasses `max_purchase_per_user`; new purchases and admin bindings retain it.
- Payment completion extends an active subscription from its existing expiry.
  Duration and price use the current plan, as with new purchases.
- If the original subscription has expired, completion opens a new instance
  from payment time. Old usage and counters remain available for history and
  late settlement. If another renewal has already opened an active instance of
  that plan, subsequent payments extend that instance.
- Active periodic quotas retain their allowance, usage and reset anchors.
  Non-resetting quota packs add one current plan allowance, preserving usage;
  unlimited quota stays unlimited. Extra quota windows retain their snapshots.
  Reset times suppressed by the previous expiry are restored from their anchors.
- Balance purchases and Stripe, Creem, Epay and Waffo Pancake order completion
  share fulfillment. Gateway callbacks remain idempotent by order. This adds
  manual renewal through existing checkout flows; it does not implement
  recurring payment scheduling or recurring invoice handling.

`model/subscription_renewal.go` holds fulfillment and checkout validation.
`subscription_orders.renewal_subscription_id` is an additive column created by
normal schema migration; old orders default to new-purchase behavior. Preserve
it when rolling back so renewal orders remain identifiable. Pending renewal
orders require the new fulfillment code; do not revert it until they settle or
are explicitly reconciled.

Local checks: `go test ./model ./controller`, and from `web/`, `bun run typecheck`
and `bun run test:unit` with the two `subscription-renewal.vitest.test.tsx` files.
