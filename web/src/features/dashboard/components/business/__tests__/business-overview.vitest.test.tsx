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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'

import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { BusinessOverview } from '../business-overview'
import { formatBusinessMoney, type BusinessDashboardData } from '../types'

// The business overview tests do not exercise VChart's browser canvas renderer.
vi.mock('@visactor/react-vchart', () => ({ VChart: () => <canvas /> }))

const i18n = createInstance()
await i18n.init({
  lng: 'en',
  resources: { en: { translation: {} }, zh },
  interpolation: { escapeValue: false },
})
const clients: QueryClient[] = []
// happy-dom does not implement the browser animation API used by ScrollArea.
const animationsDescriptor = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'getAnimations'
)
beforeAll(() => {
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  })
})
afterAll(() => {
  if (animationsDescriptor) {
    Object.defineProperty(
      Element.prototype,
      'getAnimations',
      animationsDescriptor
    )
  } else {
    Reflect.deleteProperty(Element.prototype, 'getAnimations')
  }
})
afterEach(async () => {
  cleanup()
  clients.forEach((client) => client.clear())
  clients.length = 0
  useAuthStore.getState().auth.setUser(null)
  vi.restoreAllMocks()
  await i18n.changeLanguage('en')
})

function fixture(): BusinessDashboardData {
  return {
    sales: {
      revenue: 0,
      subscription_revenue: 0,
      revenue_paying_users: 0,
      unverified_orders: 0,
      paying_users: 0,
      first_paying_users: 0,
      new_users: 0,
    },
    previous_sales: {
      revenue: 0,
      subscription_revenue: 0,
      revenue_paying_users: 0,
      unverified_orders: 0,
      paying_users: 0,
      first_paying_users: 0,
      new_users: 0,
    },
    previous_start_timestamp: 1699400000,
    previous_end_timestamp: 1700000000,
    activity: null,
    subscription_health: {
      active: 0,
      expiring: 0,
      due: 0,
      renewed: 0,
      renewal_rate: null,
      tracking_since: 1700000000,
      partial_history: true,
    },
    start_timestamp: 1700000000,
    end_timestamp: 1700600000,
    new_users: 0,
    topup_users: 0,
    topup_orders: 0,
    topup_amounts: [],
    new_user_topup_users: 0,
    new_user_topup_rate: 0,
    new_user_topup_amounts: [],
    subscription_activations: 0,
    subscription_renewals: 0,
    admin_grants: 0,
    daily: [],
    recent_users: [],
    recent_topups: [],
    plans: [],
  }
}
function mount(role: number) {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'viewer', role })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <BusinessOverview />
      </I18nextProvider>
    </QueryClientProvider>
  )
}

it('does not render business information or request data for ordinary users', () => {
  const get = vi.spyOn(api, 'get')
  mount(ROLE.USER)
  expect(screen.queryByRole('region', { name: 'Business overview' })).toBeNull()
  expect(get).not.toHaveBeenCalled()
})

it('shows loading and disables refresh while the request is pending', async () => {
  let resolve!: (value: {
    data: { success: boolean; data: BusinessDashboardData }
  }) => void
  vi.spyOn(api, 'get').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  mount(ROLE.ADMIN)
  expect(
    screen.getByRole('status', { name: 'Loading business data' })
  ).toBeTruthy()
  expect(
    screen
      .getByRole('button', { name: 'Refresh business data' })
      .hasAttribute('disabled')
  ).toBe(true)
  resolve({ data: { success: true, data: fixture() } })
  await screen.findByText('No business activity in this period')
  expect(screen.queryByRole('status')).toBeNull()
})

