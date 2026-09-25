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
// @vitest-environment happy-dom
import {
  cleanup,
  render as renderUI,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import {
  subscriptionPlanSchema,
  type UserSubscription,
} from '@/features/subscriptions/types'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'

import { SubscriptionPlansCard } from '../subscription-plans-card'

const queryClients: QueryClient[] = []
function render(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['status'], {})
  queryClients.push(client)
  return renderUI(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
}
afterEach(() => {
  queryClients.splice(0).forEach((client) => client.clear())
})

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
afterEach(cleanup)
const plan = subscriptionPlanSchema.parse({
  id: 1,
  title: 'Monthly Pro',
  allow_renewal: true,
  price_amount: 2,
  duration_unit: 'day',
  duration_value: 30,
  quota_reset_period: 'daily',
  enabled: true,
  sort_order: 0,
  max_purchase_per_user: 1,
  total_amount: 1000,
})

it.each(['active', 'expired', 'cancelled', 'none'])(
  'shows the correct purchase action for a %s subscription',
  async (status) => {
    const subscription: UserSubscription = {
      id: 7,
      user_id: 2,
      plan_id: 1,
      status,
      start_time: 1700000000,
      end_time: status === 'active' ? 2100000000 : 1700003600,
      amount_total: 1000,
      amount_used: 350,
    }
    const records =
      status === 'none'
        ? []
        : [
            {
              subscription,
              quota_windows: [
                {
                  id: 3,
                  user_subscription_id: 7,
                  window_key: 'hourly',
                  name: 'Hourly quota',
                  period_unit: 'hour',
                  period_value: 1,
                  amount_total: 200,
                  amount_used: 50,
                  window_start: 1700000000,
                },
              ],
            },
          ]
    vi.spyOn(api, 'get').mockImplementation(async (url) => ({
      data: {
        success: true,
        data: String(url).endsWith('/plans')
          ? [{ plan }]
          : {
              billing_preference: 'wallet_first',
              subscriptions: status === 'active' ? records : [],
              all_subscriptions: records,
            },
      },
    }))
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      data: { success: false, message: 'Payment rejected' },
    })
    const user = userEvent.setup()
    render(
      <I18nextProvider i18n={i18n}>
        <SubscriptionPlansCard topupInfo={null} userQuota={10000000} />
      </I18nextProvider>
    )
    await screen.findByRole('heading', { name: 'Monthly Pro', level: 4 })
    if (status === 'cancelled') {
      expect(screen.queryByRole('button', { name: /^Renew/ })).toBeNull()
      expect(
        screen
          .getByRole('button', { name: 'Limit Reached' })
          .hasAttribute('disabled')
      ).toBe(true)
      return
    }
    if (status === 'none') {
      expect(
        screen
          .getByRole('button', { name: 'Subscribe Now' })
          .hasAttribute('disabled')
      ).toBe(false)
      return
    }
    // The existing subscription and plan card both expose renewal.
    const planButton = screen.getByRole('button', {
      name: 'Renew Subscription',
    })
    const planCard = planButton.closest('[data-slot="card"]')
    if (!planCard) throw new Error('Subscription plan card is missing')
    expect(planCard.classList.contains('py-0')).toBe(true)
    expect(planCard.querySelector('[data-slot="separator"]')).toBeNull()
    const article = screen.getByRole('article', { name: 'Monthly Pro #7' })
    expect(article.classList.contains('border')).toBe(false)
    expect(article.parentElement?.classList.contains('border')).toBe(true)
    expect(article.parentElement?.classList.contains('rounded-xl')).toBe(true)
    const header = article.querySelector('header')
    if (!header) throw new Error('Subscription header is missing')
    const title = within(header).getByText('Monthly Pro')
    expect(title.classList.contains('text-[13px]')).toBe(true)
    const identifier = within(header).getByText('· Subscription #7')
    expect(identifier.classList.contains('text-muted-foreground')).toBe(true)
    expect(identifier.classList.contains('font-normal')).toBe(true)
    expect(
      header
        .querySelector('[data-slot="status-badge"]')
        ?.classList.contains('text-[11px]')
    ).toBe(true)
    const renewalButton = within(header).getByRole('button', { name: 'Renew' })
    expect(renewalButton.classList.contains('bg-primary')).toBe(true)
    expect(header.classList.contains('flex')).toBe(true)
    expect(header.classList.contains('items-center')).toBe(true)
    const actions = renewalButton.parentElement
    if (!actions) throw new Error('Subscription actions are missing')
    if (status === 'active') {
      const priorityButton = within(header).getByRole('button', {
        name: 'Use first',
      })
      expect(priorityButton.parentElement).toBe(actions)
      expect(priorityButton.classList.contains('h-7')).toBe(true)
      expect(renewalButton.classList.contains('h-7')).toBe(true)
      expect(priorityButton.classList.contains('bg-primary')).toBe(false)
      expect(priorityButton.classList.contains('border-border')).toBe(true)
      expect(
        priorityButton.compareDocumentPosition(renewalButton) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    }
    const details = actions.parentElement
    if (!details) throw new Error('Subscription details are missing')
    expect(details.classList.contains('flex')).toBe(true)
    expect(details.classList.contains('items-center')).toBe(true)
    expect(details.classList.contains('flex-wrap')).toBe(true)
    const expiry = details.querySelector('time')
    if (!expiry) throw new Error('Expiry must share the renewal button row')
    expect(expiry.textContent).toMatch(/\d{1,2}:\d{2}/)
    expect(expiry.textContent).not.toMatch(/\d{1,2}:\d{2}:\d{2}/)
    expect(expiry.getAttribute('datetime')).toBe(
      new Date(subscription.end_time * 1000).toISOString()
    )
    expect(expiry.closest('p')?.classList.contains('text-[12px]')).toBe(true)
    expect(expiry.closest('p')?.classList.contains('text-[11px]')).toBe(false)
    expect(
      expiry.compareDocumentPosition(renewalButton) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    const quotaRows = article.querySelectorAll(
      '[data-slot="subscription-quota-usage"]'
    )
    expect(quotaRows).toHaveLength(2)
    expect(quotaRows[0].classList.contains('border')).toBe(true)
    const quotaLayout = quotaRows[0].parentElement
    expect(quotaLayout?.classList.contains('grid-cols-1')).toBe(true)
    expect(quotaLayout?.classList.contains('@xl:grid-cols-2')).toBe(true)
    if (status === 'active') {
      expect(
        within(article)
          .getByRole('progressbar', { name: 'Hourly quota' })
          .getAttribute('aria-valuenow')
      ).toBe('75')
    }
    // Neither the summary nor the plan action needs a separator.
    const summary = screen.getByRole('region', { name: 'My Subscriptions' })
    expect(summary.classList.contains('border')).toBe(false)
    expect(summary.classList.contains('p-3')).toBe(false)
    expect(summary?.querySelector('[data-slot="separator"]')).toBeNull()
    await user.click(planButton)
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('Renew Subscription')
    await user.click(
      within(dialog).getByRole('button', { name: 'Pay with Balance' })
    )
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/subscription/balance/pay', {
        plan_id: 1,
        renewal_subscription_id: 7,
      })
    )
  }
)

