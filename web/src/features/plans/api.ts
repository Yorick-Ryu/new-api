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

export interface CatalogSubscription {
  id: number
  title: string
  subtitle: string
  price_amount: number
  duration_unit: 'year' | 'month' | 'day' | 'hour' | 'custom'
  duration_value: number
  custom_seconds: number
  total_amount: number
  quota_reset_period: 'never' | 'daily' | 'weekly' | 'monthly' | 'custom'
  quota_reset_custom_seconds: number
  quota_windows: string
  max_purchase_per_user: number
  allow_renewal: boolean
}
export interface CatalogTopup {
  amount: number
  credits: number
  money: string
}

export interface PlansCatalog {
  subscriptions: CatalogSubscription[]
  topup_amounts: number[]
  topup_options: CatalogTopup[]
}
export async function getPlansCatalog(): Promise<{
  success: boolean
  data: PlansCatalog
  message?: string
}> {
  return (await api.get('/api/plans/catalog')).data
}
