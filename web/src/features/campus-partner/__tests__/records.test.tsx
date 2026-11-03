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

import { matchesRecordFilters } from '../record-filter-matching'
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
            account: 'person@example.com',
            real_name: '测试姓名',
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
  expect(within(dialog).getByText('person@example.com')).toBeVisible()
  expect(within(dialog).getByText('测试姓名')).toBeVisible()
  expect(within(dialog).getByText('Alipay account')).toBeVisible()
  expect(within(dialog).getByText('ID')).toBeVisible()
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

test.each([false, true])(
  'withdrawal timestamps include seconds and admin=%s controls the leading user column',
  async (admin) => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: {
          items: [
            {
              id: 8,
              user_id: 42,
              username: 'partner42',
              display_name: 'Partner',
              created_at: Date.UTC(2026, 10, 3, 6, 12, 37) / 1000,
              amount_cents: 10000,
              state: 'requested',
            },
          ],
          total: 1,
        },
      },
    } as AxiosResponse)
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <CampusRecords kind='withdrawals' admin={admin} />
      </QueryClientProvider>
    )
    const table = await screen.findByRole('table')
    expect(within(table).getByText(/14:12:37/)).toBeVisible()
    expect(within(table).getAllByRole('columnheader')[0]).toHaveTextContent(
      admin ? 'User' : 'Time'
    )
    if (admin) {
      expect(within(table).getByText('partner42')).toBeVisible()
      expect(within(table).getByText('#42')).toBeVisible()
    } else {
      expect(within(table).queryByText('partner42')).not.toBeInTheDocument()
    }
  }
)

test('admin refunds show payer, second-precision time and the original order number', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        items: [
          {
            id: 9,
            user_id: 42,
            username: 'payer42',
            trade_no: 'original-order-9',
            created_at: Date.UTC(2026, 10, 3, 6, 12, 37) / 1000,
            amount_cents: 10000,
          },
        ],
        total: 1,
      },
    },
  } as AxiosResponse)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <CampusRecords kind='refunds' admin />
    </QueryClientProvider>
  )
  const table = await screen.findByRole('table')
  expect(
    within(table)
      .getAllByRole('columnheader')
      .slice(0, 3)
      .map((header) => header.textContent)
  ).toEqual(['User', 'Time', 'Order number'])
  expect(within(table).getByText('payer42')).toBeVisible()
  expect(within(table).getByText('original-order-9')).toBeVisible()
  expect(within(table).getByText(/14:12:37/)).toBeVisible()
})

test('withdrawal status filtering includes matches beyond the first server page', async () => {
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    let items = [{ id: 1, user_id: 1, state: 'pending', amount_cents: 100 }]
    const total = 101
    if (String(url).includes('size=100')) {
      items = String(url).includes('page=2')
        ? [{ id: 101, user_id: 1, state: 'paid', amount_cents: 12345 }]
        : Array.from({ length: 100 }, (_, index) => ({
            id: index + 1,
            user_id: 1,
            state: 'pending',
            amount_cents: 100,
          }))
    }
    return { data: { success: true, data: { items, total } } } as AxiosResponse
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <CampusRecords kind='withdrawals' admin />
    </QueryClientProvider>
  )
  await user.click(await screen.findByRole('combobox', { name: 'Status' }))
  await user.click(screen.getByRole('option', { name: /^Paid$/ }))
  await user.click(screen.getByRole('button', { name: 'Search' }))
  expect(await screen.findByText(/123\.45/)).toBeVisible()
  expect(screen.queryByText('Awaiting review')).not.toBeInTheDocument()
  expect(get).toHaveBeenCalledWith(
    '/api/campus/admin/records/withdrawals?page=2&size=100'
  )
  expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
  client.clear()
})

test('admin commissions show inviter and invitee before the partner-style columns', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        items: [
          {
            id: 1,
            user_id: 42,
            username: 'buyer42',
            inviter_id: 7,
            inviter_username: 'partner7',
            trade_no: 'payment-1',
            eligibility: 'eligible',
            commission_cents: 3500,
          },
        ],
        total: 1,
      },
    },
  } as AxiosResponse)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <CampusRecords kind='payments' admin />
    </QueryClientProvider>
  )
  const table = await screen.findByRole('table')
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent)
  ).toEqual([
    'Inviter',
    'Invitee',
    'Time',
    'Order number',
    'Top-up type',
    'Commission',
    'Status',
    'Details',
  ])
  expect(within(table).getByText('partner7')).toBeVisible()
  expect(within(table).getByText('buyer42')).toBeVisible()
  await userEvent
    .setup()
    .click(within(table).getByRole('button', { name: 'Details' }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('partner7 #7')).toBeVisible()
  expect(within(dialog).getByText('buyer42 #42')).toBeVisible()
})

test('commission filters combine time, both accounts, order and status and reset to all records', async () => {
  const rows = [
    {
      id: 1,
      user_id: 42,
      username: 'buyer',
      inviter_id: 7,
      inviter_username: 'partner',
      trade_no: 'ORDER-ABC',
      settled_at: 1791000000,
      paid_cents: 10000,
      refunded_cents: 1000,
    },
    {
      id: 2,
      user_id: 43,
      username: 'someone',
      inviter_id: 8,
      inviter_username: 'other',
      trade_no: 'ORDER-XYZ',
      settled_at: 1791000000,
      paid_cents: 10000,
      refunded_cents: 0,
    },
  ]
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { items: rows, total: 2 } },
  } as AxiosResponse)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={client}>
      <CampusRecords kind='payments' admin />
    </QueryClientProvider>
  )
  await user.type(await screen.findByRole('textbox', { name: 'Inviter' }), '#7')
  await user.type(screen.getByRole('textbox', { name: 'Invitee' }), 'buyer')
  await user.type(screen.getByRole('textbox', { name: 'Order number' }), 'abc')
  await user.click(screen.getByRole('combobox', { name: 'Status' }))
  await user.click(screen.getByRole('option', { name: 'Partially refunded' }))
  await user.click(screen.getByRole('button', { name: 'Search' }))
  expect(await screen.findByText('ORDER-ABC')).toBeVisible()
  expect(screen.queryByText('ORDER-XYZ')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Reset' }))
  expect(await screen.findByText('ORDER-XYZ')).toBeVisible()
  client.clear()
})

test('time filters include boundaries and use application time for withdrawals and settlement time for commissions', () => {
  const row = {
    id: 1,
    user_id: 42,
    username: 'buyer',
    created_at: 100,
    settled_at: 200,
  }
  expect(
    matchesRecordFilters(
      row,
      { start: new Date(100000), end: new Date(100000), user: '#42' },
      false
    )
  ).toBe(true)
  expect(matchesRecordFilters(row, { start: new Date(100001) }, false)).toBe(
    false
  )
  expect(
    matchesRecordFilters(
      row,
      { start: new Date(200000), end: new Date(200000), invitee: 'BUYER' },
      true
    )
  ).toBe(true)
  expect(matchesRecordFilters(row, { end: new Date(199999) }, true)).toBe(false)
  expect(matchesRecordFilters(row, { user: '#4' }, false)).toBe(false)
})
