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
import { zodResolver } from '@hookform/resolvers/zod'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { useForm, type Resolver } from 'react-hook-form'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'

import {
  formValuesToPlanPayload,
  getPlanFormSchema,
  PLAN_FORM_DEFAULTS,
  planToFormValues,
  type PlanFormValues,
} from '../../lib/plan-form'
import { subscriptionPlanSchema } from '../../types'
import { BillingGroupsField } from '../billing-groups-field'

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })

function Fixture(props: { save: (values: unknown) => void }) {
  const form = useForm<PlanFormValues>({
    defaultValues: { ...PLAN_FORM_DEFAULTS, title: 'Plus' },
    resolver: zodResolver(
      getPlanFormSchema(i18n.t)
    ) as Resolver<PlanFormValues>,
  })
  return (
    <I18nextProvider i18n={i18n}>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((values) =>
            props.save(formValuesToPlanPayload(values))
          )}
        >
          <BillingGroupsField form={form} groups={['A', 'B', 'auto']} />
          <Button type='submit'>Save</Button>
        </form>
      </Form>
    </I18nextProvider>
  )
}

describe('subscription billing groups', () => {
  it('loads old plans as unrestricted and round-trips multiple selected groups', () => {
    const plan = subscriptionPlanSchema.parse({
      ...PLAN_FORM_DEFAULTS,
      id: 1,
      currency: 'USD',
      quota_windows: '',
      model_multipliers: '',
      billing_groups: null,
    })
    expect(planToFormValues(plan).restrict_groups).toBe(false)
    const restricted = planToFormValues({
      ...plan,
      billing_groups: '["A","B"]',
    })
    expect(restricted.restrict_groups).toBe(true)
    expect(formValuesToPlanPayload(restricted).plan.billing_groups).toBe(
      '["A","B"]'
    )
  })

  it('requires a selected group, saves selections, and explicitly clears the restriction', async () => {
    const save = vi.fn()
    const user = userEvent.setup()
    render(<Fixture save={save} />)
    expect(screen.getByText('All accessible groups')).toBeVisible()
    const toggle = screen.getByRole('switch', {
      name: 'Restrict subscription billing groups',
    })
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(
      await screen.findByText('Select at least one billing group')
    ).toBeVisible()
    expect(save).not.toHaveBeenCalled()
    const input = screen.getByRole('combobox', { name: 'Select groups' })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    await user.click(input)
    expect(
      screen.queryByRole('option', { name: 'auto' })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'A' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({ billing_groups: '["A"]' }),
      })
    )
    await user.click(toggle)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        plan: expect.objectContaining({ billing_groups: '' }),
      })
    )
  })
})