it.each([undefined, false])(
  'hides renewal actions for renewal setting %s and restores them after enabling and refreshing',
  async (initialValue) => {
    let allowRenewal: boolean | undefined = initialValue
    const subscription: UserSubscription = {
      id: 7,
      user_id: 2,
      plan_id: 1,
      status: 'active',
      start_time: 1700000000,
      end_time: 2100000000,
      amount_total: 1000,
      amount_used: 350,
    }
    vi.spyOn(api, 'get').mockImplementation(async (url) => ({
      data: {
        success: true,
        data: String(url).endsWith('/plans')
          ? [{ plan: { ...plan, allow_renewal: allowRenewal } }]
          : {
              billing_preference: 'wallet_first',
              subscriptions: [{ subscription }],
              all_subscriptions: [{ subscription }],
            },
      },
    }))
    const user = userEvent.setup()
    render(
      <I18nextProvider i18n={i18n}>
        <SubscriptionPlansCard topupInfo={null} userQuota={10000000} />
      </I18nextProvider>
    )
    await screen.findByRole('heading', { name: 'Monthly Pro', level: 4 })
    expect(screen.queryByRole('button', { name: /^Renew/ })).toBeNull()
    expect(
      screen
        .getByRole('button', { name: 'Limit Reached' })
        .hasAttribute('disabled')
    ).toBe(true)
    allowRenewal = true
    await user.click(
      screen.getByRole('button', { name: 'Refresh subscriptions' })
    )
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Renew' })).toBeTruthy()
      expect(
        screen.getByRole('button', { name: 'Renew Subscription' })
      ).toBeTruthy()
    })
  }
)

