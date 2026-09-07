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
export type ServiceStatusHours = 24 | 72 | 168

export type StatusMetrics = {
  cache_hit_rate?: number | null
  success_rate: number | null
  avg_ttft_ms: number | null
  avg_latency_ms: number | null
  avg_tps: number | null
}

export type StatusPoint = StatusMetrics & {
  ts: number
}
export type StatusModel = StatusMetrics & {
  model_name: string
  icon?: string
  series: StatusPoint[]
}
export type StatusGroup = {
  group: string
  description?: string
  models: StatusModel[]
}
export type ServiceStatusData = {
  start_ts: number
  end_ts: number
  bucket_seconds: number
  groups: StatusGroup[]
}
export type ServiceStatusResponse = {
  success: boolean
  message?: string
  enabled: boolean
  data: ServiceStatusData
}
