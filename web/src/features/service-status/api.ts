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
import { api } from '@/lib/api'

import {
  serviceStatusSettingsSchema,
  type ServiceStatusSettings,
} from './lib/settings'
import type { ServiceStatusHours, ServiceStatusResponse } from './types'

export async function getServiceStatus(
  hours: ServiceStatusHours,
  signal?: AbortSignal
): Promise<ServiceStatusResponse> {
  const response = await api.get<ServiceStatusResponse>('/api/service-status', {
    params: { hours },
    signal,
  })
  if (!response.data.success) {
    throw new Error(response.data.message || 'Failed to load service status')
  }
  return response.data
}

export async function getServiceStatusSettings(
  signal?: AbortSignal
): Promise<ServiceStatusSettings> {
  const response = await api.get<{
    success: boolean
    message?: string
    data: ServiceStatusSettings
  }>('/api/service-status/settings', {
    signal,
    headers: { 'Cache-Control': 'no-cache, no-store' },
  })
  if (!response.data.success) {
    throw new Error(
      response.data.message || 'Failed to load service status settings'
    )
  }
  return serviceStatusSettingsSchema.parse(response.data.data)
}

export async function saveServiceStatusSettings(
  settings: ServiceStatusSettings
): Promise<void> {
  const payload = {
    groups: settings.groups.map((group) => ({
      group: group.group,
      hidden: group.hidden,
      models: group.models,
    })),
  }
  const response = await api.put<{ success: boolean; message?: string }>(
    '/api/service-status/settings',
    payload
  )
  if (!response.data.success) {
    throw new Error(
      response.data.message || 'Failed to save service status settings'
    )
  }
}