it('keeps the current metrics and chart selection while a new period loads, then shows the new values', async () => {
  let resolve!: (value: {
    data: { success: boolean; data: BusinessDashboardData }
  }) => void
  vi.spyOn(api, 'get')
    .mockResolvedValueOnce({
      data: { success: true, data: { ...fixture(), new_users: 12 } },
    })
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
  const user = userEvent.setup()
  mount(ROLE.ADMIN)
  await screen.findByText('0 of 12 new users topped up')
  await user.click(screen.getByRole('button', { name: 'Area Chart' }))
  await user.click(screen.getByRole('tab', { name: 'Yesterday' }))
  expect(screen.getByText('0 of 12 new users topped up')).toBeTruthy()
  expect(
    screen.queryByRole('status', { name: 'Loading business data' })
  ).toBeNull()
  expect(
    screen
      .getByRole('region', { name: 'Business overview' })
      .getAttribute('aria-busy')
  ).toBe('true')
  expect(
    screen
      .getByRole('button', { name: 'Area Chart' })
      .getAttribute('aria-pressed')
  ).toBe('true')
  resolve({ data: { success: true, data: { ...fixture(), new_users: 5 } } })
  await screen.findByText('0 of 5 new users topped up')
  expect(screen.queryByText('0 of 12 new users topped up')).toBeNull()
  expect(
    screen
      .getByRole('region', { name: 'Business overview' })
      .getAttribute('aria-busy')
  ).toBe('false')
  expect(
    screen
      .getByRole('button', { name: 'Area Chart' })
      .getAttribute('aria-pressed')
  ).toBe('true')
})

it('shows empty states and an undefined conversion rate for a period without registrations', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: fixture() },
  })
  mount(ROLE.ADMIN)
  await screen.findByText('No business activity in this period')
  expect(screen.getByText('Average top-up —')).toBeTruthy()
  expect(
    screen.getByText('Subscription revenue').closest('dt')?.parentElement
      ?.textContent
  ).toContain('¥0.00')
  expect(
    screen.getByText('Average revenue per paying user').closest('dt')
      ?.parentElement?.textContent
  ).toContain('—')
  expect(screen.queryByText('New Plus')).toBeNull()
  expect(screen.queryByText('Plan activations')).toBeNull()
  expect(screen.queryByText('Renewal rate')).toBeNull()
  expect(
    screen.getByText('New user top-up rate').closest('dt')?.parentElement
      ?.textContent
  ).toContain('—')
  expect(
    screen.getByText('Wallet top-up amount').closest('dt')?.parentElement
      ?.textContent
  ).toContain('0.00')
})

it('caps reporting choices at 30 days and switches the cohort using keyboard', async () => {
  const get = vi.spyOn(api, 'get').mockImplementation(async (_url, config) => ({
    data: {
      success: true,
      data: { ...fixture(), new_users: config?.params.days === 30 ? 30 : 7 },
    },
  }))
  mount(ROLE.ADMIN)
  await screen.findByText('0 of 7 new users topped up')
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
    'Today',
    'Yesterday',
    'Last 3 days',
    'Last 7 days',
    'Last 30 days',
  ])
  const user = userEvent.setup()
  screen.getByRole('tab', { name: 'Last 30 days' }).focus()
  await user.keyboard('{Enter}')
  await screen.findByText('0 of 30 new users topped up')
  expect(
    screen
      .getByRole('tab', { name: 'Last 30 days' })
      .getAttribute('aria-selected')
  ).toBe('true')
  expect(
    screen
      .getByRole('tab', { name: 'Last 7 days' })
      .getAttribute('aria-selected')
  ).toBe('false')
  expect(get).toHaveBeenLastCalledWith('/api/data/business', {
    params: { days: 30, offset: 0 },
  })
})

