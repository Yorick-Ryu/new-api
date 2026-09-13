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
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import {
  subscriptionPlanSchema,
  type UserSubscription,
} from '@/features/subscriptions/types'
import { api } from '@/lib/api'

import { SubscriptionPlansCard } from '../subscription-plans-card'
import { UserSubscriptionCard } from '../user-subscription-card'

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
    const records = status === 'none' ? [] : [{ subscription }]
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
    expect(planCard.querySelector('[data-slot="separator"]')).toBeNull()
    const article = screen.getByRole('article', { name: 'Monthly Pro #7' })
    const header = article.querySelector('header')
    if (!header) throw new Error('Subscription header is missing')
    const title = within(header).getByRole('heading', {
      name: 'Monthly Pro',
      level: 3,
    })
    expect(title.classList.contains('text-[13px]')).toBe(true)
    expect(
      within(header)
        .getByText('Subscription #7')
        .classList.contains('text-[11px]')
    ).toBe(true)
    expect(
      header
        .querySelector('[data-slot="status-badge"]')
        ?.classList.contains('text-[11px]')
    ).toBe(true)
    const renewalButton = within(header).getByRole('button', { name: 'Renew' })
    expect(renewalButton.classList.contains('bg-primary')).toBe(true)
    expect(header.classList.contains('flex')).toBe(true)
    expect(header.classList.contains('items-center')).toBe(true)
    const details = renewalButton.parentElement
    if (!details) throw new Error('Subscription details are missing')
    expect(details.classList.contains('flex')).toBe(true)
    expect(details.classList.contains('items-center')).toBe(true)
    expect(details.classList.contains('flex-wrap')).toBe(false)
    const expiry = details.querySelector('time')
    if (!expiry) throw new Error('Expiry must share the renewal button row')
    expect(
      expiry.compareDocumentPosition(renewalButton) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    // Neither the summary nor the plan action needs a separator.
    const summary = screen.getByRole('region', { name: 'My Subscriptions' })
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

it('keeps a long subscription title readable and lays out quota windows responsively', async () => {
  const title =
    'Monthly Pro with extended model access and additional hourly quota'
  const onRenew = vi.fn()
  const user = userEvent.setup()
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
  render(
    <I18nextProvider i18n={i18n}>
      <UserSubscriptionCard
        plan={{ ...plan, title }}
        record={{
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
        }}
        onRenew={onRenew}
      />
    </I18nextProvider>
  )
  expect(
    screen
      .getByRole('heading', { name: title })
      .classList.contains('wrap-anywhere')
  ).toBe(true)
  const hourly = screen.getByRole('progressbar', { name: 'Hourly quota' })
  expect(hourly.getAttribute('aria-valuenow')).toBe('25')
  expect(screen.getAllByRole('progressbar')).toHaveLength(2)
  const quotaPanel = hourly.closest(
    '[data-slot="subscription-quota-usage"]'
  )?.parentElement
  expect(quotaPanel?.classList.contains('grid-cols-1')).toBe(true)
  expect(quotaPanel?.classList.contains('@xl:grid-cols-2')).toBe(true)
  await user.click(screen.getByRole('button', { name: 'Renew' }))
  expect(onRenew).toHaveBeenCalledWith(
    expect.objectContaining({ title }),
    subscription
  )
})