it('saves the preferred subscription, restores it after refresh, and clears it without changing wallet preference', async () => {
  let preferred = 0
  const records = [7, 8].map((id) => ({
    subscription: {
      id,
      user_id: 2,
      plan_id: 1,
      status: 'active',
      start_time: 1700000000,
      end_time: 2100000000 + id,
      amount_total: 1000,
      amount_used: 0,
    },
  }))
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: String(url).endsWith('/plans')
        ? [{ plan }]
        : {
            billing_preference: 'wallet_first',
            preferred_subscription_id: preferred,
            subscriptions: records,
            all_subscriptions: records,
          },
    },
  }))
  const put = vi.spyOn(api, 'put').mockImplementation(async (_url, body) => {
    preferred = (body as { preferred_subscription_id: number })
      .preferred_subscription_id
    return {
      data: { success: true, data: { preferred_subscription_id: preferred } },
    }
  })
  const user = userEvent.setup()
  render(
    <I18nextProvider i18n={i18n}>
      <SubscriptionPlansCard topupInfo={null} />
    </I18nextProvider>
  )
  const article = await screen.findByRole('article', { name: 'Monthly Pro #8' })
  await user.click(within(article).getByRole('button', { name: 'Use first' }))
  await waitFor(() =>
    expect(
      within(article)
        .getByRole('button', { name: 'Set as preferred' })
        .getAttribute('aria-pressed')
    ).toBe('true')
  )
  expect(within(article).queryByText('Preferred')).toBeNull()
  expect(put).toHaveBeenLastCalledWith('/api/subscription/self/preference', {
    preferred_subscription_id: 8,
  })
  await user.click(
    screen.getByRole('button', { name: 'Refresh subscriptions' })
  )
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'Refresh subscriptions' })
        .hasAttribute('disabled')
    ).toBe(false)
  )
  expect(
    within(article)
      .getByRole('button', { name: 'Set as preferred' })
      .getAttribute('aria-pressed')
  ).toBe('true')
  expect(
    screen.queryByRole('button', { name: 'Restore automatic order' })
  ).toBeNull()
  expect(
    within(article)
      .getByRole('button', { name: 'Set as preferred' })
      .hasAttribute('disabled')
  ).toBe(false)
  const otherArticle = screen.getByRole('article', { name: 'Monthly Pro #7' })
  await user.click(
    within(otherArticle).getByRole('button', { name: 'Use first' })
  )
  await waitFor(() =>
    expect(
      within(otherArticle).getByRole('button', { name: 'Set as preferred' })
    ).toBeTruthy()
  )
  expect(
    screen.getAllByRole('button', { name: 'Set as preferred' })
  ).toHaveLength(1)
  expect(
    within(article)
      .getByRole('button', { name: 'Use first' })
      .getAttribute('aria-pressed')
  ).toBe('false')
  await user.click(
    within(otherArticle).getByRole('button', { name: 'Set as preferred' })
  )
  await waitFor(() =>
    expect(
      within(otherArticle)
        .getByRole('button', { name: 'Use first' })
        .getAttribute('aria-pressed')
    ).toBe('false')
  )
  expect(put).toHaveBeenLastCalledWith('/api/subscription/self/preference', {
    preferred_subscription_id: 0,
  })
  await user.click(
    screen.getByRole('button', { name: 'Refresh subscriptions' })
  )
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: 'Refresh subscriptions' })
        .hasAttribute('disabled')
    ).toBe(false)
  )
  expect(screen.queryByRole('button', { name: 'Set as preferred' })).toBeNull()
  expect(
    screen.queryByRole('button', { name: 'Restore automatic order' })
  ).toBeNull()
  expect(screen.getByRole('combobox').textContent).toContain('Wallet First')
})

