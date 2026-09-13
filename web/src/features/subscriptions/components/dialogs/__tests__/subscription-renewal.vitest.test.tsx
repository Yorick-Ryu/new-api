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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { subscriptionPlanSchema, type UserSubscription } from '../../../types'
import { SubscriptionPurchaseDialog } from '../subscription-purchase-dialog'

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
afterEach(cleanup)

const plan = subscriptionPlanSchema.parse({
  id: 1,
  title: 'Monthly Pro',
  price_amount: 2,
  duration_unit: 'day',
  duration_value: 30,
  quota_reset_period: 'daily',
  enabled: true,
  sort_order: 0,
  max_purchase_per_user: 1,
  total_amount: 1000,
  stripe_price_id: 'price-test',
  creem_product_id: 'product-test',
  waffo_pancake_product_id: 'pancake-test',
})
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

it.each([
  ['Pay with Balance', '/api/subscription/balance/pay'],
  ['Stripe', '/api/subscription/stripe/pay'],
  ['Creem', '/api/subscription/creem/pay'],
  ['Waffo Pancake', '/api/subscription/waffo-pancake/pay'],
  ['Pay', '/api/subscription/epay/pay'],
])(
  'sends the renewal target through %s even when the purchase limit is reached',
  async (button, endpoint) => {
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({
        data: { success: false, message: 'Payment rejected' },
      })
    const user = userEvent.setup()
    render(
      <I18nextProvider i18n={i18n}>
        <SubscriptionPurchaseDialog
          open
          onOpenChange={() => {}}
          plan={{ plan }}
          renewalSubscription={subscription}
          purchaseLimit={1}
          purchaseCount={1}
          userQuota={10000000}
          enableStripe
          enableCreem
          enableWaffoPancake
          enableOnlineTopUp
          epayMethods={[{ type: 'alipay', name: 'Alipay' }]}
        />
      </I18nextProvider>
    )
    expect(screen.getByRole('dialog').textContent).toContain(
      'Renew Subscription'
    )
    expect(
      screen.getByRole('button', { name: button }).hasAttribute('disabled')
    ).toBe(false)
    await user.click(screen.getByRole('button', { name: button }))
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        endpoint,
        expect.objectContaining({ plan_id: 1, renewal_subscription_id: 7 })
      )
    )
    // A payment failure keeps the dialog open and allows retry.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: button }).hasAttribute('disabled')
      ).toBe(false)
    )
  }
)

it('keeps a new purchase disabled when the purchase limit is reached', () => {
  render(
    <I18nextProvider i18n={i18n}>
      <SubscriptionPurchaseDialog
        open
        onOpenChange={() => {}}
        plan={{ plan }}
        purchaseLimit={1}
        purchaseCount={1}
        userQuota={10000000}
      />
    </I18nextProvider>
  )
  expect(
    screen
      .getByRole('button', { name: 'Pay with Balance' })
      .hasAttribute('disabled')
  ).toBe(true)
  expect(screen.getByRole('dialog').textContent).toContain(
    'Purchase limit reached'
  )
})

it('refreshes the account and closes after a successful balance renewal', async () => {
  vi.spyOn(api, 'post').mockResolvedValue({ data: { success: true } })
  const onOpenChange = vi.fn()
  const onPurchaseSuccess = vi.fn()
  const user = userEvent.setup()
  render(
    <I18nextProvider i18n={i18n}>
      <SubscriptionPurchaseDialog
        open
        onOpenChange={onOpenChange}
        onPurchaseSuccess={onPurchaseSuccess}
        plan={{ plan }}
        renewalSubscription={subscription}
        userQuota={10000000}
      />
    </I18nextProvider>
  )
  await user.click(screen.getByRole('button', { name: 'Pay with Balance' }))
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  expect(onPurchaseSuccess).toHaveBeenCalled()
})

it('keeps balance renewal disabled when funds are insufficient', () => {
  render(
    <I18nextProvider i18n={i18n}>
      <SubscriptionPurchaseDialog
        open
        onOpenChange={() => {}}
        plan={{ plan }}
        renewalSubscription={subscription}
        userQuota={0}
      />
    </I18nextProvider>
  )
  expect(
    screen
      .getByRole('button', { name: 'Pay with Balance' })
      .hasAttribute('disabled')
  ).toBe(true)
  expect(screen.getByRole('dialog').textContent).toContain(
    'Insufficient balance'
  )
})
