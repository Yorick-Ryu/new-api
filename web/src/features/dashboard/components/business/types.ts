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
export interface BusinessMoney {
  provider: string
  amount: number
}

export interface BusinessSales {
  subscription_revenue: number
  revenue_paying_users: number
  revenue: number
  unverified_orders: number
  paying_users: number
  first_paying_users: number
  new_users: number
}

export interface BusinessDashboardData {
  cumulative_renewals: {
    renewed: number
    expired_unrenewed: number
    rate: number | null
  }
  sales: BusinessSales
  previous_sales: BusinessSales
  previous_start_timestamp: number
  previous_end_timestamp: number
  activity: {
    users: number
    previous_users: number
    last_day_users: number
    seven_day_users: number
  } | null
  subscription_health: {
    active: number
    expiring: number
    due: number
    renewed: number
    renewal_rate: number | null
    tracking_since: number
    partial_history: boolean
  }
  start_timestamp: number
  end_timestamp: number
  new_users: number
  topup_orders: number
  topup_users: number
  topup_amounts: BusinessMoney[]
  new_user_payment_amounts: BusinessMoney[] | null
  new_user_paying_users: number
  new_user_topup_users: number
  new_user_topup_rate: number
  new_user_topup_amounts: BusinessMoney[]
  subscription_activations: number
  subscription_renewals: number
  admin_grants: number
  daily: {
    date: string
    new_users: number
    topup_orders: number
    subscriptions: number
    renewals: number
    wallet_revenue: number
    subscription_revenue: number
    plans: {
      plan_id: number
      activations: number
      renewals: number
    }[]
  }[]
  recent_users: {
    id: number
    username: string
    created_at: number
    topup_orders: number
  }[]
  recent_topups: {
    id: number
    user_id: number
    username: string
    money: number
    provider: string
    complete_time: number
  }[]
  plans: {
    plan_id: number
    title: string
    activations: number
    renewals: number
    renewal_due: number
    previous_orders: number
    renewed: number
    renewal_rate: number | null
  }[]
}

// Only Epay records have an unambiguous CNY amount. Other gateways can store
// credited units or product currencies; never combine them or guess a currency.
export function formatBusinessMoney(items: BusinessMoney[]): string {
  if (!items.length) return '0.00'
  return items
    .map(
      (item) =>
        `${item.provider === 'epay' ? '¥' : `${item.provider} `}${item.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    )
    .join(' / ')
}
