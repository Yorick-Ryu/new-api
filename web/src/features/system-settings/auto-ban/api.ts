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
import i18next from 'i18next'

import { api } from '@/lib/api'

import type { BanSettings, BanRule } from './lib/schema'

type SettingsResponse = Omit<BanSettings, 'rules'> & {
  rules: BanRule[] | null
}

type Envelope<T> = { success: boolean; message?: string; data: T }
export type BanEvent = {
  id: number
  user_id: number
  user_status: number | null
  created_at: number
  request_id: string
  channel_id: number
  model: string
  version: string
  action: string
  reason: string
  rules: string
  error_summary: string
  http_status: number
}
export type TestResult = {
  is_upstream_error: boolean
  rules: {
    id: string
    name: string
    matched: boolean
    groups: { id: string; matched: boolean; conditions: boolean[] }[]
  }[]
}
export type TestSample = {
  body: string
  http_status: number
  channel_id: number
  model: string
}

function unwrap<T>(response: Envelope<T>): T {
  if (!response.success) throw new Error(response.message || 'Request failed')
  return response.data
}

function normalizeSettings(result: SettingsResponse): BanSettings {
  return {
    ...result,
    rules: (result.rules ?? []).map((rule) => ({
      ...rule,
      name: result.version === 'default' ? i18next.t(rule.name) : rule.name,
      reason:
        result.version === 'default' ? i18next.t(rule.reason) : rule.reason,
      match_groups: rule.match_groups.map((group) => ({
        ...group,
        conditions: group.conditions.map((c) => ({
          ...c,
          id: c.id ?? crypto.randomUUID(),
        })),
      })),
      channels: rule.channels ?? [],
      models: rule.models ?? [],
    })),
  }
}

export const autoBanApi = {
  async get(): Promise<BanSettings> {
    const result = unwrap(
      (await api.get<Envelope<SettingsResponse>>('/api/auto-ban/')).data
    )
    return normalizeSettings(result)
  },
  async save(settings: BanSettings): Promise<BanSettings> {
    return normalizeSettings(
      unwrap(
        (await api.put<Envelope<SettingsResponse>>('/api/auto-ban/', settings))
          .data
      )
    )
  },
  async test(settings: BanSettings, sample: TestSample): Promise<TestResult> {
    return unwrap(
      (
        await api.post<Envelope<TestResult>>('/api/auto-ban/test', {
          settings,
          ...sample,
        })
      ).data
    )
  },
  async events(before = 0): Promise<BanEvent[]> {
    return (
      unwrap(
        (
          await api.get<Envelope<BanEvent[] | null>>('/api/auto-ban/events', {
            params: { before },
          })
        ).data
      ) ?? []
    )
  },
}