it.each([0, 7])(
  'keeps preference %s when saving or cancelling fails and disables changes while saving',
  async (preferred) => {
    const records = ['active', 'expired', 'cancelled'].map((status, index) => ({
      subscription: {
        id: index + 7,
        user_id: 2,
        plan_id: 1,
        status,
        start_time: 1700000000,
        end_time: status === 'active' ? 2100000000 : 1700003600,
        amount_total: 1000,
        amount_used: 0,
      },
    }))
    vi.spyOn(api, 'get').mockImplementation(async (url) => ({
      data: {
        success: true,
        data: String(url).endsWith('/plans')
          ? [{ plan }]
          : {
              billing_preference: 'subscription_first',
              preferred_subscription_id: preferred,
              subscriptions: [records[0]],
              all_subscriptions: records,
            },
      },
    }))
    let finish!: (value: {
      data: { success: boolean; message: string }
    }) => void
    const put = vi.spyOn(api, 'put').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const user = userEvent.setup()
    render(
      <I18nextProvider i18n={i18n}>
        <SubscriptionPlansCard topupInfo={null} />
      </I18nextProvider>
    )
    const buttonName = preferred ? 'Set as preferred' : 'Use first'
    const button = await screen.findByRole('button', { name: buttonName })
    expect(screen.getAllByRole('button', { name: buttonName })).toHaveLength(1)
    button.focus()
    await user.keyboard('{Enter}')
    expect(put).toHaveBeenLastCalledWith('/api/subscription/self/preference', {
      preferred_subscription_id: preferred ? 0 : 7,
    })
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(true))
    const billingPreference = screen.getByRole('combobox')
    expect(billingPreference.hasAttribute('disabled')).toBe(true)
    expect(billingPreference.classList.contains('disabled:opacity-100')).toBe(
      true
    )
    expect(billingPreference.classList.contains('disabled:opacity-50')).toBe(
      false
    )
    expect(billingPreference.textContent).toContain('Subscription First')
    await user.click(billingPreference)
    expect(put).toHaveBeenCalledTimes(1)
    expect(
      screen
        .getByRole('button', { name: 'Refresh subscriptions' })
        .hasAttribute('disabled')
    ).toBe(true)
    finish({ data: { success: false, message: 'Preference rejected' } })
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
    expect(billingPreference.hasAttribute('disabled')).toBe(false)
    expect(button.getAttribute('aria-pressed')).toBe(String(preferred > 0))
    expect(button.textContent).toContain(buttonName)
    expect(screen.queryByText('Preferred')).toBeNull()
  }
)

it('shows the priority controls in Chinese using the application translations', async () => {
  const chinese = createInstance()
  await chinese.init({ lng: 'zh', resources: { zh }, keySeparator: false })
  const subscription = {
    id: 7,
    user_id: 2,
    plan_id: 1,
    status: 'active',
    start_time: 1700000000,
    end_time: 2100000000,
    amount_total: 1000,
    amount_used: 0,
  }
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: String(url).endsWith('/plans')
        ? [{ plan }]
        : {
            billing_preference: 'subscription_first',
            preferred_subscription_id: 7,
            subscriptions: [{ subscription }],
            all_subscriptions: [{ subscription }],
          },
    },
  }))
  render(
    <I18nextProvider i18n={chinese}>
      <SubscriptionPlansCard topupInfo={null} />
    </I18nextProvider>
  )
  expect(await screen.findByRole('button', { name: '已设为优先' })).toBeTruthy()
  expect(screen.queryByText('优先套餐')).toBeNull()
  expect(screen.queryByRole('button', { name: '恢复自动顺序' })).toBeNull()
})
