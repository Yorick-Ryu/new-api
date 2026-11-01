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
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, test } from 'vitest'

import { CampusPartner } from '..'
import { CampusAdmin } from '../admin'
import type { Overview } from '../api'

const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
})

function renderPage(page: ReactNode, overrides: Partial<Overview> = {}) {
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
  client.setQueryData(['campus', 'records', true, 'withdrawals', 1], {
    items: [],
    total: 0,
  })
  client.setQueryData(['campus', 'records', false, 'payments', 1], {
    items: [],
    total: 0,
  })
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

test('administration panels use the shared page gutters and natural panel heights on a responsive grid', async () => {
  renderPage(<CampusAdmin />)
  const settings = (await screen.findByText('Campaign settings')).closest(
    '[data-slot="card"]'
  )
  expect(
    screen.queryByText('Reconcile a payment order')
  ).not.toBeInTheDocument()
  const grid = settings?.parentElement
  const content = grid?.parentElement
  expect(content).toHaveClass('w-full', 'min-w-0', 'gap-4')
  expect(content).not.toHaveClass('mx-auto', 'max-w-6xl', 'pb-8')
  expect(grid).toHaveClass('grid', 'items-start', 'gap-4', 'lg:grid-cols-2')
  expect(settings?.querySelector('[data-slot="card-content"]')).toHaveClass(
    'gap-4'
  )
})

test('partner content aligns with the shared page gutters without an extra centered width constraint', async () => {
  renderPage(<CampusPartner />)
  const content = (
    await screen.findByRole('heading', {
      name: 'Your recommendations deserve a reward.',
    })
  ).closest('section')?.parentElement
  expect(content).toHaveClass('w-full', 'min-w-0', 'gap-4')
  expect(content).not.toHaveClass('mx-auto', 'max-w-6xl', 'pb-8')
})

test('partner rewards and maximum rate reflect configured tiers and subscription percentages', async () => {
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
  expect(await screen.findByText('Tier 2')).toBeVisible()
  expect(screen.getByText('Custom Plan · 12.34%')).toBeVisible()
  expect(screen.getByText('42.75')).toBeVisible()
  expect(screen.queryByText('50')).not.toBeInTheDocument()
})