it('shows payment and subscription metrics without recent-user or top-up record sections', async () => {
  const data = fixture()
  data.new_users = 2
  data.new_user_topup_users = 1
  data.new_user_topup_rate = 50
  data.subscription_activations = 21
  data.subscription_renewals = 8
  data.admin_grants = 3
  data.topup_amounts = [{ provider: 'epay', amount: 32.5 }]
  data.recent_users = [
    {
      id: 8,
      username: 'long-name-'.repeat(16),
      created_at: 1700000000,
      topup_orders: 1,
    },
  ]
  data.recent_topups = [
    {
      id: 2,
      user_id: 8,
      username: 'Customer',
      money: 32.5,
      provider: 'epay',
      complete_time: 1700000000,
    },
  ]
  data.plans = [
    {
      plan_id: 41,
      title: 'Starter 月卡',
      activations: 12,
      renewals: 2,
      previous_orders: 0,
      renewal_due: 4,
      renewed: 1,
      renewal_rate: 25,
    },
    {
      plan_id: 99,
      title: 'Team 年卡',
      activations: 8,
      renewals: 3,
      previous_orders: 0,
      renewal_due: 5,
      renewed: 5,
      renewal_rate: 100,
    },
    {
      plan_id: 105,
      title: 'Starter 月卡',
      activations: 1,
      renewals: 1,
      previous_orders: 0,
      renewal_due: 0,
      renewed: 0,
      renewal_rate: null,
    },
  ]
  vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data } })
  mount(ROLE.ADMIN)
  const conversion = await screen.findByText('50.0%')
  expect(conversion.classList.contains('font-mono')).toBe(true)
  const planTerms = screen.getAllByText('Starter 月卡')
  expect(planTerms).toHaveLength(2)
  const subscriptions = planTerms[0].closest('dt')?.parentElement
  if (!subscriptions) throw new Error('Missing plan card')
  expect(
    subscriptions.parentElement?.classList.contains('lg:grid-cols-4')
  ).toBe(true)
  for (const [label, count] of [
    ['New subscriptions', '12'],
    ['Subscription renewals', '2'],
  ]) {
    expect(
      within(subscriptions).getByText(label).parentElement?.textContent
    ).toBe(`${label}${count}`)
  }
  const primaryValue = within(subscriptions)
    .getByText('New subscriptions')
    .closest('dd')
  if (!primaryValue) throw new Error('Missing plan counts')
  expect(
    within(primaryValue).getByText('Subscription renewals').parentElement
      ?.textContent
  ).toBe('Subscription renewals2')
  const newPurchases =
    within(primaryValue).getByText('New subscriptions').parentElement
  const renewals = within(primaryValue).getByText(
    'Subscription renewals'
  ).parentElement
  expect(newPurchases?.nextElementSibling).toBe(renewals)
  expect(newPurchases?.parentElement?.classList.contains('flex-nowrap')).toBe(
    true
  )
  expect(screen.queryByText('Renewal rate')).toBeNull()
  expect(screen.queryByText('Historical renewal records incomplete')).toBeNull()
  expect(within(subscriptions).queryByRole('list')).toBeNull()
  expect(screen.queryByText(/admin grants/)).toBeNull()
  expect(screen.queryByRole('table')).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Recent new users' })).toBeNull()
  expect(
    screen.queryByRole('heading', { name: 'Recent wallet top-ups' })
  ).toBeNull()
  expect(screen.queryByText(data.recent_users[0].username)).toBeNull()
  expect(screen.queryByText('Customer')).toBeNull()
  expect(screen.getByRole('heading', { name: 'Trend' })).toBeTruthy()
  expect(screen.getByText('¥32.50')).toBeTruthy()
  expect(screen.queryByText('Subscription breakdown')).toBeNull()
  expect(screen.queryByText('How these metrics are calculated')).toBeNull()
  expect(screen.queryByText(/Data through/)).toBeNull()
})

it('reports an API failure and recovers through retry', async () => {
  vi.spyOn(api, 'get')
    .mockResolvedValueOnce({ data: { success: false } })
    .mockResolvedValue({ data: { success: true, data: fixture() } })
  mount(ROLE.ADMIN)
  expect(await screen.findByRole('alert')).toBeTruthy()
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByText('No business activity in this period')
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
})

it('keeps amounts from different providers separate instead of summing or guessing a currency', () => {
  expect(
    formatBusinessMoney([
      { provider: 'epay', amount: 10 },
      { provider: 'stripe', amount: 5 },
    ])
  ).toBe('¥10.00 / stripe 5.00')
})

