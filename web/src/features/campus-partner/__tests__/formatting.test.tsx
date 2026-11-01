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
import { act, render, screen } from '@testing-library/react'
import type { AxiosResponse } from 'axios'
import i18next from 'i18next'
import { afterEach, expect, test, vi } from 'vitest'

import { toIntlLocale } from '@/i18n/languages'
import { api } from '@/lib/api'

import { cash } from '../api'
import { CampusRecords } from '../records'

afterEach(async () => {
  vi.restoreAllMocks()
  await i18next.changeLanguage('en')
})

test.each([
  'en',
  'zhCN',
  'zhTW',
  'fr',
  'ru',
  'ja',
  'vi',
  'unsupported-language',
])(
  'campus cash remains RMB cents with a valid locale or fallback for %s',
  (language) => {
    const formatted = cash(12345, toIntlLocale(language))
    expect(formatted).toMatch(/123[.,]45/)
    expect(formatted).toMatch(/CNY|CN¥|¥|￥|元/)
  }
)

test('refund ledger amounts retain their negative sign and one-cent precision', () => {
  expect(cash(-1, toIntlLocale('en'))).toMatch(/-.*0\.01/)
  expect(cash(0, toIntlLocale('zhCN'))).toMatch(/0\.00/)
})

test('changing the interface language updates the displayed record amount', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        items: [
          {
            id: 1,
            user_id: 1,
            amount_cents: 12345,
            state: 'pending',
            batch: '2026-11-30',
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
      <CampusRecords kind='withdrawals' />
    </QueryClientProvider>
  )
  expect(await screen.findByText(/123\.45/)).toBeVisible()
  await act(async () => {
    await i18next.changeLanguage('fr')
  })
  expect(await screen.findByText(/123,45/)).toBeVisible()
  expect(screen.queryByText(/123\.45/)).not.toBeInTheDocument()
})
