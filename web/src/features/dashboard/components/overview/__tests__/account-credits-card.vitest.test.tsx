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
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, within } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { AccountCreditsCard } from '../account-credits-card'

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
afterEach(() => {
  cleanup()
  useAuthStore.getState().auth.reset()
})

it.each([false, true])(
  'shows remaining quota with responsive columns when extra window=%s',
  async (extra) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    useAuthStore
      .getState()
      .auth.setUser({ id: 1, username: 'overview-test', role: 1 })
    vi.spyOn(api, 'get').mockImplementation(async (url) => ({
      data: {
        success: true,
        data: String(url).endsWith('/plans')
          ? [
              {
                plan: {
                  id: 6,
                  title: 'Pro weekly',
                  quota_reset_period: 'custom',
                  quota_reset_custom_seconds: 18000,
                },
              },
            ]
          : {
              subscriptions: [
                {
                  subscription: {
                    id: 3,
                    user_id: 1,
                    plan_id: 6,
                    status: 'active',
                    start_time: 1700000000,
                    end_time: 2100000000,
                    amount_total: 20000000,
                    amount_used: 0,
                    next_reset_time: 2000000000,
                  },
                  quota_windows: extra
                    ? [
                        {
                          id: 4,
                          user_subscription_id: 3,
                          window_key: 'weekly',
                          name: 'Weekly quota',
                          period_unit: 'week',
                          period_value: 1,
                          amount_total: 200000000,
                          amount_used: 32000000,
                          window_start: 1700000000,
                          next_reset_time: 2000000000,
                        },
                      ]
                    : [],
                },
              ],
            },
      },
    }))
    const router = createRouter({
      routeTree: createRootRoute({ component: AccountCreditsCard }),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    try {
      render(
        <QueryClientProvider client={client}>
          <I18nextProvider i18n={i18n}>
            <RouterProvider router={router} />
          </I18nextProvider>
        </QueryClientProvider>
      )
      const list = await screen.findByRole('list', { name: 'My Subscriptions' })
      expect(within(list).getByText('100%')).toBeTruthy()
      expect(
        screen
          .getByRole('link', { name: 'View subscriptions' })
          .getAttribute('href')
      ).toBe('/subscription-plans')
      const cards = within(list).getAllByRole('listitem')
      const quotaRows = cards[0].querySelectorAll(
        '[data-slot="subscription-quota-usage"]'
      )
      expect(quotaRows).toHaveLength(extra ? 2 : 1)
      const grid = quotaRows[0].parentElement
      expect(grid?.classList.contains('grid-cols-1')).toBe(true)
      expect(grid?.classList.contains('@xl:grid-cols-2')).toBe(extra)
      expect(list.classList.contains('overflow-y-auto')).toBe(true)
      if (extra) {
        const weekly = within(list).getByRole('progressbar', {
          name: 'Weekly quota',
        })
        expect(weekly.getAttribute('aria-valuenow')).toBe('84')
        expect(weekly.getAttribute('aria-valuetext')).toBe('84% Remaining')
        expect(within(list).getAllByText(/Next reset:/)).toHaveLength(2)
      }
    } finally {
      cleanup()
      client.clear()
    }
  }
)
