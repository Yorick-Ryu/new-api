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
import { render, screen, within } from '@testing-library/react'
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
  expect(
    screen.getAllByRole('columnheader').map((header) => header.textContent)
  ).toEqual(['Time', 'Amount', 'Status', 'Details'])
  expect(
    screen.queryByText('Recipient verification required')
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Details' }))
  const dialog = await screen.findByRole('dialog')
  expect(
    within(dialog).getByText('Recipient verification required')
  ).toBeVisible()
  expect(within(dialog).getByText('2026-11-30')).toBeVisible()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByText('Paid')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled()
})

test('invitation history shows masked friends, registration dates and net contributions including zero-earning friends', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        items: [
          {
            user_id: 201,
            masked_name: '林**',
            registered_at: Date.UTC(2026, 9, 28, 13, 14) / 1000,
            bound_at: Date.UTC(2026, 9, 29, 13, 14) / 1000,
            paid_cents: 128000,
            commission_cents: 41800,
          },
          {
            user_id: 202,
            masked_name: '陈**',
            paid_cents: 0,
            commission_cents: 0,
          },
        ],
        total: 2,
      },
    },
  } as AxiosResponse)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <CampusRecords kind='invitations' />
    </QueryClientProvider>
  )
  const table = await screen.findByRole('table')
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent)
  ).toEqual([
    'Friend',
    'Registration time',
    'Cumulative top-ups',
    'Commission contributed',
  ])
  const rows = within(table).getAllByRole('row')
  expect(within(rows[1]).getByText('林**')).toBeVisible()
  expect(within(rows[1]).getByText('Oct 28, 2026, 9:14 PM')).toBeVisible()
  expect(within(rows[1]).getByText(/1,280\.00/)).toBeVisible()
  expect(within(rows[1]).getByText(/418\.00/)).toBeVisible()
  expect(within(rows[2]).getByText('陈**')).toBeVisible()
  expect(within(rows[2]).getByText('—')).toBeVisible()
  expect(within(rows[2]).getAllByText(/0\.00/)).toHaveLength(2)
  expect(
    screen.queryByText('Only friends bound to you are shown; names are masked.')
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
})
