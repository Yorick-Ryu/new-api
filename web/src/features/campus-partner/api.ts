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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import { campusSite } from './storage'

export { campusSite, invitationCode } from './storage'
export type TierRule = { name?: string; floor_cents: number; rate_bps: number }
export type PlanRate = { plan_id: number; rate_bps: number }
export type PlanOption = {
  id: number
  title: string
  enabled: boolean
  price_amount: number
  currency: string
}
export type CampaignConfig = {
  enabled: boolean

  tiers: TierRule[]
  tier_revision: number
  plan_rates: PlanRate[]
  plan_revision: number
  plan_options: PlanOption[]
}
export type CampusAdminInvitation = {
  user_id: number
  username: string
  display_name: string
  inviter_id: number
  inviter_username: string
  inviter_display_name: string
  bound_at: number
  registered_at: number
  paid_cents: number
  commission_cents: number
}
export interface Overview {
  expected_batch: string
  enabled: boolean
  version: string
  can_bind: boolean
  member: {
    code: string
    joined_at: number
    inviter_id: number
    performance_cents: number
    debt_cents: number
    coupon_state: string
    coupon_trade: string
  }
  withdrawal_cutoff?: string
  withdrawal_next_start?: string
  withdrawal_month_end?: string
  withdrawal_next_month_end?: string
  withdrawal_account?: string
  withdrawal_name?: string
  frozen_cents: number
  available_cents: number
  processing_cents: number
  paid_cents: number
  net_cents: number
  invited: number
  this_month: number
  tiers: TierRule[]
  plan_rates: PlanRate[]
  plan_options: PlanOption[]
  tier: {
    level: number
    rate_percent: number
    floor_cents: number
    next_cents: number
    remaining_cents: number
  }
}
export async function campusGet<T>(path: string): Promise<T> {
  const response = await api.get(`/api/campus/${path}`)
  return requireServerSuccess(response.data).data as T
}
export async function campusPost<T>(
  path: string,
  body: unknown = {}
): Promise<T> {
  const response = await api.post(`/api/campus/${path}`, body)
  return requireServerSuccess(response.data).data as T
}
export function useCampus() {
  return useQuery({
    queryKey: ['campus', 'overview'],
    queryFn: () => campusGet<Overview>('self'),
    enabled: campusSite(),
    refetchOnWindowFocus: true,
    // Navigation hides an unavailable campaign; the page has its own retry UI.
    meta: { errorToast: false, errorRedirect: false },
  })
}
export function useCampusAction<T = void>(
  action: (value: T) => Promise<unknown>
) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: action,
    onSuccess: () => client.invalidateQueries({ queryKey: ['campus'] }),
  })
}
// Campus cash is always RMB; quota/display currency conversion is inappropriate.
export function cash(cents: number, locale?: string) {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'CNY',
  }).format(cents / 100)
}
export function beijingDate(
  seconds: number,
  locale?: string,
  showSeconds = false
) {
  if (!seconds) return '—'
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'Asia/Shanghai',
    dateStyle: 'medium',
    timeStyle: showSeconds ? 'medium' : 'short',
    hourCycle: showSeconds ? 'h23' : undefined,
  }).format(new Date(seconds * 1000))
}

// Batch remains a month-end date in the API; users see the full payout window.
export function payoutWindow(batch?: string): string {
  if (!batch) return '—'
  return `${batch.slice(0, 7)}-26 ~ ${batch}`
}
