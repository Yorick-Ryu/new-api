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
import { createInstance } from 'i18next'
import { describe, expect, it } from 'vitest'

import { subscriptionPlanSchema } from '../../types'
import {
  formValuesToPlanPayload,
  getPlanFormSchema,
  PLAN_FORM_DEFAULTS,
  planToFormValues,
} from '../plan-form'

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })

const plan = subscriptionPlanSchema.parse({
  ...PLAN_FORM_DEFAULTS,
  id: 4,
  currency: 'USD',
  title: 'Plus',
  quota_windows: '[]',
  model_multipliers: '{"gpt-6-astra":2}',
})

describe('subscription model multiplier form', () => {
  it('loads and saves the exact model multiplier without changing normal plan fields', () => {
    const form = planToFormValues(plan)
    expect(form.model_multipliers).toEqual([
      { model: 'gpt-6-astra', multiplier: 2 },
    ])
    const payload = formValuesToPlanPayload(form)
    expect(payload.plan.model_multipliers).toBe('{"gpt-6-astra":2}')
    expect(payload.plan.title).toBe('Plus')
    form.model_multipliers = []
    expect(formValuesToPlanPayload(form).plan.model_multipliers).toBe('{}')
  })

  it('rejects duplicate model names, wildcards and invalid multipliers', () => {
    const schema = getPlanFormSchema(i18n.t)
    for (const rows of [
      [{ model: 'gpt-6-astra', multiplier: 0 }],
      [{ model: 'gpt-6-astra', multiplier: 1001 }],
      [{ model: 'gpt-*', multiplier: 2 }],
      [
        { model: 'gpt-6-astra', multiplier: 2 },
        { model: ' gpt-6-astra ', multiplier: 3 },
      ],
    ]) {
      expect(
        schema.safeParse({ ...planToFormValues(plan), model_multipliers: rows })
          .success
      ).toBe(false)
    }
  })

  it('keeps older plans without model multipliers at the default rate', () => {
    expect(
      planToFormValues({ ...plan, model_multipliers: undefined })
        .model_multipliers
    ).toEqual([])
  })
})
