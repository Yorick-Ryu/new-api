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
import { expect, test } from 'vitest'

import { useCouponSelection } from '../use-coupon-selection'
import { CampusCouponSection } from '../wallet-coupon'

function renderCoupon(state: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity } },
  })
  client.setQueryData(['campus', 'overview'], {
    member: { coupon_state: state, coupon_trade: 'pending-order' },
  })
  function Wallet() {
    const [selected, setSelected] = useCouponSelection()
    return <CampusCouponSection selected={selected} onChange={setSelected} />
  }
  return render(
    <QueryClientProvider client={client}>
      <Wallet />
    </QueryClientProvider>
  )
}

test('available coupon shows one ticket and is selected by default, can be cleared by clicking the ticket and selected by keyboard', async () => {
  const user = userEvent.setup()
  renderCoupon('available')
  expect(screen.getByText('Available: 1 coupons')).toBeVisible()
  const checkbox = screen.getByRole('button', {
    name: 'New user top-up coupon',
  })
  expect(checkbox).toHaveAttribute('aria-pressed', 'true')
  await user.click(screen.getByText('New user top-up coupon'))
  expect(checkbox).toHaveAttribute('aria-pressed', 'false')
  checkbox.focus()
  await user.keyboard(' ')
  expect(checkbox).toHaveAttribute('aria-pressed', 'true')
})

test('reserved ticket shows zero available and cannot be selected', () => {
  renderCoupon('reserved')
  expect(screen.getByText('Available: 0 coupons')).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'New user top-up coupon' })
  ).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'Continue original payment' })
  ).toBeVisible()
})

test.each(['', 'used'])('coupon state %s hides the ticket', (state) => {
  renderCoupon(state)
  expect(
    screen.queryByRole('button', { name: 'New user top-up coupon' })
  ).not.toBeInTheDocument()
})