it.each([
  ['Today', 1, 0],
  ['Yesterday', 1, 1],
  ['Last 3 days', 3, 0],
])(
  'selecting %s requests its exact reporting window',
  async (label, days, offset) => {
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValue({ data: { success: true, data: fixture() } })
    mount(ROLE.ADMIN)
    await screen.findByText('No business activity in this period')
    screen.getByRole('tab', { name: String(label) }).focus()
    await userEvent.setup().keyboard('{Enter}')
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith('/api/data/business', {
        params: { days, offset },
      })
    )
    expect(
      screen
        .getByRole('tab', { name: String(label) })
        .getAttribute('aria-selected')
    ).toBe('true')
  }
)

it('shows period comparisons and expiry metrics without renewal-rate or history text', async () => {
  const data = fixture()
  data.new_users = 6
  data.previous_sales.new_users = 4
  data.sales.revenue = 100
  data.sales.first_paying_users = 3
  data.previous_sales.first_paying_users = 6
  data.subscription_health = {
    active: 12,
    expiring: 3,
    due: 4,
    renewed: 3,
    renewal_rate: 75,
    tracking_since: 1700000000,
    partial_history: true,
  }
  data.plans = [
    {
      plan_id: 99,
      title: 'Team',
      activations: 1,
      renewals: 3,
      previous_orders: 0,
      renewal_due: 4,
      renewed: 3,
      renewal_rate: 75,
    },
  ]
  vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data } })
  mount(ROLE.ADMIN)
  await screen.findByText('+50.0% vs previous period')
  expect(screen.getByText('-50.0% vs previous period')).toBeTruthy()
  expect(screen.getByText('Previous period was 0')).toBeTruthy()
  expect(screen.getByText('3 expiring in the next 7 days')).toBeTruthy()
  expect(screen.queryByText('Renewal rate')).toBeNull()
  expect(screen.queryByText('75.0%')).toBeNull()
  expect(screen.queryByText('Historical renewal records incomplete')).toBeNull()
  expect(screen.getByText('Usage data unavailable')).toBeTruthy()
  expect(screen.queryByText(/NaN|Infinity/)).toBeNull()
})

it('renders the new filters and growth metrics in the selected Chinese locale', async () => {
  await i18n.changeLanguage('zh')
  const data = fixture()
  data.activity = {
    users: 8,
    previous_users: 4,
    last_day_users: 2,
    seven_day_users: 8,
  }
  data.plans = [
    {
      plan_id: 99,
      title: 'Team 月卡',
      activations: 1,
      renewals: 3,
      previous_orders: 0,
      renewal_due: 4,
      renewed: 3,
      renewal_rate: 75,
    },
  ]
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data },
  })
  mount(ROLE.ADMIN)
  await screen.findByText('总收入')
  expect(
    screen
      .getAllByRole('term')
      .slice(0, 4)
      .map((term) => term.textContent)
  ).toEqual(['新增用户', '首次付费用户', '活跃用户', '新用户充值率'])
  expect(
    screen
      .getAllByRole('term')
      .slice(4, 8)
      .map((term) => term.textContent)
  ).toEqual(['总收入', '充值金额', '新用户充值金额', '客单价'])
  expect(
    screen
      .getAllByRole('term')
      .slice(7)
      .map((term) => term.textContent)
  ).toEqual(['客单价', '当前有效套餐', '套餐收入', 'Team 月卡'])
  expect(screen.queryByText('用户增长、充值与套餐开通 · 北京时间')).toBeNull()
  for (const [label, tone] of [
    ['新增用户', 'info'],
    ['总收入', 'success'],
    ['Team 月卡', 'chart-4'],
  ]) {
    const term = screen.getByText(label).closest('dt')
    const badge = term?.querySelector('[aria-hidden="true"]')
    expect(badge?.classList.contains(`bg-${tone}/10`)).toBe(true)
    expect(badge?.classList.contains(`text-${tone}`)).toBe(true)
    expect(badge?.classList.contains('sm:size-7')).toBe(true)
  }
  expect(screen.queryByText('现金收入（易支付）')).toBeNull()
  expect(screen.getByRole('tab', { name: '昨天' })).toBeTruthy()
  expect(screen.getByText('首次付费用户')).toBeTruthy()
  expect(screen.getByText('活跃用户')).toBeTruthy()
  expect(screen.queryByText('续费率')).toBeNull()
  for (const label of ['Team 月卡', '新购', '续费']) {
    expect(screen.getByText(label)).toBeTruthy()
  }
  expect(screen.queryByText('Cash revenue (Epay)')).toBeNull()
  expect(screen.queryByText(/管理员赠送/)).toBeNull()
  expect(screen.queryByText('基于保留的 API 消费日志')).toBeNull()
  expect(screen.queryByText(/最近一日/)).toBeNull()
  expect(screen.queryByText(/本期付费用户/)).toBeNull()
  expect(screen.queryByText('钱包充值 + 套餐直接支付')).toBeNull()
})

