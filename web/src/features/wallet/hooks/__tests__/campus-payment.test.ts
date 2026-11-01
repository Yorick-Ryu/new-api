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
import { act, renderHook } from '@testing-library/react'
import type { AxiosResponse } from 'axios'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { usePayment } from '../use-payment'

afterEach(() => vi.restoreAllMocks())

test('a slower old quote cannot overwrite the selected coupon price or its before-discount amount', async () => {
  const pending: Array<(value: AxiosResponse) => void> = []
  vi.spyOn(api, 'post').mockImplementation(
    () => new Promise<AxiosResponse>((resolve) => pending.push(resolve))
  )
  const { result } = renderHook(() => usePayment(true))
  let old!: Promise<number>, current!: Promise<number>
  act(() => {
    old = result.current.calculatePaymentAmount(100, 'alipay')
    current = result.current.calculatePaymentAmount(200, 'alipay')
  })
  await act(async () => {
    pending[1]({
      data: { success: true, data: '190.00', campus_before: '200.00' },
    } as AxiosResponse)
    await current
  })
  expect(result.current.amount).toBe(190)
  expect(result.current.campusBefore).toBe(200)
  await act(async () => {
    pending[0]({
      data: { success: true, data: '95.00', campus_before: '100.00' },
    } as AxiosResponse)
    await old
  })
  expect(result.current.amount).toBe(190)
  expect(result.current.campusBefore).toBe(200)
  expect(api.post).toHaveBeenCalledWith(
    '/api/user/amount',
    { amount: 200, campus_coupon: true },
    expect.any(Object)
  )
})
