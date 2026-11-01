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
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosResponse } from 'axios'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { CampusAdmin } from '../admin'
import type { CampaignConfig } from '../api'

const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
})

function renderConfiguration(enabled = false) {
  let config: CampaignConfig = {
    enabled,

    tiers: [
      { floor_cents: 0, rate_bps: 3000 },
      { floor_cents: 200000, rate_bps: 3500 },
    ],
    tier_revision: 0,
    plan_rates: [{ plan_id: 1, rate_bps: 500 }],
    plan_revision: 0,
    plan_options: [
      {
        id: 1,
        title: 'Plus',
        enabled: true,
        price_amount: 128,
        currency: 'USD',
      },
      {
        id: 2,
        title: 'Ultra',
        enabled: true,
        price_amount: 588,
        currency: 'USD',
      },
    ],
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  clients.push(client)
  client.setQueryData(['campus', 'config'], config)
  client.setQueryData(['campus', 'records', true, 'withdrawals', 1], {
    items: [],
    total: 0,
  })
  vi.spyOn(api, 'get').mockImplementation(
    async (url) =>
      ({
        data: {
          success: true,
          data:
            url === '/api/campus/admin/config'
              ? config
              : { items: [], total: 0 },
        },
      }) as AxiosResponse
  )
  const put = vi
    .spyOn(api, 'put')
    .mockImplementation(async (_url, data: unknown) => {
      const payload = data as CampaignConfig

      if (_url === '/api/campus/admin/tiers') {
        config = {
          ...config,
          tiers: payload.tiers,
          tier_revision: config.tier_revision + 1,
        }
      } else if (_url === '/api/campus/admin/plan-rates') {
        config = {
          ...config,
          plan_rates: payload.plan_rates,
          plan_revision: config.plan_revision + 1,
        }
      } else config = { ...config, ...payload } as CampaignConfig
      return { data: { success: true, data: config } } as AxiosResponse
    })
  render(
    <QueryClientProvider client={client}>
      <CampusAdmin />
    </QueryClientProvider>
  )
  return { put, client, user: userEvent.setup() }
}

test('top-level tabs separate settings from each record list and retain unsaved settings when returning', async () => {
  const { user, put } = renderConfiguration()
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
    'Campaign settings',
    'Withdrawals',
    'Commission orders',
    'Refunds',
    'Audit trail',
    'Invitations',
  ])
  const settingsTab = screen.getByRole('tab', { name: 'Campaign settings' })
  expect(settingsTab).toHaveAttribute('aria-selected', 'true')
  const rate = screen.getByRole('textbox', { name: 'Tier 1 commission (%)' })
  await user.clear(rate)
  await user.type(rate, '25.50')

  for (const name of [
    'Withdrawals',
    'Commission orders',
    'Refunds',
    'Audit trail',
    'Invitations',
  ]) {
    await user.click(screen.getByRole('tab', { name }))
    expect(screen.getByRole('tabpanel', { name })).toBeVisible()
    expect(await screen.findByText('No records yet')).toBeVisible()
    expect(screen.queryByRole('switch', { name: 'Enable campaign' })).toBeNull()
    expect(screen.getByText('Refund registration')).not.toBeVisible()
  }

  await user.click(settingsTab)
  expect(
    screen.getByRole('tabpanel', { name: 'Campaign settings' })
  ).toBeVisible()
  expect(rate).toBeVisible()
  expect(rate).toHaveValue('25.50')
  expect(screen.queryByRole('table')).toBeNull()
  expect(put).not.toHaveBeenCalled()
})

