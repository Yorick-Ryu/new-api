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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { BanRecords } from '../ban-records'

function setup() {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/verify/methods')
      {return {
        data: {
          success: true,
          data: {
            scope: 'admin.user.manage',
            methods: [{ method: '2fa', available: true }],
            oauth_providers: [],
            password_encryption_enabled: false,
          },
        },
      }}
    return {
      data: {
        success: true,
        data: [
          {
            id: 12,
            user_id: 405,
            created_at: 1,
            action: 'banned',
            ban_lifted: false,
            can_unban: true,
            reason: 'test',
            rules: '[]',
            error_summary: '',
            request_id: '',
            channel_id: 1,
            model: '',
            version: '',
            http_status: 400,
            user_status: 2,
            lifted_at: null,
            lifted_by: null,
          },
        ],
      },
    }
  })
  const post = vi.spyOn(api, 'post').mockImplementation(async (url) => {
    if (url === '/api/verify')
      {return {
        data: {
          success: true,
          data: {
            proof_token: 'test-proof',
            method: '2fa',
            scope: 'admin.user.manage',
            expires_at: Math.floor(Date.now() / 1000) + 60,
          },
        },
      }}
    if (url === '/api/user/manage') return { data: { success: true } }
    throw new Error(`Unexpected POST ${url}`)
  })
  const router = createRouter({
    routeTree: createRootRoute({ component: BanRecords }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return post
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('requires a proof bound to the target user before lifting the selected occurrence', async () => {
  const post = setup()
  await userEvent.click(await screen.findByRole('button', { name: 'Lift ban' }))
  const code = await screen.findByLabelText('Authenticator code or backup code')
  expect(post).not.toHaveBeenCalled()
  await userEvent.type(code, '123456')
  await userEvent.click(screen.getByRole('button', { name: 'Verify' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/user/manage',
      { id: 405, action: 'enable', auto_ban_event_id: 12 },
      expect.objectContaining({
        headers: { 'X-Security-Proof': 'test-proof' },
        singleUseAuthorization: true,
      })
    )
  )
  expect(post).toHaveBeenCalledWith(
    '/api/verify',
    expect.objectContaining({
      scope: 'admin.user.manage',
      context: { user_id: 405, action: 'enable' },
    }),
    expect.anything()
  )
})

it('leaves the account untouched when verification is cancelled', async () => {
  const post = setup()
  await userEvent.click(await screen.findByRole('button', { name: 'Lift ban' }))
  await screen.findByLabelText('Authenticator code or backup code')
  await userEvent.keyboard('{Escape}')
  await waitFor(() =>
    expect(
      screen.queryByLabelText('Authenticator code or backup code')
    ).toBeNull()
  )
  expect(post).not.toHaveBeenCalled()
})
