# Subscription model consumption multipliers

Configure **Subscriptions → Edit plan → Model consumption multipliers**.
The existing admin create/update API accepts `plan.model_multipliers` as a JSON
object encoded in a string, for example `{"gpt-6-astra":2}`. `{}` removes overrides.
The plan APIs return the same field for administration and purchase disclosure.

- Match the exact client-requested model name before channel model mapping.
  Unlisted models use 1×. There are no wildcards; supported rates are 0.001–1000.
- Multiply the normal, fully calculated cost only when the selected subscription
  funds the request. All of its quota windows consume the resulting amount.
  Wallet payments, model price tables, token budgets and channel cost statistics
  retain normal units. Logs show both the normal cost and actual subscription
  consumption, with the subscription multiplier in the usage badge/details.
- Plan changes affect subsequent requests on existing and future subscriptions,
  including subscriptions on disabled plans. Historical consumption is retained.
- Capture the rate in the pre-consume record and billing session. Retries,
  settlement and asynchronous tasks use that captured rate even if the plan
  changes in the meantime. Round totals before taking differences; a positive
  charge consumes at least one quota unit. Reject invalid or overflowing charges.
- Check multiplied quota before selecting a subscription. Existing billing
  preferences and wallet-overflow permissions control wallet fallback.
- Additional reservations update the idempotency record and every quota window
  atomically, so request failure refunds the entire reservation once.

Deployment adds nullable `subscription_plans.model_multipliers` (text) and
`subscription_pre_consume_records.model_multiplier` (float) columns through the
existing migrations. Empty plan configuration and old records default to 1×.
No historical balances or quota counters need migration.

Validation: `go test ./model ./service ./controller ./relay/helper ./relay/common`;
frontend typecheck, changed-file lint, production build and the subscription
multiplier Vitest files under subscriptions and usage-logs.

For BeiAPI, apply `{"gpt-6-astra":2}` to all Plus/Ultra plan definitions, including
retired definitions with active subscriptions. Query the live plan list before
applying; preserve other fields and any unrelated model overrides. Production
application replacement requires current-task restart authorization. Roll back
configuration from its saved snapshot; application rollback must not restore an
older billing database.
