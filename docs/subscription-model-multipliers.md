# Subscription model group ratio overrides

Configure **Subscriptions → Edit plan → Subscription model group overrides**.
The admin API accepts `plan.model_multipliers` as a JSON object encoded in a
string, for example `{"gpt-6-astra":2}`. `{}` removes the overrides.

- The value **replaces the effective group ratio** only when the selected
  subscription pays for that exact client-requested model (before model mapping).
  Group 1 with override 2 uses 2; group 2 with override 1 uses 1; group 3 with
  override 0.5 uses 0.5. Model prices, completion/cache ratios and other pricing
  rules are unchanged. Unlisted models and wallet payments keep their normal
  group ratios, including user-specific group discounts.
- Subscription selection checks each plan's price using the unrounded estimate
  before the group ratio. Pre-consume, token budgets, settlement, all quota
  windows and logs use the resulting effective price. Existing wallet fallback
  preferences and overflow permissions still apply.
- The selected override is captured per request. Plan edits affect subsequent
  requests on existing and future subscriptions, including disabled plans with
  active subscribers. Routing retries and asynchronous settlement retain the
  captured override. Failed reservations refund all windows and token quota.
- Supported values are 0.001–1000, with at most 100 exact model names per plan.
  The field applies to token, fixed-price and tiered-expression pricing.

The nullable `subscription_pre_consume_records.group_ratio` column stores the
new override snapshot. Older records/tasks retain their historical multiplier
semantics for settlement/refunds. No existing balance or quota counter changes.
Usage logs identify new overrides with `subscription_group_ratio` and retain
`subscription_consumed` as the actual deduction.

Validation: affected Go packages and subscription/frontend unit tests;
frontend typecheck, changed-file lint and production build.

For BeiAPI, apply the override to the intended Plus/Ultra definitions, including
retired definitions with active subscriptions. Query the live plans first;
preserve other fields and unrelated overrides. Production replacement requires
current-task restart authorization; local preview uses the existing local DB.
