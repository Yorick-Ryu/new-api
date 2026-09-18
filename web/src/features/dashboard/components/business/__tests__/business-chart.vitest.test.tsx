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
// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ICommonChartSpec } from '@visactor/vchart'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import { BusinessDetails } from '../business-details'
import { buildBusinessTrend } from '../business-trend'
import type { BusinessDashboardData } from '../types'

// VChart's canvas is a browser boundary; verify its input here and native hover in browser QA.
const renderer = vi.hoisted(() => ({ spec: null as ICommonChartSpec | null }))
vi.mock('@visactor/react-vchart', () => ({
  VChart: (props: { spec: ICommonChartSpec }) => {
    renderer.spec = props.spec
    return <canvas data-testid='vchart-canvas' />
  },
}))
const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
afterEach(() => {
  cleanup()
  renderer.spec = null
})

const daily: BusinessDashboardData['daily'] = [
  {
    date: '2026-09-17',
    new_users: 12,
    topup_orders: 8,
    subscriptions: 5,
    renewals: 9,
    wallet_revenue: 12.5,
    subscription_revenue: 30.25,
    plans: [
      { plan_id: 41, activations: 2, renewals: 4 },
      { plan_id: 99, activations: 3, renewals: 5 },
    ],
  },
]

const plans: BusinessDashboardData['plans'] = [
  {
    plan_id: 41,
    title: 'Starter',
    activations: 2,
    renewals: 4,
    previous_orders: 0,
    renewal_due: 0,
    renewed: 0,
    renewal_rate: null,
  },
  {
    plan_id: 99,
    title: 'Team',
    activations: 3,
    renewals: 5,
    previous_orders: 0,
    renewal_due: 0,
    renewed: 0,
    renewal_rate: null,
  },
]

it('switches one native chart to independent smooth areas using keyboard controls', async () => {
  render(
    <I18nextProvider i18n={i18n}>
      <BusinessDetails data={{ daily, plans }} />
    </I18nextProvider>
  )
  expect(screen.getAllByTestId('vchart-canvas')).toHaveLength(1)
  expect(renderer.spec?.series?.every((series) => series.type === 'bar')).toBe(
    true
  )
  const user = userEvent.setup()
  screen.getByRole('button', { name: 'Area Chart' }).focus()
  await user.keyboard('{Enter}')
  expect(
    screen
      .getByRole('button', { name: 'Area Chart' })
      .getAttribute('aria-pressed')
  ).toBe('true')
  expect(
    screen
      .getByRole('button', { name: 'Bar Chart' })
      .getAttribute('aria-pressed')
  ).toBe('false')
  expect(screen.getAllByTestId('vchart-canvas')).toHaveLength(1)
  expect(renderer.spec?.series).toHaveLength(3)
  for (const series of renderer.spec?.series ?? []) {
    expect(series.type).toBe('area')
    expect(series.stack).toBe(false)
    if (series.type === 'area') {
      expect(series.area?.style?.fillOpacity).toBe(0.08)
      expect(series.line?.style?.curveType).toBe('monotone')
    }
  }
  await user.click(screen.getByRole('button', { name: 'Bar Chart' }))
  expect(renderer.spec?.series?.every((series) => series.type === 'bar')).toBe(
    true
  )
})

it('shows one empty state when there is no business activity', () => {
  render(
    <I18nextProvider i18n={i18n}>
      <BusinessDetails data={{ daily: [], plans: [] }} />
    </I18nextProvider>
  )
  expect(screen.getByText('No business activity in this period')).toBeTruthy()
  expect(screen.queryByTestId('vchart-canvas')).toBeNull()
})

