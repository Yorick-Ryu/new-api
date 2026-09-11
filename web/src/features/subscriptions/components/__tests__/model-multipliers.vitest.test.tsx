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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { useForm, type Resolver } from 'react-hook-form'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Form } from '@/components/ui/form'

import {
  formValuesToPlanPayload,
  getPlanFormSchema,
  PLAN_FORM_DEFAULTS,
  type PlanFormValues,
} from '../../lib'
import { ModelMultiplierSummary } from '../model-multiplier-summary'
import { ModelMultipliersField } from '../model-multipliers-field'

const i18n = createInstance()
await i18n.init({
  lng: 'en',
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
})
afterEach(cleanup)

function Editor(props: {
  onSave: (value: ReturnType<typeof formValuesToPlanPayload>) => void
}) {
  const form = useForm<PlanFormValues>({
    resolver: zodResolver(
      getPlanFormSchema(i18n.t)
    ) as Resolver<PlanFormValues>,
    defaultValues: { ...PLAN_FORM_DEFAULTS, title: 'Plus' },
  })
  return (
    <I18nextProvider i18n={i18n}>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((values) =>
            props.onSave(formValuesToPlanPayload(values))
          )}
        >
          <ModelMultipliersField />
          <button type='submit'>Save</button>
        </form>
      </Form>
    </I18nextProvider>
  )
}

describe('subscription model multiplier editor', () => {
  it('adds a model, saves its multiplier and removes the override', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<Editor onSave={onSave} />)
    await user.click(screen.getByRole('button', { name: 'Add model' }))
    await user.type(
      screen.getByRole('textbox', { name: 'Model name' }),
      'gpt-6-astra'
    )
    expect(
      (
        screen.getByRole('spinbutton', {
          name: 'Override group ratio',
        }) as HTMLInputElement
      ).value
    ).toBe('2')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          plan: expect.objectContaining({
            model_multipliers: '{"gpt-6-astra":2}',
          }),
        })
      )
    )
    await user.click(
      screen.getByRole('button', { name: 'Remove model multiplier' })
    )
    expect(screen.queryByRole('textbox', { name: 'Model name' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(onSave).toHaveBeenLastCalledWith(
        expect.objectContaining({
          plan: expect.objectContaining({ model_multipliers: '{}' }),
        })
      )
    )
  })

  it('shows buyers the subscription group override and hides the section for an unconfigured plan', () => {
    const view = render(
      <I18nextProvider i18n={i18n}>
        <ModelMultiplierSummary value='{"gpt-6-astra":2}' />
      </I18nextProvider>
    )
    expect(
      screen.getByText('gpt-6-astra: group ratio 2× with this subscription')
    ).toBeTruthy()
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <ModelMultiplierSummary value='{}' />
      </I18nextProvider>
    )
    expect(screen.queryByText('Subscription model group overrides')).toBeNull()
  })
})
