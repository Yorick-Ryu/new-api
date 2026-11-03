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
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'

import { PaymentConfirmDialog } from '../payment-confirm-dialog'

test.each([
  { coupon: false, payable: 2000, saved: '500' },
  { coupon: true, payable: 1900, saved: '600' },
])(
  'coupon=$coupon preserves the same original price and shows total savings',
  ({ coupon, payable, saved }) => {
    render(
      <PaymentConfirmDialog
        open
        onOpenChange={() => {}}
        onConfirm={() => {}}
        topupAmount={2500}
        paymentAmount={payable}
        paymentMethod={undefined}
        calculating={false}
        processing={false}
        discountRate={0.8}
        campusCoupon={coupon}
        campusBefore={2000}
      />
    )
    expect(screen.getByText('2,500')).toHaveClass('line-through')
    expect(screen.getByText(saved)).toBeVisible()
  }
)
