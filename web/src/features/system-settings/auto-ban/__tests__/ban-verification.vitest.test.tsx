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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { BanRecords } from '../ban-records'

const { requestVerification } = vi.hoisted(() => ({
  requestVerification: vi.fn(),
}))
vi.mock('@/features/auth/secure-verification', () => ({
  useSecureVerification: () => ({
    requestVerification,
    isActive: false,
    dialogProps: {},
  }),
  SecureVerificationDialog: () => null,
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}))
vi.mock('../ban-record-details', () => ({ BanRecordDetails: () => null }))
function setup() {
  vi.spyOn(api, 'get').mockResolvedValue({
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
        },
      ],
    },
  })
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <BanRecords />
    </QueryClientProvider>
  )
  return post
}
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  requestVerification.mockReset()
})
it('requires a proof bound to the target user before lifting the selected occurrence', async () => {
  requestVerification.mockResolvedValue({ proof_token: 'test-proof' })
  const post = setup()
  await userEvent.click(await screen.findByRole('button', { name: 'Lift ban' }))
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
  expect(requestVerification).toHaveBeenCalledWith(
    expect.objectContaining({
      scope: 'admin.user.manage',
      context: { user_id: 405, action: 'enable' },
    })
  )
})
it('leaves the account untouched when verification is cancelled', async () => {
  requestVerification.mockResolvedValue(null)
  const post = setup()
  await userEvent.click(await screen.findByRole('button', { name: 'Lift ban' }))
  await waitFor(() => expect(requestVerification).toHaveBeenCalled())
  expect(post).not.toHaveBeenCalled()
})
