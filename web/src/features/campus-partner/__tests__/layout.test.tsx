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
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, expect, test } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import { CampusPartner } from '..'
import { CampusAdmin } from '../admin'
import type { Overview } from '../api'
import type { CampusRecord } from '../records'

const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
})

function renderPage(
  page: ReactNode,
  overrides: Partial<Overview> = {},
  records: Partial<Record<string, CampusRecord[]>> = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  clients.push(client)
  client.setQueryData(['campus', 'config'], {
    enabled: false,

    tiers: [{ floor_cents: 0, rate_bps: 3000 }],
    tier_revision: 0,
    plan_rates: [],
    plan_revision: 0,
    plan_options: [],
  })
  client.setQueryData<Overview>(['campus', 'overview'], {
    enabled: false,
    expected_batch: '2026-11-30',
    version: 'v1',
    can_bind: false,
    member: {
      code: '',
      joined_at: 0,
      inviter_id: 0,
      performance_cents: 0,
      debt_cents: 0,
      coupon_state: '',
      coupon_trade: '',
    },
    frozen_cents: 0,
    available_cents: 0,
    processing_cents: 0,
    paid_cents: 0,
    net_cents: 0,
    invited: 0,
    this_month: 0,
    tiers: [{ floor_cents: 0, rate_bps: 3000 }],
    plan_rates: [],
    plan_options: [],
    tier: {
      level: 1,
      rate_percent: 30,
      floor_cents: 0,
      next_cents: 200000,
      remaining_cents: 200000,
    },
    ...overrides,
  })
  for (const kind of ['invitations', 'payments', 'entries', 'withdrawals']) {
    const items = records[kind] || []
    for (const admin of [false, true]) {
      client.setQueryData(['campus', 'records', admin, kind, 1], {
        items,
        total: items.length,
      })
    }
  }
  client.setQueryData(
    [
      'campus',
      'admin-invitations',
      useAuthStore.getState().auth.user?.id,
      { page: 1, size: 20 },
    ],
    { items: [], total: 0 }
  )
  const root = createRootRoute({ component: () => page })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

test('administration places campaign status in its own first row inside settings and keeps the shared page gutters', async () => {
  const user = userEvent.setup()
  renderPage(<CampusAdmin />)
  await user.click(
    await screen.findByRole('tab', { name: 'Campaign settings' })
  )
  const panel = await screen.findByRole('tabpanel', {
    name: 'Campaign settings',
  })
  const settings = within(panel)
    .getByText('Top-up commission tiers')
    .closest('[data-slot="card"]')
  const control = screen.getByRole('switch', { name: 'Enable campaign' })
  const heading = screen.getByRole('heading', {
    name: 'Campus Partner administration',
  })
  expect(heading.parentElement?.parentElement).not.toContainElement(control)
  expect(panel).toContainElement(control)
  expect(
    screen.getByRole('tablist').compareDocumentPosition(panel) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  expect(
    screen.queryByText('Reconcile a payment order')
  ).not.toBeInTheDocument()
  const content = settings?.parentElement
  expect(content?.firstElementChild).toBe(control.closest('[data-slot="card"]'))
  expect(content).toHaveClass('w-full', 'min-w-0', 'gap-4')
  expect(content).not.toHaveClass('mx-auto', 'max-w-6xl', 'pb-8')
  expect(within(panel).queryByText('Campaign settings')).toBeNull()
})

test('partner page merges the introduction into the invitation card before benefits, commission summary, tiers, records and rules', async () => {
  renderPage(<CampusPartner />)
  const content = await screen.findByRole('region', { name: 'Campus Partner' })
  expect(content).toHaveClass('w-full', 'min-w-0', 'gap-4')
  expect(content).not.toHaveClass('mx-auto', 'max-w-6xl', 'pb-8')
  const intro = screen.getByRole('heading', {
    name: 'Invite friends to register and earn commission on every top-up.',
  })
  const invitation = screen.getByRole('button', {
    name: 'Get my invitation code',
  })
  const benefits = screen.getByRole('heading', {
    name: 'Exclusive friend benefits',
  })
  const available = screen.getAllByText('Available commission')[0]
  const tiers = screen.getByRole('heading', {
    name: 'Top-up commission levels',
  })
  const records = screen.getByRole('tablist')
  const rules = screen.getByRole('heading', { name: 'Rules' })
  for (const [before, after] of [
    [intro, invitation],
    [invitation, benefits],
    [benefits, available],
    [available, tiers],
    [tiers, records],
    [records, rules],
  ]) {
    expect(
      before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  }
  expect(screen.getByRole('link', { name: 'Rules' })).toHaveAttribute(
    'href',
    '#campus-rules'
  )
  expect(intro.closest('[data-slot="card"]')).toContainElement(invitation)
  expect(screen.queryByText('Refund recovery due')).not.toBeInTheDocument()
})

test('partner records open on invitations and expose commission and withdrawal history through three tabs', async () => {
  const user = userEvent.setup()
  renderPage(<CampusPartner />)
  const invitations = await screen.findByRole('tab', { name: 'Invitations' })
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
    'Invitations',
    'Commission ledger',
    'Withdrawals',
  ])
  expect(invitations).toHaveAttribute('aria-selected', 'true')
  const privacyNote = screen.getByText(
    'Only friends bound to you are shown; names are masked.'
  )
  expect(privacyNote).toBeVisible()
  expect(screen.getByRole('tablist').parentElement).toContainElement(
    privacyNote
  )
  expect(
    screen.getByRole('tabpanel', { name: 'Invitations' })
  ).not.toContainElement(privacyNote)
  expect(
    within(screen.getByRole('tabpanel', { name: 'Invitations' })).getByText(
      'No records yet'
    )
  ).toBeVisible()

  await user.click(invitations)
  await user.keyboard('{ArrowRight}{Enter}')
  expect(
    screen.getByRole('tab', { name: 'Commission ledger' })
  ).toHaveAttribute('aria-selected', 'true')
  expect(
    screen.queryByText('Only friends bound to you are shown; names are masked.')
  ).not.toBeInTheDocument()
  const commission = screen.getByRole('tabpanel', { name: 'Commission ledger' })
  expect(within(commission).getByText('No records yet')).toBeVisible()
  expect(
    within(commission).queryByRole('button', { name: 'Balance changes' })
  ).not.toBeInTheDocument()

  await user.click(screen.getByRole('tab', { name: 'Withdrawals' }))
  expect(
    within(screen.getByRole('tabpanel', { name: 'Withdrawals' })).getByText(
      'No records yet'
    )
  ).toBeVisible()
})

test('commission history shows six columns and opens masked order details with the saved formula', async () => {
  const user = userEvent.setup()
  renderPage(
    <CampusPartner />,
    {},
    {
      payments: [
        {
          id: 81,
          user_id: 2,
          masked_name: '林**',
          trade_no: 'USR9***-063',
          product: 'topup',
          settled_at: 1793532605,
          paid_cents: 10000,
          commission_cents: 3000,
          reversed_cents: 500,
          refunded_cents: 1667,
          frozen_cents: 2000,
          available_cents: 500,
          segments: '[{"base_cents":10000,"rate_percent":30}]',
        },
      ],
    }
  )
  await user.click(
    await screen.findByRole('tab', { name: 'Commission ledger' })
  )
  const panel = screen.getByRole('tabpanel', { name: 'Commission ledger' })
  expect(
    within(panel)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent)
  ).toEqual([
    'Time',
    'Friend',
    'Order number',
    'Top-up type',
    'Commission',
    'Status',
    'Details',
  ])
  expect(within(panel).getByText('林**')).toBeVisible()
  expect(within(panel).getByText('林')).toBeInTheDocument()
  expect(within(panel).getByText(/19:30:05/)).toBeVisible()
  expect(within(panel).getByText('USR9***-063')).toBeVisible()
  expect(within(panel).getByText('Partially refunded')).toBeVisible()
  expect(within(panel).queryByText('Balance changes')).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.click(within(panel).getByRole('button', { name: 'Details' }))
  const dialog = await screen.findByRole('dialog', {
    name: 'Commission details',
  })
  expect(within(dialog).getByText('USR9***-063')).toBeVisible()
  expect(within(dialog).getByText(/19:30:05/)).toBeVisible()
  expect(within(dialog).getByText(/100\.00 × 30% = .*30\.00/)).toBeVisible()
  expect(within(dialog).getByText(/30\.00 − .*5\.00 = .*25\.00/)).toBeVisible()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('partner rewards reflect configured tiers and subscription percentages', async () => {
  renderPage(<CampusPartner />, {
    tiers: [
      { floor_cents: 0, rate_bps: 1250 },
      { floor_cents: 100000, rate_bps: 4275 },
    ],
    plan_rates: [{ plan_id: 9, rate_bps: 1234 }],
    plan_options: [
      {
        id: 9,
        title: 'Custom Plan',
        enabled: true,
        price_amount: 100,
        currency: 'USD',
      },
    ],
    tier: {
      level: 2,
      rate_percent: 42.75,
      floor_cents: 100000,
      next_cents: 0,
      remaining_cents: 0,
    },
  })
  const tiers = await screen.findByRole('region', {
    name: 'Top-up commission levels',
  })
  expect(within(tiers).getByText('Lv.2')).toBeVisible()
  expect(within(tiers).getByText('42.75%')).toBeVisible()
  expect(within(tiers).getByText('Custom Plan')).toBeVisible()
  expect(within(tiers).getByText('12.34%')).toBeVisible()
  expect(within(tiers).getByText('Highest partner tier reached')).toBeVisible()
  expect(within(tiers).queryByText('50%')).not.toBeInTheDocument()
})

test.each([9999, 10000])(
  'available commission of %s cents keeps the existing withdrawal threshold',
  async (available) => {
    renderPage(<CampusPartner />, { available_cents: available })
    const button = await screen.findByRole('button', {
      name: 'Request withdrawal',
    })
    const remaining = screen.queryByText(/CN¥0\.01 remaining|¥0\.01 remaining/)
    if (available < 10000) {
      expect(button).toBeDisabled()
      expect(remaining).toBeVisible()
    } else {
      expect(button).toBeEnabled()
      expect(remaining).toBeNull()
    }
  }
)

test('eligible withdrawal still opens the existing application dialog from the summary card', async () => {
  const user = userEvent.setup()
  renderPage(<CampusPartner />, {
    available_cents: 10000,
    withdrawal_account: 'person@example.com',
    withdrawal_name: '张三',
    withdrawal_cutoff: '2026-11-25',
    withdrawal_next_start: '2026-11-26',
    withdrawal_month_end: '2026-11-30',
    withdrawal_next_month_end: '2026-12-31',
  })
  await user.click(
    await screen.findByRole('button', { name: 'Request withdrawal' })
  )
  const dialog = screen.getByRole('dialog', { name: 'Request withdrawal' })
  expect(within(dialog).getByLabelText('Amount (CNY)')).toHaveValue('100.00')
  expect(within(dialog).getByLabelText('Alipay account')).toHaveValue(
    'person@example.com'
  )
  expect(within(dialog).getByLabelText('Real name')).toHaveValue('张三')
  expect(
    within(dialog).getByText(/2026-11-25.*2026-11-30.*2026-11-26.*2026-12-31/)
  ).toBeVisible()
  await user.clear(within(dialog).getByLabelText('Alipay account'))
  await user.type(
    within(dialog).getByLabelText('Alipay account'),
    '13800138000'
  )
  expect(within(dialog).getByLabelText('Alipay account')).toHaveValue(
    '13800138000'
  )
  expect(
    within(dialog).getByRole('button', { name: 'Submit for review' })
  ).toBeVisible()
})

test('existing invitation controls remain available and positive refund recovery stays visible', async () => {
  renderPage(<CampusPartner />, {
    member: {
      code: 'AB12CD',
      joined_at: 1,
      inviter_id: 0,
      performance_cents: 0,
      debt_cents: 1250,
      coupon_state: '',
      coupon_trade: '',
    },
  })
  expect(await screen.findByText('AB12CD')).toBeVisible()
  expect(screen.getByRole('textbox', { name: 'Invitation link' })).toHaveValue(
    'https://beiapi.cn/sign-up?campus=AB12CD'
  )
  expect(
    screen.getByRole('button', { name: 'Copy invitation link' })
  ).toBeEnabled()
  expect(
    screen.getByText('Exclusive campus partner invitation code')
  ).toBeVisible()
  expect(
    screen.getAllByRole('listitem').map((item) => item.textContent)
  ).toEqual([
    '1Share your link or invitation code',
    '2Friends bind and receive a 5% off coupon',
    '3Earn commission on each qualifying payment',
  ])
  expect(screen.getByText('Refund recovery due')).toBeVisible()
})

test('partner tiers display configured names and defaults for unnamed tiers', async () => {
  const name = '校园超级合伙人'.repeat(10)
  renderPage(<CampusPartner />, {
    tiers: [
      { name, floor_cents: 0, rate_bps: 3000 },
      { floor_cents: 200000, rate_bps: 3500 },
      { floor_cents: 1000000, rate_bps: 4000 },
      { floor_cents: 3000000, rate_bps: 4500 },
      { floor_cents: 8000000, rate_bps: 5000 },
      { floor_cents: 9000000, rate_bps: 5500 },
    ],
  })
  expect(await screen.findByText(name)).toHaveClass(
    'break-words',
    '[overflow-wrap:anywhere]'
  )
  for (const label of [
    'Growing partner',
    'Elite partner',
    'Senior partner',
    'Lead partner',
  ]) {
    expect(screen.getByText(label)).toBeVisible()
  }
  expect(screen.queryByText('Apprentice partner')).not.toBeInTheDocument()
  expect(screen.getAllByText('Lv.6').length).toBeGreaterThan(0)
})

test('commission composition shows four amounts and identifies each proportional segment on hover', async () => {
  const user = userEvent.setup()
  renderPage(<CampusPartner />, {
    available_cents: 40000,
    frozen_cents: 10000,
    processing_cents: 20000,
    paid_cents: 30000,
    net_cents: 100000,
  })
  const composition = await screen.findByRole('group', {
    name: 'Commission ledger',
  })
  for (const label of ['Withdrawable', 'Settling', 'Withdrawing', 'Paid out']) {
    expect(within(composition).getByText(label)).toBeVisible()
  }
  const segment = within(composition).getByLabelText(/Withdrawable.*400\.00/)
  expect(segment).toHaveStyle({ width: '40%' })
  expect(segment).not.toHaveAccessibleName(/%/)
  await user.hover(segment)
  expect(await screen.findByText(/Withdrawable.*400\.00/)).toHaveTextContent(
    /Withdrawable.*400\.00/
  )
})

test('zero commission retains all four legend amounts without creating invalid segments', async () => {
  renderPage(<CampusPartner />)
  const composition = await screen.findByRole('group', {
    name: 'Commission ledger',
  })
  expect(within(composition).getAllByText(/0\.00/)).toHaveLength(4)
  expect(
    composition.querySelectorAll('[data-slot="tooltip-trigger"]')
  ).toHaveLength(0)
})

test('partner summary uses content-sized statistics without reserving empty chart space', async () => {
  renderPage(<CampusPartner />)
  const title = await screen.findByText('Lifetime commission')
  const stat = title.closest('.group')
  expect(stat).not.toHaveClass('sm:min-h-32', 'justify-between')
  expect(stat?.querySelector('.h-8')).toBeNull()
  expect(title.closest('[data-slot="card"]')).toHaveAttribute('data-size', 'sm')
})
