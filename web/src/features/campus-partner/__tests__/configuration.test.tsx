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
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
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

async function renderConfiguration(enabled = false, openSettings = true) {
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
  client.setQueryData(['campus', 'records', true, 'withdrawals', 1, {}, 10], {
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
  const user = userEvent.setup()
  if (openSettings) {
    await user.click(screen.getByRole('tab', { name: 'Campaign settings' }))
  }
  return { put, client, user }
}

test('top-level tabs separate settings from each record list and retain unsaved settings when returning', async () => {
  const { user, put } = await renderConfiguration(false, false)
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
    'Campaign settings',
    'Invitations',
    'Commission ledger',
    'Withdrawals',
    'Refunds',
  ])
  expect(screen.getByRole('tab', { name: 'Invitations' })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  const settingsTab = screen.getByRole('tab', { name: 'Campaign settings' })
  await user.click(settingsTab)
  expect(settingsTab).toHaveAttribute('aria-selected', 'true')
  const rate = screen.getByRole('textbox', { name: 'Tier 1 commission (%)' })
  await user.clear(rate)
  await user.type(rate, '25.50')

  for (const name of [
    'Withdrawals',
    'Commission ledger',
    'Refunds',
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
  expect(
    screen.getByRole('table', { name: 'Top-up commission tiers' })
  ).toBeVisible()
  expect(screen.queryByText('No records yet')).not.toBeInTheDocument()
  expect(put).not.toHaveBeenCalled()
})

test.each([false, true])(
  'changing the campaign from enabled=%s requires confirmation before saving',
  async (enabled) => {
    const { user, put } = await renderConfiguration(enabled)
    await user.click(screen.getByRole('switch', { name: 'Enable campaign' }))
    expect(screen.getByRole('alertdialog')).toBeVisible()
    expect(put).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Continue' }))
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

test('a failed activation keeps the previous switch state and allows retry in the dialog', async () => {
  const { user, put } = await renderConfiguration()
  put.mockRejectedValueOnce(new Error('offline'))
  const control = screen.getByRole('switch', { name: 'Enable campaign' })
  await user.click(control)
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
  await waitFor(() =>
    expect(control).not.toHaveAttribute('aria-disabled', 'true')
  )
  expect(control).not.toBeChecked()
  expect(screen.getByRole('alertdialog')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await waitFor(() => expect(control).toBeChecked())
})

test('activation waits for the server and prevents repeated switch saves while pending', async () => {
  const { user, put } = await renderConfiguration()
  let resolve!: (response: AxiosResponse) => void
  put.mockImplementationOnce(
    () =>
      new Promise<AxiosResponse>((done) => {
        resolve = done
      })
  )
  const control = screen.getByRole('switch', { name: 'Enable campaign' })
  await user.click(control)
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  expect(control).toHaveAttribute('aria-disabled', 'true')
  expect(control).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
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
  const { user, put } = await renderConfiguration()
  const upper = screen.getByRole('textbox', {
    name: 'Tier 1 upper bound (CNY)',
  })
  await user.clear(upper)
  await user.type(upper, '1000.50')
  await user.click(screen.getByRole('switch', { name: 'Enable campaign' }))
  await user.click(screen.getByRole('button', { name: 'Continue' }))
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

test('administrators can edit, add and delete table rows and save decimal commission rates', async () => {
  const { user, put } = await renderConfiguration()
  const table = within(
    screen.getByRole('table', { name: 'Top-up commission tiers' })
  )
  expect(table.getAllByRole('row')).toHaveLength(3)
  await user.click(screen.getByRole('button', { name: 'Add tier' }))
  const tierRows = table.getAllByRole('row')
  expect(tierRows).toHaveLength(4)
  await user.type(
    within(tierRows[2]).getByRole('textbox', {
      name: 'Tier 2 upper bound (CNY)',
    }),
    '5000'
  )
  const rate = within(tierRows[3]).getByRole('textbox', {
    name: 'Tier 3 commission (%)',
  })
  await user.clear(rate)
  await user.type(rate, '42.75')
  expect(rate).toHaveFocus()
  expect(
    within(tierRows[3]).getByRole('textbox', {
      name: 'Tier 3 lower bound (CNY)',
    })
  ).toHaveValue('5000')
  expect(
    within(tierRows[3]).queryByRole('textbox', {
      name: 'Tier 3 upper bound (CNY)',
    })
  ).toBeNull()
  await user.click(
    within(tierRows[2]).getByRole('button', { name: 'Remove tier 2' })
  )
  expect(table.getAllByRole('row')).toHaveLength(3)
  expect(
    table.getByRole('textbox', { name: 'Tier 2 lower bound (CNY)' })
  ).toHaveValue('5000')
  expect(
    table.getByRole('textbox', { name: 'Tier 1 upper bound (CNY)' })
  ).toHaveValue('5000')
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

test('editing either side of a shared range boundary updates the adjacent tier and saves one boundary', async () => {
  const { user, put } = await renderConfiguration()
  const table = within(
    screen.getByRole('table', { name: 'Top-up commission tiers' })
  )
  expect(
    table.getByRole('columnheader', {
      name: 'Cumulative paid sales range (CNY)',
    })
  ).toBeVisible()
  expect(
    table.getByRole('textbox', { name: 'Tier 1 lower bound (CNY)' })
  ).toHaveAttribute('readonly')
  const upper = table.getByRole('textbox', { name: 'Tier 1 upper bound (CNY)' })
  const lower = table.getByRole('textbox', { name: 'Tier 2 lower bound (CNY)' })
  await user.clear(upper)
  await user.type(upper, '1000.50')
  expect(upper).toHaveFocus()
  expect(lower).toHaveValue('1000.50')
  await user.clear(lower)
  await user.type(lower, '1500.25')
  expect(lower).toHaveFocus()
  expect(upper).toHaveValue('1500.25')
  expect(put).not.toHaveBeenCalled()
  await user.click(
    screen.getByRole('button', { name: 'Save commission tiers' })
  )
  await waitFor(() =>
    expect(put).toHaveBeenCalledExactlyOnceWith('/api/campus/admin/tiers', {
      tier_revision: 0,
      tiers: [
        { floor_cents: 0, rate_bps: 3000 },
        { floor_cents: 150025, rate_bps: 3500 },
      ],
    })
  )
})

test('invalid ranges and out-of-range percentages cannot be saved', async () => {
  const { user, put } = await renderConfiguration()
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
  const boundaryErrors = await screen.findAllByText(
    'Tier boundaries must increase from zero'
  )
  expect(boundaryErrors).toHaveLength(2)
  boundaryErrors.forEach((error) => expect(error).toBeVisible())
  expect(
    screen.getByText(
      'Enter a percentage from 0 to 100 with at most two decimal places'
    )
  ).toBeVisible()
  expect(put).not.toHaveBeenCalled()
})

test('subscription rules use a plan dropdown and save independent percentages without changing tiers', async () => {
  const { user, put } = await renderConfiguration()
  await user.click(
    screen.getByRole('button', { name: 'Add subscription plan' })
  )
  const plansTable = screen.getByRole('table', {
    name: 'Subscription commissions',
  })
  expect(within(plansTable).getAllByRole('row')).toHaveLength(3)
  expect(
    within(plansTable)
      .getAllByRole('columnheader')
      .map((header) => header.textContent)
  ).toEqual(['Plan', 'Subscription commission rates (%)', 'Actions'])
  for (const number of [1, 2]) {
    expect(
      within(plansTable).getByText(`Subscription plan ${number}`)
    ).toHaveClass('sr-only')
    expect(
      within(plansTable).getByText(`Subscription commission ${number} (%)`)
    ).toHaveClass('sr-only')
    expect(
      within(plansTable).getByRole('combobox', {
        name: `Subscription plan ${number}`,
      })
    ).toBeVisible()
  }
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
  const { user, put } = await renderConfiguration()
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
  const { user, put } = await renderConfiguration()
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

test('tier names save trimmed text and remain editable after reloading settings', async () => {
  const { user, put } = await renderConfiguration()
  const name = screen.getByRole('textbox', { name: 'Tier 1 name' })
  expect(name).toHaveAttribute('placeholder', 'Apprentice partner')
  await user.type(name, '  校园新星  ')
  await user.click(
    screen.getByRole('button', { name: 'Save commission tiers' })
  )
  await waitFor(() =>
    expect(put).toHaveBeenCalledExactlyOnceWith('/api/campus/admin/tiers', {
      tier_revision: 0,
      tiers: [
        { name: '校园新星', floor_cents: 0, rate_bps: 3000 },
        { floor_cents: 200000, rate_bps: 3500 },
      ],
    })
  )
  expect(
    await screen.findByRole('textbox', { name: 'Tier 1 name' })
  ).toHaveValue('校园新星')
})

test('tier names longer than 80 characters show a validation error and cannot save', async () => {
  const { user, put } = await renderConfiguration()
  await user.type(
    screen.getByRole('textbox', { name: 'Tier 1 name' }),
    '星'.repeat(81)
  )
  await user.click(
    screen.getByRole('button', { name: 'Save commission tiers' })
  )
  expect(
    await screen.findByText('Tier names must be at most 80 characters')
  ).toBeVisible()
  expect(screen.getByRole('textbox', { name: 'Tier 1 name' })).toHaveAttribute(
    'aria-invalid',
    'true'
  )
  expect(put).not.toHaveBeenCalled()
})

test.each([false, true])(
  'cancelling a campaign toggle from %s keeps the saved state',
  async (enabled) => {
    const { user, put } = await renderConfiguration(enabled)
    await user.click(screen.getByRole('switch', { name: 'Enable campaign' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(put).not.toHaveBeenCalled()
    expect(
      screen.getByRole('switch', { name: 'Enable campaign' })
    ).toHaveAttribute('aria-checked', String(enabled))
  }
)

test.each([
  ['pending', ['Approve', 'Pause', 'Reject', 'Defer batch']],
  [
    'approved',
    [
      'Pause',
      'Reject',
      'Result unknown',
      'Confirmed transfer failure',
      'Defer batch',
      'Record completed transfer',
    ],
  ],
  ['paused', ['Resume review', 'Reject', 'Defer batch']],
  ['unknown', ['Confirmed transfer failure', 'Record completed transfer']],
  ['paid', []],
  ['rejected', []],
  ['failed', []],
  ['cancelled', []],
] as [string, string[]][])(
  'withdrawal state %s gates transfer registration on approval',
  async (state, expectedActions) => {
    const { user, client } = await renderConfiguration(false, false)
    await act(async () => {
      client.setQueryData(
        ['campus', 'records', true, 'withdrawals', 1, {}, 10],
        {
          items: [
            {
              id: 91,
              user_id: 1,
              username: 'partner-test',
              state,
              amount_cents: 10000,
              partner_tier: { level: 2, rate_percent: 35 },
              partner_tier_name: 'Campus star',
              performance_cents: 200000,
              total_commission_cents: 123456,
            },
          ],
          total: 1,
        }
      )
    })
    await user.click(screen.getByRole('tab', { name: 'Withdrawals' }))
    await user.click(await screen.findByRole('button', { name: 'Manage' }))
    const dialog = within(screen.getByRole('dialog', { name: 'Manage' }))
    const actionLabels = [
      'Approve',
      'Pause',
      'Resume review',
      'Reject',
      'Result unknown',
      'Confirmed transfer failure',
      'Defer batch',
      'Record completed transfer',
    ]
    for (const label of actionLabels) {
      const button = dialog.queryByRole('button', { name: label })
      if (expectedActions.includes(label)) expect(button).toBeVisible()
      else expect(button).toBeNull()
    }
    if (expectedActions.length === 0) {
      expect(
        dialog.queryByRole('button', { name: 'Confirm operation' })
      ).toBeNull()
    }
    expect(dialog.getByText('partner-test (#1)')).toBeVisible()
    expect(dialog.getByText('Lv.2 · Campus star')).toBeVisible()
    expect(dialog.getByText('35%')).toBeVisible()
    expect(dialog.getByText('Total commission')).toBeVisible()
    expect(dialog.getByText(/1,234.56/)).toBeVisible()
    expect(dialog.getByText('Withdrawal time')).toBeVisible()
    expect(dialog.getByText('Alipay account')).toBeVisible()
    expect(dialog.getByText('Expected payout')).toBeVisible()
    if (state === 'pending') {
      expect(
        dialog.getByPlaceholderText('Enter approval reason (optional)')
      ).toBeVisible()
      const approve = dialog.getByRole('button', { name: 'Approve' })
      const pause = dialog.getByRole('button', { name: 'Pause' })
      expect(approve).toHaveAttribute('aria-pressed', 'true')
      expect(pause).toHaveAttribute('aria-pressed', 'false')
      approve.focus()
      await user.keyboard('{ArrowRight} ')
      expect(pause).toHaveFocus()
      expect(pause).toHaveAttribute('aria-pressed', 'true')
      expect(approve).toHaveAttribute('aria-pressed', 'false')
      expect(
        dialog.getByPlaceholderText('Enter pause reason (optional)')
      ).toBeVisible()
      const post = vi
        .spyOn(api, 'post')
        .mockResolvedValue({ data: { success: true } } as AxiosResponse)
      await user.click(
        dialog.getByRole('button', { name: 'Confirm operation' })
      )
      await waitFor(() =>
        expect(post).toHaveBeenCalledWith(
          '/api/campus/admin/withdrawals/91',
          expect.objectContaining({ action: 'pause', reason: '' })
        )
      )
      return
    }
    if (state === 'approved' || state === 'unknown') {
      expect(
        dialog.getByRole('button', { name: 'Record completed transfer' })
      ).toBeVisible()
      expect(
        dialog.getByLabelText('Actual transfer time (Beijing)')
      ).toBeVisible()
    } else {
      expect(
        dialog.queryByRole('button', { name: 'Record completed transfer' })
      ).toBeNull()
      expect(
        dialog.queryByLabelText('Actual transfer time (Beijing)')
      ).toBeNull()
    }
  }
)

test('refund preview groups compact adjustment rows and cancelling does not record the refund', async () => {
  const { user } = await renderConfiguration()
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: true,
      data: {
        refund_cents: 1000,
        reversal_cents: 350,
        immediate_cents: 200,
        debt_cents: 150,
        performance_cents: 190000,
        expected_refunded_cents: 0,
      },
    },
  } as AxiosResponse)
  for (const [label, value] of [
    ['Original order number', 'ORDER-1'],
    ['Unique refund reference', 'REFUND-1'],
    ['Refund amount (CNY)', '10.00'],
    ['Reason and reconciliation evidence', 'Refund receipt checked'],
  ]) {
    await user.type(screen.getByRole('textbox', { name: label }), value)
  }
  await user.click(
    screen.getByRole('button', { name: 'Preview refund adjustment' })
  )
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Confirm refund adjustment',
  })
  const label = within(dialog).getByText('Commission reversal')
  expect(label).toHaveClass('text-xs')
  expect(label.parentElement?.parentElement).toHaveClass('border', 'rounded-md')
  expect(within(dialog).getByText(/3\.50/)).toHaveClass('font-mono!')
  expect(within(dialog).getByText(/1,900\.00/)).toBeVisible()
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(post).toHaveBeenCalledTimes(1)
  expect(post).toHaveBeenCalledWith(
    '/api/campus/admin/refund',
    expect.objectContaining({ preview: true })
  )
})
