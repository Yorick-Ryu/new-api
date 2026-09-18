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
import { cleanup, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { afterEach, expect, it } from 'vitest'

import { ModelPerfBadge } from '../model-perf-badge'

const i18n = createInstance()
await i18n
  .use(initReactI18next)
  .init({ lng: 'en', resources: { en: { translation: {} } } })
afterEach(cleanup)

it('keeps an hour without traffic gray between the previous and current success samples', () => {
  render(
    <ModelPerfBadge
      perf={{
        avg_latency_ms: 1000,
        avg_tps: 5,
        success_rate: 99,
        window_end: 10800 + 1800,
        recent_success_series: [
          { ts: 3600, success_rate: 100 },
          { ts: 10800, success_rate: 0 },
        ],
      }}
    />
  )
  const bars = screen.getByRole('img').children
  expect(bars).toHaveLength(3)
  expect(bars[0].className).toContain('emerald')
  expect(bars[1].className).toContain('bg-muted-foreground/15')
  expect(bars[2].className).toContain('red')
  expect(screen.getByText('1.0s')).toBeTruthy()
})

it('shows unknown hours instead of presenting an old overall rate as recent traffic', () => {
  render(
    <ModelPerfBadge
      perf={{
        avg_latency_ms: 0,
        avg_tps: 0,
        success_rate: 100,
        recent_success_rates: [100],
      }}
    />
  )
  for (const bar of screen.getByRole('img').children) {
    expect(bar.className).toContain('bg-muted-foreground/15')
  }
})
