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
export type BusinessPreset = '1' | 'yesterday' | '3' | '7' | '30'

export interface BusinessTimeRange {
  start_timestamp: number
  end_timestamp: number
}

export type BusinessFilter =
  | { period: BusinessPreset }
  | ({ period: 'custom' } & BusinessTimeRange)

export type BusinessDashboardParams =
  | { days: number; offset: number }
  | BusinessTimeRange

const daySeconds = 86400
const beijingOffset = 8 * 3600

export function getBusinessPresetRange(
  period: BusinessPreset,
  now = Date.now()
): BusinessTimeRange {
  const current = Math.floor(now / 1000)
  const today =
    Math.floor((current + beijingOffset) / daySeconds) * daySeconds -
    beijingOffset
  if (period === 'yesterday') {
    return { start_timestamp: today - daySeconds, end_timestamp: today }
  }
  return {
    start_timestamp: today - (Number(period) - 1) * daySeconds,
    end_timestamp: current + 1,
  }
}

// The shared picker edits local calendar fields. Present those fields as
// Beijing wall time and convert them explicitly at the business API boundary.
export function toBusinessPickerDate(timestamp: number): Date {
  const date = new Date((timestamp + beijingOffset) * 1000)
  return new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds()
  )
}

export function fromBusinessPickerDate(date: Date): number {
  return (
    Date.UTC(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
      date.getSeconds()
    ) /
      1000 -
    beijingOffset
  )
}