it('shows average recharge per new top-up user while preserving separate payment units', async () => {
  await i18n.changeLanguage('zh')
  const data = fixture()
  data.new_users = 10
  data.new_user_topup_users = 4
  data.new_user_topup_rate = 40
  data.new_user_topup_amounts = [
    { provider: 'epay', amount: 321.5 },
    { provider: 'stripe', amount: 12 },
  ]
  vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data } })
  mount(ROLE.ADMIN)
  expect(await screen.findByText('人均充值 ¥80.38 / stripe 3.00')).toBeTruthy()
  expect(screen.getByText('¥321.50 / stripe 12.00')).toBeTruthy()
  expect(screen.queryByText('本期新注册用户在本期的充值金额')).toBeNull()
})

it.each([
  { activations: 12, renewals: 2, previous: 4, text: '较上期 +10' },
  { activations: 0, renewals: 0, previous: 3, text: '较上期 -3' },
  { activations: 1, renewals: 2, previous: 3, text: '较上期 0' },
])(
  'shows $text below the combined new and renewed plan counts',
  async (value) => {
    await i18n.changeLanguage('zh')
    const data = fixture()
    data.plans = [
      {
        plan_id: 41,
        title: 'Plus 月卡',
        activations: value.activations,
        renewals: value.renewals,
        previous_orders: value.previous,
        renewal_due: 0,
        renewed: 0,
        renewal_rate: null,
      },
    ]
    vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data } })
    mount(ROLE.ADMIN)
    const comparison = await screen.findByText(value.text)
    const plan = screen.getByText('Plus 月卡').closest('dt')?.parentElement
    if (!plan) throw new Error('Missing plan card')
    expect(plan.contains(comparison)).toBe(true)
    expect(within(plan).getByText('新购').parentElement?.textContent).toBe(
      `新购${value.activations}`
    )
    expect(within(plan).getByText('续费').parentElement?.textContent).toBe(
      `续费${value.renewals}`
    )
    expect(comparison.closest('dd')?.previousElementSibling?.tagName).toBe('DD')
  }
)

