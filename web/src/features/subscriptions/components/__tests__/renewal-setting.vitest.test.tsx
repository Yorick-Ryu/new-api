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
// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { subscriptionPlanSchema } from '../../types'
import { SubscriptionsMutateDrawer } from '../subscriptions-mutate-drawer'
import { SubscriptionsProvider } from '../subscriptions-provider'

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
afterEach(cleanup)

it.each([undefined, false, true])(
  'loads renewal setting %s and saves the changed switch value',
  async (allowRenewal) => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: [] },
    })
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true } })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const plan = subscriptionPlanSchema.parse({
      id: 1,
      title: 'Monthly Pro',
      price_amount: 2,
      duration_unit: 'day',
      duration_value: 30,
      quota_reset_period: 'daily',
      enabled: true,
      sort_order: 0,
      max_purchase_per_user: 1,
      total_amount: 5000000,
      allow_renewal: allowRenewal,
    })
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <SubscriptionsProvider>
            <SubscriptionsMutateDrawer
              open
              onOpenChange={onOpenChange}
              currentRow={{ plan }}
            />
          </SubscriptionsProvider>
        </I18nextProvider>
      </QueryClientProvider>
    )
    const toggle = await screen.findByRole('switch', { name: 'Allow renewal' })
    expect(toggle.getAttribute('aria-checked')).toBe(
      String(allowRenewal === true)
    )
    await user.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe(
      String(allowRenewal !== true)
    )
    // happy-dom rejects valid decimal steps; exercise the actual submit handler.
    const form = document.forms.namedItem('subscription-form')
    if (!form) throw new Error('Subscription form is missing')
    fireEvent.submit(form)
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        '/api/subscription/admin/plans/1',
        expect.objectContaining({
          plan: expect.objectContaining({
            allow_renewal: allowRenewal !== true,
          }),
        })
      )
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
    client.clear()
  }
)
