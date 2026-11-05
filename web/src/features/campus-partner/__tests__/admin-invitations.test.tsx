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
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosResponse } from 'axios'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { CampusAdminInvitations } from '../admin-invitations'
import type { CampusAdminInvitation } from '../api'

const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
})
const invitation: CampusAdminInvitation = {
  user_id: 201,
  username: 'buyer-lin',
  display_name: '林同学',
  inviter_id: 101,
  inviter_username: 'partner-alice',
  inviter_display_name: '邀请人甲',
  bound_at: 1793509200,
  registered_at: 1793422800,
  paid_cents: 128000,
  commission_cents: 41800,
}
function response(
  items: CampusAdminInvitation[],
  total = items.length
): AxiosResponse {
  return { data: { success: true, data: { items, total } } } as AxiosResponse
}
function renderHistory() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <CampusAdminInvitations />
    </QueryClientProvider>
  )
  return userEvent.setup()
}

test('administrator searches both identities across all pages and resets the result to the first page', async () => {
  const get = vi
    .spyOn(api, 'get')
    .mockResolvedValueOnce(response([invitation], 41))
    .mockResolvedValueOnce(
      response(
        [
          {
            ...invitation,
            user_id: 202,
            username: 'buyer-wang',
            display_name: '王同学',
          },
        ],
        41
      )
    )
    .mockResolvedValueOnce(response([invitation]))
    .mockResolvedValue(response([]))
  const user = renderHistory()
  const row = await screen.findByRole('row', { name: /buyer-lin/ })
  for (const value of ['partner-alice', 'buyer-lin']) {
    expect(within(row).getByText(value)).toBeVisible()
  }
  expect(
    screen.getAllByRole('columnheader').map((header) => header.textContent)
  ).toEqual([
    'Inviter',
    'Invitee',
    'Binding time',
    'Registration time',
    'Cumulative top-ups',
    'Commission',
  ])
  await user.click(screen.getByRole('button', { name: 'Go to next page' }))
  expect(await screen.findByText('buyer-wang')).toBeVisible()
  await user.type(
    screen.getByRole('textbox', { name: 'Inviter' }),
    'partner-alice'
  )
  await user.type(screen.getByRole('textbox', { name: 'Invitee' }), '林')
  expect(get).toHaveBeenCalledTimes(2)
  await user.keyboard('{Enter}')
  expect(await screen.findByText('buyer-lin')).toBeVisible()
  const searched = new URL(get.mock.calls.at(-1)?.[0] ?? '', 'http://localhost')
    .searchParams
  expect(Object.fromEntries(searched)).toEqual({
    page: '1',
    size: '20',
    inviter: 'partner-alice',
    invitee: '林',
  })
  expect(screen.getByRole('button', { name: 'Go to next page' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Reset' }))
  expect(await screen.findByText('No records yet')).toBeVisible()
  expect(screen.getByRole('textbox', { name: 'Inviter' })).toHaveValue('')
  expect(screen.getByRole('textbox', { name: 'Invitee' })).toHaveValue('')
  expect(get.mock.calls.at(-1)?.[0]).toBe(
    '/api/campus/admin/records/invitations?page=1&size=20'
  )
})

test('invalid binding time ranges are blocked and valid dates are sent as timestamps', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue(response([]))
  const user = renderHistory()
  await screen.findByText('No records yet')
  await user.click(screen.getByRole('button', { name: 'Date Range' }))
  fireEvent.change(screen.getByLabelText('Start Time'), {
    target: { value: '2026-11-02T00:00:00' },
  })
  fireEvent.change(screen.getByLabelText('End Time'), {
    target: { value: '2026-11-01T23:59:59' },
  })
  await user.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(screen.getByText('End time must be after start time')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Search' }))
  expect(get).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: /2026-11-02 00:00:00/ }))
  fireEvent.change(screen.getByLabelText('Start Time'), {
    target: { value: '2026-11-01T00:00:00' },
  })
  await user.click(screen.getByRole('button', { name: 'Confirm' }))
  await user.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
  const params = new URL(get.mock.calls.at(-1)?.[0] ?? '', 'http://localhost')
    .searchParams
  expect(params.get('start_timestamp')).toBe(
    String(new Date('2026-11-01T00:00:00').getTime() / 1000)
  )
  expect(params.get('end_timestamp')).toBe(
    String(new Date('2026-11-01T23:59:59').getTime() / 1000)
  )
  expect(
    screen.queryByText('End time must be after start time')
  ).not.toBeInTheDocument()
})

