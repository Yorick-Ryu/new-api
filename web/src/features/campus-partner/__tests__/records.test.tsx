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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosResponse } from 'axios'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { CampusRecords } from '../records'

afterEach(() => vi.restoreAllMocks())

test('a failed history request can be retried and an empty result disables pagination', async () => {
  vi.spyOn(api, 'get')
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({
      data: { success: true, data: { items: [], total: 0 } },
    } as AxiosResponse)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <CampusRecords kind='withdrawals' />
    </QueryClientProvider>
  )
  expect(await screen.findByRole('button', { name: 'Retry' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('No records yet')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
})

test('withdrawal history shows the pending batch and failure reason without calling it paid', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        items: [
          {
            id: 1,
            user_id: 1,
            amount_cents: 10000,
            state: 'paused',
            batch: '2026-11-30',
            reason: 'Recipient verification required',
            account: '***1234',
            real_name: '***',
          },
        ],
        total: 11,
      },
    },
  } as AxiosResponse)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <CampusRecords kind='withdrawals' />
    </QueryClientProvider>
  )
  expect(await screen.findByText('Payout paused')).toBeVisible()
  expect(screen.getByText('Recipient verification required')).toBeVisible()
  expect(screen.getByText('Expected payout: 2026-11-30')).toBeVisible()
  expect(screen.queryByText('Paid')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled()
})
