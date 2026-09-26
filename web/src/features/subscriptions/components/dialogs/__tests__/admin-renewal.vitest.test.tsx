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
*/
// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { UserSubscriptionsDialog } from '../user-subscriptions-dialog'

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it.each([1, 12, 0, 13, 1.5, ''])(
  'validates renewal month input %s before submission',
  async (months) => {
    vi.spyOn(api, 'get').mockImplementation(async (url) => {
      if (url === '/api/subscription/admin/plans') {
        return {
          data: { success: true, data: [{ plan: { id: 3, title: 'Pro' } }] },
        }
      }
      return {
        data: {
          success: true,
          data: [
            {
              subscription: {
                id: 7,
                user_id: 2,
                plan_id: 3,
                status: 'active',
                start_time: 1700000000,
                end_time: 2100000000,
                amount_total: 1000,
                amount_used: 0,
              },
            },
          ],
        },
      }
    })
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { success: true, data: {} } })
    const user = userEvent.setup()
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>
          <UserSubscriptionsDialog
            open
            onOpenChange={() => {}}
            user={{ id: 2, username: 'alice' }}
          />
        </I18nextProvider>
      </QueryClientProvider>
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Actions' })).toBeTruthy()
    )
    await user.click(screen.getByRole('button', { name: 'Actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Renew' }))
    const duration = screen.getByRole('spinbutton', {
      name: 'Renewal months',
    }) as HTMLInputElement
    expect(duration.value).toBe('1')
    if (months !== 1) {
      await user.clear(duration)
      if (months !== '') await user.type(duration, String(months))
    }
    expect(screen.getByText('alice · Pro')).toBeTruthy()
    const confirm = screen.getByRole('button', { name: 'Renew' })
    if (months !== 1 && months !== 12) {
      expect(confirm.hasAttribute('disabled')).toBe(true)
      expect(duration.getAttribute('aria-invalid')).toBe('true')
      expect(post).not.toHaveBeenCalled()
      client.clear()
      return
    }
    expect(post).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Renew' }))
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/api/subscription/admin/users/2/subscriptions/7/renew',
        { months }
      )
    )
    client.clear()
  }
)