test.each([false, true])(
  'changing the campaign from enabled=%s saves immediately without a confirmation dialog',
  async (enabled) => {
    const { user, put } = renderConfiguration(enabled)
    await user.click(screen.getByRole('switch', { name: 'Enable campaign' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(
        screen.getByRole('switch', { name: 'Enable campaign' })
      ).toHaveAttribute('aria-checked', String(!enabled))
    )
    expect(put).toHaveBeenCalledExactlyOnceWith('/api/campus/admin/config', {
      enabled: !enabled,
    })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  }
)

test('a failed activation keeps the previous switch state and allows retry without a dialog', async () => {
  const { user, put } = renderConfiguration()
  put.mockRejectedValueOnce(new Error('offline'))
  const control = screen.getByRole('switch', { name: 'Enable campaign' })
  await user.click(control)
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
  await waitFor(() =>
    expect(control).not.toHaveAttribute('aria-disabled', 'true')
  )
  expect(control).not.toBeChecked()
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  await user.click(control)
  await waitFor(() => expect(control).toBeChecked())
})

test('activation waits for the server and prevents repeated switch saves while pending', async () => {
  const { user, put } = renderConfiguration()
  let resolve!: (response: AxiosResponse) => void
  put.mockImplementationOnce(
    () =>
      new Promise<AxiosResponse>((done) => {
        resolve = done
      })
  )
  const control = screen.getByRole('switch', { name: 'Enable campaign' })
  await user.click(control)
  expect(control).toHaveAttribute('aria-disabled', 'true')
  expect(control).not.toBeChecked()
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  await user.click(control)
  expect(put).toHaveBeenCalledTimes(1)
  await act(async () => {
    resolve({
      data: { success: false, message: 'Operation failed' },
    } as AxiosResponse)
  })
  await waitFor(() =>
    expect(control).not.toHaveAttribute('aria-disabled', 'true')
  )
  expect(control).not.toBeChecked()
})

test('changing campaign status preserves unsaved tier edits until the tier save is clicked', async () => {
  const { user, put } = renderConfiguration()
  const upper = screen.getByRole('textbox', {
    name: 'Tier 1 upper bound (CNY)',
  })
  await user.clear(upper)
  await user.type(upper, '1000.50')
  await user.click(screen.getByRole('switch', { name: 'Enable campaign' }))
  await waitFor(() =>
    expect(
      screen.getByRole('switch', { name: 'Enable campaign' })
    ).toBeChecked()
  )
  expect(upper).toHaveValue('1000.50')
  expect(put).toHaveBeenCalledExactlyOnceWith('/api/campus/admin/config', {
    enabled: true,
  })
  await user.click(
    screen.getByRole('button', { name: 'Save commission tiers' })
  )
  await waitFor(() =>
    expect(put).toHaveBeenLastCalledWith('/api/campus/admin/tiers', {
      tier_revision: 0,
      tiers: [
        { floor_cents: 0, rate_bps: 3000 },
        { floor_cents: 100050, rate_bps: 3500 },
      ],
    })
  )
})

test('administrators can add and delete tiers and save decimal commission rates', async () => {
  const { user, put } = renderConfiguration()
  await user.click(screen.getByRole('button', { name: 'Add tier' }))
  await user.type(
    screen.getByRole('textbox', { name: 'Tier 2 upper bound (CNY)' }),
    '5000'
  )
  const rate = screen.getByRole('textbox', { name: 'Tier 3 commission (%)' })
  await user.clear(rate)
  await user.type(rate, '42.75')
  await user.click(screen.getByRole('button', { name: 'Remove tier 2' }))
  await user.click(
    screen.getByRole('button', { name: 'Save commission tiers' })
  )
  await waitFor(() =>
    expect(put).toHaveBeenCalledExactlyOnceWith('/api/campus/admin/tiers', {
      tier_revision: 0,
      tiers: [
        { floor_cents: 0, rate_bps: 3000 },
        { floor_cents: 500000, rate_bps: 4275 },
      ],
    })
  )
})

test('invalid ranges and out-of-range percentages cannot be saved', async () => {
  const { user, put } = renderConfiguration()
  const upper = screen.getByRole('textbox', {
    name: 'Tier 1 upper bound (CNY)',
  })
  await user.clear(upper)
  await user.type(upper, '0')
  const rate = screen.getByRole('textbox', { name: 'Tier 1 commission (%)' })
  await user.clear(rate)
  await user.type(rate, '100.01')
  await user.click(
    screen.getByRole('button', { name: 'Save commission tiers' })
  )
  expect(
    await screen.findByText('Tier boundaries must increase from zero')
  ).toBeVisible()
  expect(
    screen.getByText(
      'Enter a percentage from 0 to 100 with at most two decimal places'
    )
  ).toBeVisible()
  expect(put).not.toHaveBeenCalled()
})

test('subscription rules use a plan dropdown and save independent percentages without changing tiers', async () => {
  const { user, put } = renderConfiguration()
  await user.click(
    screen.getByRole('button', { name: 'Add subscription plan' })
  )
  const planSelect = screen.getByRole('combobox', {
    name: 'Subscription plan 2',
  })
  await user.click(planSelect)
  expect(planSelect).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('option', { name: 'Plus · #1' })).toHaveAttribute(
    'aria-disabled',
    'true'
  )
  await user.click(screen.getByRole('option', { name: 'Ultra · #2' }))
  expect(planSelect).toHaveTextContent('Ultra · #2')
  expect(planSelect).toHaveAttribute('aria-expanded', 'false')
  const rate = screen.getByRole('textbox', {
    name: 'Subscription commission 2 (%)',
  })
  await user.clear(rate)
  await user.type(rate, '12.34')
  await user.click(
    screen.getByRole('button', { name: 'Save subscription commissions' })
  )
  await waitFor(() =>
    expect(put).toHaveBeenCalledExactlyOnceWith(
      '/api/campus/admin/plan-rates',
      {
        plan_revision: 0,
        plan_rates: [
          { plan_id: 1, rate_bps: 500 },
          { plan_id: 2, rate_bps: 1234 },
        ],
      }
    )
  )
  expect(screen.getByText('Refund registration')).toBeVisible()
})

test('a failed tier save retains the draft and lets the administrator retry', async () => {
  const { user, put } = renderConfiguration()
  const rate = screen.getByRole('textbox', { name: 'Tier 1 commission (%)' })
  await user.clear(rate)
  await user.type(rate, '25.50')
  put.mockRejectedValueOnce(new Error('offline'))
  await user.click(
    screen.getByRole('button', { name: 'Save commission tiers' })
  )
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Save commission tiers' })
    ).toBeEnabled()
  )
  expect(rate).toHaveValue('25.50')
  await user.click(
    screen.getByRole('button', { name: 'Save commission tiers' })
  )
  await waitFor(() => expect(put).toHaveBeenCalledTimes(2))
})

test('removing every participating subscription saves an explicit empty list', async () => {
  const { user, put } = renderConfiguration()
  await user.click(
    screen.getByRole('button', { name: 'Remove subscription plan 1' })
  )
  expect(
    screen.getByText('No subscription plans participate in commission yet.')
  ).toBeVisible()
  await user.click(
    screen.getByRole('button', { name: 'Save subscription commissions' })
  )
  await waitFor(() =>
    expect(put).toHaveBeenCalledExactlyOnceWith(
      '/api/campus/admin/plan-rates',
      { plan_revision: 0, plan_rates: [] }
    )
  )
})