it('places average spend before active subscriptions using only revenue-paying users', async () => {
  const data = fixture()
  data.sales = {
    ...data.sales,
    revenue: 120,
    subscription_revenue: 50,
    revenue_paying_users: 3,
    paying_users: 4,
  }
  data.previous_sales = {
    ...data.previous_sales,
    revenue: 60,
    subscription_revenue: 25,
    revenue_paying_users: 2,
    paying_users: 5,
  }
  data.plans = [
    {
      plan_id: 41,
      title: 'Plus',
      activations: 2,
      renewals: 1,
      previous_orders: 0,
      renewal_due: 0,
      renewed: 0,
      renewal_rate: null,
    },
    {
      plan_id: 99,
      title: 'Ultra',
      activations: 1,
      renewals: 0,
      previous_orders: 0,
      renewal_due: 0,
      renewed: 0,
      renewal_rate: null,
    },
  ]
  vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data } })
  mount(ROLE.ADMIN)
  await screen.findByText('Average revenue per paying user')
  expect(
    screen
      .getAllByRole('term')
      .slice(7)
      .map((term) => term.textContent)
  ).toEqual([
    'Average revenue per paying user',
    'Current active subscriptions',
    'Subscription revenue',
    'Plus',
    'Ultra',
  ])
  const subscription = screen
    .getByText('Subscription revenue')
    .closest('dt')?.parentElement
  const average = screen
    .getByText('Average revenue per paying user')
    .closest('dt')?.parentElement
  if (!subscription || !average) throw new Error('Missing revenue cards')
  expect(within(subscription).getByText('¥50.00')).toBeTruthy()
  expect(
    within(subscription).getByText('+100.0% vs previous period')
  ).toBeTruthy()
  expect(within(average).getByText('¥40.00')).toBeTruthy()
  expect(within(average).getByText('+33.3% vs previous period')).toBeTruthy()
  expect(subscription.parentElement?.classList.contains('lg:grid-cols-4')).toBe(
    true
  )
})

it('applies a custom Beijing time range, preserves it on reopen, and resets to today', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-17T12:00:00+08:00'))
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: fixture() },
  })
  const user = userEvent.setup()
  mount(ROLE.ADMIN)
  await screen.findByText('No business activity in this period')
  expect(get).toHaveBeenLastCalledWith('/api/data/business', {
    params: { days: 1, offset: 0 },
  })
  await user.click(screen.getByRole('button', { name: 'Filter' }))
  const start = screen.getByRole('group', { name: 'Start Time' })
  const end = screen.getByRole('group', { name: 'End Time' })
  fireEvent.change(within(start).getByDisplayValue('00:00'), {
    target: { value: '08:00' },
  })
  fireEvent.change(within(end).getByDisplayValue('12:00'), {
    target: { value: '11:00' },
  })
  expect(get).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: 'Apply Filters' }))
  await waitFor(() =>
    expect(get).toHaveBeenLastCalledWith('/api/data/business', {
      params: { start_timestamp: 1789603200, end_timestamp: 1789614000 },
    })
  )
  expect(
    screen.getByRole('tab', { name: 'Custom' }).getAttribute('aria-selected')
  ).toBe('true')
  expect(
    screen.getByText(
      'Selected period: 2026-09-17 08:00 – 2026-09-17 11:00 (Beijing time)'
    )
  ).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Filter' }))
  expect(
    within(screen.getByRole('group', { name: 'Start Time' })).getByDisplayValue(
      '08:00'
    )
  ).toBeTruthy()
  expect(
    within(screen.getByRole('group', { name: 'End Time' })).getByDisplayValue(
      '11:00'
    )
  ).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Reset' }))
  expect(
    screen.getByRole('tab', { name: 'Today' }).getAttribute('aria-selected')
  ).toBe('true')
  expect(screen.queryByRole('tab', { name: 'Custom' })).toBeNull()
})

it('keeps an invalid custom range in the dialog without fetching and allows a quick-range correction', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-17T12:00:00+08:00'))
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: fixture() },
  })
  const user = userEvent.setup()
  mount(ROLE.ADMIN)
  await screen.findByText('No business activity in this period')
  await user.click(screen.getByRole('button', { name: 'Filter' }))
  fireEvent.change(
    within(screen.getByRole('group', { name: 'Start Time' })).getByDisplayValue(
      '00:00'
    ),
    { target: { value: '13:00' } }
  )
  await user.click(screen.getByRole('button', { name: 'Apply Filters' }))
  expect(screen.getByRole('alert').textContent).toBe(
    'End time must be after start time'
  )
  expect(get).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: 'Yesterday' }))
  expect(screen.queryByRole('alert')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Apply Filters' }))
  await waitFor(() =>
    expect(get).toHaveBeenLastCalledWith('/api/data/business', {
      params: { days: 1, offset: 1 },
    })
  )
})