test('a failed filtered request retains the search values and can be retried', async () => {
  vi.spyOn(api, 'get')
    .mockResolvedValueOnce(response([]))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue(response([invitation]))
  const user = renderHistory()
  await screen.findByText('No records yet')
  await user.type(screen.getByRole('textbox', { name: 'Inviter' }), '#101')
  await user.click(screen.getByRole('button', { name: 'Search' }))
  expect(
    await screen.findByText('Failed to load invitation records')
  ).toBeVisible()
  expect(screen.getByRole('textbox', { name: 'Inviter' })).toHaveValue('#101')
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  expect(await screen.findByText('buyer-lin')).toBeVisible()
})

test('mobile administrators can search an inviter from the shared filter drawer', async () => {
  const pointerCapture = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'setPointerCapture'
  )
  // JSDOM does not implement the pointer-capture API used by the mobile drawer.
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: () => undefined,
  })
  try {
    const matchMedia = window.matchMedia.bind(window)
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      ...matchMedia(query),
      matches: query === '(max-width: 640px)',
    }))
    const get = vi.spyOn(api, 'get').mockResolvedValue(response([invitation]))
    const user = renderHistory()
    expect(await screen.findByText('buyer-lin')).toBeVisible()
    expect(screen.getByText('partner-alice')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Filter' }))
    const dialog = await screen.findByRole('dialog', { name: 'Filter' })
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Inviter' }),
      '#101'
    )
    await user.click(within(dialog).getByRole('button', { name: 'Search' }))
    await waitFor(() =>
      expect(get.mock.calls.at(-1)?.[0]).toContain('inviter=%23101')
    )
    expect(
      screen.queryByRole('dialog', { name: 'Filter' })
    ).not.toBeInTheDocument()
  } finally {
    if (pointerCapture) {
      Object.defineProperty(
        HTMLElement.prototype,
        'setPointerCapture',
        pointerCapture
      )
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
    }
  }
})

test('administrator opens the existing user information dialog from either invitation account and closes it before opening another', async () => {
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/user/201') {
      return {
        data: {
          success: true,
          data: {
            id: 201,
            username: 'buyer-lin',
            display_name: '林同学',
            quota: 10000,
            used_quota: 100,
            request_count: 3,
            group: 'default',
          },
        },
      } as AxiosResponse
    }
    if (url === '/api/user/101') {
      return {
        data: {
          success: true,
          data: {
            id: 101,
            username: 'partner-alice',
            display_name: '邀请人甲',
            quota: 20000,
            used_quota: 200,
            request_count: 5,
            group: 'default',
          },
        },
      } as AxiosResponse
    }
    return response([invitation])
  })
  const user = renderHistory()
  const buyer = await screen.findByRole('button', {
    name: 'User Information: buyer-lin',
  })
  buyer.focus()
  await user.keyboard('{Enter}')
  const info = await screen.findByRole('dialog', { name: 'User Information' })
  expect(await within(info).findByText('林同学')).toBeVisible()
  expect(get).toHaveBeenCalledWith('/api/user/201')
  await user.click(within(info).getByRole('button', { name: 'Close' }))
  expect(
    screen.queryByRole('dialog', { name: 'User Information' })
  ).not.toBeInTheDocument()
  await user.click(
    screen.getByRole('button', { name: 'User Information: partner-alice' })
  )
  const inviter = await screen.findByRole('dialog', {
    name: 'User Information',
  })
  expect(await within(inviter).findByText('邀请人甲')).toBeVisible()
  expect(within(inviter).queryByText('林同学')).not.toBeInTheDocument()
  expect(get).toHaveBeenCalledWith('/api/user/101')
})
