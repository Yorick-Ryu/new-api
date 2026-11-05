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
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { CommissionDetails } from '../commission-records'
import type { CampusRecord } from '../records'
import { WithdrawalDetails, WithdrawalSummary } from '../withdrawal-details'

afterEach(() => vi.restoreAllMocks())

test('commission details align long order identifiers beside compact labels and group amounts and calculations', () => {
  const order = 'ORDER-'.repeat(50)
  render(
    <CommissionDetails
      row={{
        id: 1,
        user_id: 42,
        trade_no: order,
        paid_cents: 10000,
        commission_cents: 3500,
        frozen_cents: 700,
        refunded_cents: 1000,
        reversed_cents: 350,
        segments: JSON.stringify([{ base_cents: 10000, rate_percent: 35 }]),
      }}
      onClose={vi.fn()}
    />
  )
  const dialog = screen.getByRole('dialog', { name: 'Commission details' })
  expect(dialog).toHaveClass('sm:max-w-lg', 'overflow-hidden')
  expect(
    within(dialog).queryByText('Settlement freeze')
  ).not.toBeInTheDocument()
  expect(within(dialog).queryByText(/7\.00/)).not.toBeInTheDocument()
  const label = within(dialog).getByText('Order number')
  expect(label).toHaveClass('text-xs')
  expect(label.parentElement).toHaveClass(
    'grid-cols-[5.25rem_minmax(0,1fr)]',
    'sm:grid-cols-[7rem_minmax(0,1fr)]'
  )
  expect(within(dialog).getByText(order)).toHaveClass('break-all')
  expect(
    within(dialog).getByText('Actual payment (CNY)').parentElement
      ?.parentElement
  ).toHaveClass('border', 'rounded-md')
  expect(within(dialog).getByText(/100\.00 × 35% = .*35\.00/)).toHaveClass(
    'text-xs'
  )
  expect(within(dialog).getByText('Refund Details')).toBeVisible()
  expect(within(dialog).getByText(/35\.00 − .*3\.50 = .*31\.50/)).toBeVisible()
})

test('withdrawal details group the recipient account and wrap long names and receipts without losing processing data', async () => {
  const onClose = vi.fn()
  const name = 'Long recipient name '.repeat(30)
  const receipt = 'receipt-'.repeat(60)
  render(
    <WithdrawalDetails
      row={{
        id: 8,
        user_id: 42,
        state: 'paid',
        account: 'recipient@example.com',
        real_name: name,
        amount_cents: 12345,
        paid_at: 1791000000,
        receipt,
      }}
      onClose={onClose}
    />
  )
  const dialog = screen.getByRole('dialog', { name: 'Withdrawal request' })
  expect(
    within(dialog).getByText('Alipay account').parentElement?.parentElement
  ).toHaveClass('border', 'rounded-md')
  expect(within(dialog).getByText(name.trim())).toHaveClass(
    'text-xs',
    'break-all'
  )
  expect(within(dialog).getByText(receipt)).toHaveClass('break-all')
  expect(within(dialog).getByText('Paid')).toBeVisible()
  expect(within(dialog).getByText('Actual transfer time')).toBeVisible()
  await userEvent
    .setup()
    .click(within(dialog).getByRole('button', { name: 'Close' }))
  expect(onClose).toHaveBeenCalledOnce()
})

test('the admin withdrawal summary groups partner information and keeps financial values compact', () => {
  const row: CampusRecord = {
    id: 8,
    user_id: 42,
    username: 'partner42',
    partner_tier: { level: 2, rate_percent: 35 },
    partner_tier_name: 'Campus star',
    performance_cents: 200000,
    total_commission_cents: 123456,
    actor_id: 7,
  }
  render(<WithdrawalSummary row={row} admin />)
  expect(screen.getByText('partner42 (#42)')).toBeVisible()
  const tier = screen.getByText('Lv.2 · Campus star')
  expect(tier.parentElement?.parentElement).toHaveClass('border', 'rounded-md')
  expect(screen.getByText(/1,234\.56/)).toHaveClass(
    'font-mono!',
    'tabular-nums'
  )
  expect(screen.getByText(/1,234\.56/)).not.toHaveClass('text-sm')
  expect(screen.getByText('#7')).toBeVisible()
})

test.each(['', '{invalid', '[]'])(
  'commission details keep the calculation fallback and zero amounts visible for snapshot %s',
  (segments) => {
    render(
      <CommissionDetails
        row={{ id: 1, user_id: 42, segments }}
        onClose={vi.fn()}
      />
    )
    expect(screen.getByText('Calculation unavailable')).toBeVisible()
    expect(screen.getAllByText(/0\.00/)).toHaveLength(2)
    expect(screen.queryByText('Refund Details')).not.toBeInTheDocument()
  }
)

test('commission details copy the complete returned order identifier and omit copy when missing', async () => {
  const user = userEvent.setup()
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  const order = 'MASKED***-'.repeat(40)
  const { rerender } = render(
    <CommissionDetails
      row={{ id: 1, user_id: 42, trade_no: order }}
      onClose={vi.fn()}
    />
  )
  await user.click(screen.getByRole('button', { name: 'Copy Order number' }))
  expect(write).toHaveBeenCalledWith(order)
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeVisible()
  rerender(<CommissionDetails row={{ id: 2, user_id: 42 }} onClose={vi.fn()} />)
  expect(
    screen.queryByRole('button', { name: 'Copy Order number' })
  ).not.toBeInTheDocument()
})

test('withdrawal details copy exactly the returned account and receipt without triggering an operation', async () => {
  const user = userEvent.setup()
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
  const onClose = vi.fn()
  render(
    <WithdrawalDetails
      row={{
        id: 1,
        user_id: 42,
        account: 'c***@example.test',
        receipt: 'RECEIPT-LONG-'.repeat(30),
      }}
      onClose={onClose}
    />
  )
  await user.click(screen.getByRole('button', { name: 'Copy Alipay account' }))
  expect(write).toHaveBeenLastCalledWith('c***@example.test')
  await user.click(
    screen.getByRole('button', { name: 'Copy Transfer receipt' })
  )
  expect(write).toHaveBeenLastCalledWith('RECEIPT-LONG-'.repeat(30))
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog')).toBeVisible()
})
