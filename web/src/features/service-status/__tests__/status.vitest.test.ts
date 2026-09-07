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
import { describe, expect, it } from 'vitest'

import {
  fillStatusTimeline,
  getGroupHealth,
  getServiceHealth,
} from '../lib/status'
import type { StatusModel, StatusPoint } from '../types'

const healthy: StatusPoint = {
  ts: 3600,
  success_rate: 100,
  avg_ttft_ms: 300,
  avg_latency_ms: 1000,
  avg_tps: 25,
}
const model: StatusModel = {
  model_name: 'alpha',
  ...healthy,
  series: [healthy],
}
describe('Service status history', () => {
  it.each([
    [1800, 48],
    [3600, 72],
    [7200, 84],
  ])(
    'fills every %i-second slot including the current interval without adding an extra bar',
    (step, count) => {
      const start = 0
      const current = (count - 1) * step
      for (const end of [current, current + step - 1]) {
        const points = fillStatusTimeline([], start, end, step)
        expect(points).toHaveLength(count)
        expect(points.at(-1)?.ts).toBe(current)
      }
    }
  )
  it('keeps gaps unknown while preserving a measured zero success rate', () => {
    const points = fillStatusTimeline(
      [healthy, { ...healthy, ts: 10800, success_rate: 0 }],
      3600,
      10800,
      3600
    )
    expect(points.map((point) => point.success_rate)).toEqual([100, null, 0])
    expect(points.map((point) => getServiceHealth(point.success_rate))).toEqual(
      ['normal', 'unknown', 'error']
    )
  })
  it('uses the documented success-rate boundaries for warnings and errors', () => {
    expect([99, 98.99, 95, 94.99].map(getServiceHealth)).toEqual([
      'normal',
      'warning',
      'warning',
      'error',
    ])
  })
  it('does not show historical healthy traffic as current availability', () => {
    expect(getGroupHealth([model], 9000, 3600)).toBe('unknown')
    expect(getGroupHealth([], 9000, 3600)).toBe('unknown')
  })
  it('shows a current error even when other models have no requests', () => {
    expect(
      getGroupHealth(
        [
          model,
          {
            ...model,
            model_name: 'beta',
            series: [{ ...healthy, ts: 7200, success_rate: 0 }],
          },
        ],
        9000,
        3600
      )
    ).toBe('error')
  })
  it('keeps data outside the chosen range out of the visible timeline', () => {
    expect(
      fillStatusTimeline([healthy], 7200, 10800, 3600).map(
        (point) => point.success_rate
      )
    ).toEqual([null, null])
    expect(fillStatusTimeline([], 0, 3600, 0)).toEqual([])
  })
})
