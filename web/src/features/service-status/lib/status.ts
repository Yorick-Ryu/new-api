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
import type { StatusModel, StatusPoint } from '../types'

export type ServiceHealth = 'normal' | 'warning' | 'error' | 'unknown'

export function getServiceHealth(rate: number | null): ServiceHealth {
  if (rate === null || !Number.isFinite(rate)) return 'unknown'
  if (rate >= 99) return 'normal'
  if (rate >= 95) return 'warning'
  return 'error'
}

export const HEALTH_CLASSES: Record<ServiceHealth, string> = {
  normal: 'bg-green-500',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
  unknown: 'bg-muted-foreground/25',
}

export function fillStatusTimeline(
  series: StatusPoint[],
  start: number,
  end: number,
  step: number
): StatusPoint[] {
  if (step <= 0 || end < start) return []
  const byTime = new Map(series.map((point) => [point.ts, point]))
  const points: StatusPoint[] = []
  for (let ts = start; ts <= end; ts += step) {
    points.push(
      byTime.get(ts) ?? {
        ts,
        cache_hit_rate: null,
        success_rate: null,
        avg_ttft_ms: null,
        avg_latency_ms: null,
        avg_tps: null,
      }
    )
  }
  return points
}

export function getGroupHealth(
  models: StatusModel[],
  end: number,
  step: number
): ServiceHealth {
  const latestTs = end - (end % step)
  let health: ServiceHealth = 'unknown'
  for (const model of models) {
    const rate =
      model.series.find((point) => point.ts === latestTs)?.success_rate ?? null
    const status = getServiceHealth(rate)
    if (status === 'unknown') continue
    if (status === 'error') return 'error'
    if (status === 'warning' || health === 'unknown') health = status
  }
  return health
}