it.each(['bar', 'area'] as const)(
  '%s uses a single-series mark tooltip and a date summary with cash-only total',
  (chartType) => {
    const { spec } = buildBusinessTrend({ daily, plans }, chartType, i18n.t)
    const rows = spec.data.flatMap((data) => data.values)
    const wallet = rows.find((row) => row.metric === 'wallet_revenue')
    const mark = spec.tooltip.mark
    expect(mark.title.value(wallet)).toBe('2026-09-17')
    expect(mark.content).toHaveLength(1)
    expect(mark.content[0].key(wallet)).toBe('Wallet recharge')
    expect(mark.content[0].value(wallet)).toBe('¥12.50')
    const renewal = rows.find((row) => row.metric === 'plan_99_renewals')
    expect(mark.content[0].key(renewal)).toBe('Renewed Team')
    expect(mark.content[0].value(renewal)).toBe('5')
    const summary = spec.tooltip.dimension.updateContent(
      rows.map((datum) => ({
        datum,
        key: spec.tooltip.dimension.content[0].key(datum),
        value: spec.tooltip.dimension.content[0].value(datum),
        shapeFill: '#123456',
      }))
    )
    expect(summary[0]).toEqual({
      key: 'Total revenue',
      value: '¥42.75',
      hasShape: false,
    })
    expect(summary.slice(1).map((item) => [item.key, item.value])).toEqual([
      ['Plan subscription', '¥30.25'],
      ['Wallet recharge', '¥12.50'],
      ['New registrations', '12'],
      ['Renewed Team', '5'],
      ['Renewed Starter', '4'],
      ['New Team', '3'],
      ['New Starter', '2'],
    ])
    expect(summary.slice(1).every((item) => item.shapeFill === '#123456')).toBe(
      true
    )
    expect(spec.axes.find((axis) => axis.orient === 'left')?.seriesId).toEqual([
      'users',
      'subscriptions',
    ])
    expect(spec.axes.find((axis) => axis.orient === 'right')?.seriesId).toEqual(
      ['revenue']
    )
  }
)

it('attributes identically named plans by ID, zero-fills new plans and excludes disabled catalog entries', () => {
  const { spec } = buildBusinessTrend(
    {
      daily,
      plans: [
        { ...plans[0], title: 'Renamed' },
        { ...plans[1], plan_id: 123, title: 'Renamed' },
      ],
    },
    'bar',
    i18n.t
  )
  const counts = spec.data
    .flatMap((dataset) => dataset.values)
    .filter((row) => !row.money)
  expect(counts.map((row) => [row.metric, row.value])).toEqual([
    ['new_users', 12],
    ['plan_41_activations', 2],
    ['plan_41_renewals', 4],
    ['plan_123_activations', 0],
    ['plan_123_renewals', 0],
  ])
  expect(spec.tooltip.mark.content[0].key(counts[1])).toBe('New Renamed')
  expect(counts.slice(1).every((row) => row.group === 'subscriptions')).toBe(
    true
  )
  expect(spec.data[2].values.every((row) => row.group === 'revenue')).toBe(true)
})

it.each(['bar', 'area'] as const)(
  '%s highlights the hovered date band behind all its metrics',
  (chartType) => {
    const { spec } = buildBusinessTrend({ daily, plans }, chartType, i18n.t)
    expect((spec as ICommonChartSpec).crosshair).toMatchObject({
      xField: {
        visible: true,
        bindingAxesIndex: [0],
        line: { visible: true, type: 'rect' },
      },
    })
  }
)

it.each(['bar', 'area'] as const)(
  '%s omits top-up orders and places revenue after subscription counts',
  (chartType) => {
    const { spec } = buildBusinessTrend({ daily, plans }, chartType, i18n.t)
    expect(spec.series.map((series) => series.id)).toEqual([
      'users',
      'subscriptions',
      'revenue',
    ])
    const rows = spec.data.flatMap((dataset) => dataset.values)
    expect([...new Set(rows.map((row) => row.group))]).toEqual([
      'users',
      'subscriptions',
      'revenue',
    ])
    expect(rows.some((row) => row.metric === 'topup_orders')).toBe(false)
    expect(spec.color.domain).toEqual([
      'new_users',
      'plan_41_activations',
      'plan_41_renewals',
      'plan_99_activations',
      'plan_99_renewals',
      'wallet_revenue',
      'subscription_revenue',
    ])
  }
)
