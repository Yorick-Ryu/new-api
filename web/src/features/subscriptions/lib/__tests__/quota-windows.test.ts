/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { TFunction } from 'i18next'

import type { SubscriptionPlan } from '../../types'
import { formatQuotaWindowPeriod, parseQuotaWindows } from '../format'
import {
  formValuesToPlanPayload,
  PLAN_FORM_DEFAULTS,
  planToFormValues,
} from '../plan-form'

const t = ((key: string) => key) as TFunction

const basePlan: SubscriptionPlan = {
  id: 1,
  title: 'Flexible plan',
  price_amount: 10,
  currency: 'USD',
  duration_unit: 'month',
  duration_value: 1,
  quota_reset_period: 'never',
  enabled: true,
  sort_order: 0,
  allow_balance_pay: true,
  allow_wallet_overflow: true,
  max_purchase_per_user: 0,
  total_amount: 10_000,
}

describe('subscription quota window form mapping', () => {
  test('serializes flexible hour and month windows and round-trips quota', () => {
    const payload = formValuesToPlanPayload({
      ...PLAN_FORM_DEFAULTS,
      title: 'Flexible plan',
      total_amount: 20,
      quota_windows: [
        {
          key: 'five_hour',
          name: '5 hours',
          period_unit: 'hour',
          period_value: 5,
          amount_total: 2,
        },
        {
          key: 'monthly',
          name: 'Monthly',
          period_unit: 'month',
          period_value: 1,
          amount_total: 10,
        },
      ],
    })

    const quotaWindows = JSON.parse(
      String(payload.plan.quota_windows)
    ) as Array<Record<string, unknown>>
    assert.equal(quotaWindows.length, 2)
    assert.equal(quotaWindows[0].period_unit, 'hour')
    assert.equal(quotaWindows[0].period_value, 5)
    assert.equal(quotaWindows[1].period_unit, 'month')

    const values = planToFormValues({
      ...basePlan,
      quota_windows: String(payload.plan.quota_windows),
    })
    assert.equal(values.quota_windows[0].amount_total, 2)
    assert.equal(values.quota_windows[1].amount_total, 10)
  })

  test('ignores malformed stored windows and formats valid periods', () => {
    const windows = parseQuotaWindows({
      quota_windows: JSON.stringify([
        {
          key: 'weekly',
          name: 'Weekly',
          period_unit: 'week',
          period_value: 1,
          amount_total: 5000,
        },
        { key: 'broken', name: 'Broken', period_unit: 'year' },
      ]),
    })

    assert.equal(windows.length, 1)
    assert.equal(formatQuotaWindowPeriod(windows[0], t), '1 weeks')
  })
})
