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
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, test, vi } from 'vitest'

import { Button } from '@/components/ui/button'
import { subscriptionPlanSchema } from '@/features/subscriptions/types'
import { SettingsPageProvider } from '@/features/system-settings/components/settings-page-context'
import {
  parseHeaderNavModules,
  serializeHeaderNavModules,
} from '@/features/system-settings/maintenance/config'
import { HeaderNavigationSection } from '@/features/system-settings/maintenance/header-navigation-section'
import { Wallet } from '@/features/wallet'
import { useAffiliate } from '@/features/wallet/hooks/use-affiliate'
import { useTopNavLinks } from '@/hooks/use-top-nav-links'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { getModuleAccessForGuard } from '@/lib/nav-modules'
import { Route } from '@/routes/plans'
import { useAuthStore } from '@/stores/auth-store'

import { PublicCatalog } from '..'

const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  useAuthStore.getState().auth.reset()
  vi.restoreAllMocks()
})
function clientFor(config = '{}') {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  client.setQueryData(['status'], { HeaderNavModules: config })
  clients.push(client)
  return client
}
function wrapper(client: QueryClient) {
  return function Wrapper(props: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {props.children}
      </QueryClientProvider>
    )
  }
}
test('navigation and guards follow rewritten config, including login-only access', async () => {
  const client = clientFor(
    '{"plans":{"enabled":true,"requireAuth":false},"home":false}'
  )
  const result = renderHook(() => useTopNavLinks(), {
    wrapper: wrapper(client),
  })
  await waitFor(() =>
    expect(result.result.current.some((link) => link.href === '/plans')).toBe(
      true
    )
  )
  expect(result.result.current.some((link) => link.href === '/')).toBe(false)
  await act(async () => {
    client.setQueryData(['status'], {
      HeaderNavModules: '{"plans":{"enabled":true,"requireAuth":true}}',
    })
  })
  await waitFor(() =>
    expect(result.result.current.some((link) => link.href === '/plans')).toBe(
      false
    )
  )
  expect(await getModuleAccessForGuard(client, 'plans')).toEqual({
    enabled: true,
    requireAuth: true,
  })
  await act(async () => {
    useAuthStore
      .getState()
      .auth.setUser({ id: 1, username: 'local-reader', role: 1 })
  })
  await waitFor(() =>
    expect(result.result.current.some((link) => link.href === '/plans')).toBe(
      true
    )
  )
  await act(async () => {
    client.setQueryData(['status'], {
      HeaderNavModules: '{"plans":{"enabled":false,"requireAuth":true}}',
    })
  })
  await waitFor(() =>
    expect(result.result.current.some((link) => link.href === '/plans')).toBe(
      false
    )
  )
  expect(await getModuleAccessForGuard(client, 'plans')).toEqual({
    enabled: false,
    requireAuth: true,
  })
})
test('direct route denies disabled configuration and redirects a login-only visitor', async () => {
  const client = clientFor('{"plans":{"enabled":false,"requireAuth":true}}')
  const guard = Route.options.beforeLoad
  if (!guard) throw new Error('Missing plans route guard')
  const context = {
    context: { queryClient: client },
    location: { href: '/plans' },
  } as Parameters<typeof guard>[0]
  await expect(guard(context)).rejects.toMatchObject({ isNotFound: true })
  client.setQueryData(['status'], {
    HeaderNavModules: '{"plans":{"enabled":true,"requireAuth":true}}',
  })
  await expect(guard(context)).rejects.toMatchObject({
    options: { to: '/sign-in', search: { redirect: '/plans' } },
  })
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'local-reader', role: 1 })
  await expect(guard(context)).resolves.toBeUndefined()
})
test('administrator saves the two plan flags while preserving other modules', async () => {
  const config = parseHeaderNavModules(
    '{"home":false,"custom":false,"plans":{"enabled":true,"requireAuth":false}}'
  )
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  render(
    <QueryClientProvider client={clientFor()}>
      <SettingsPageProvider actionsContainer={null}>
        <HeaderNavigationSection
          config={config}
          initialSerialized={serializeHeaderNavModules(config)}
        />
      </SettingsPageProvider>
    </QueryClientProvider>
  )
  const switches = screen
    .getAllByRole('switch')
    .map(
      (item) =>
        item.getAttribute('aria-labelledby') || item.getAttribute('aria-label')
    )
  expect(
    screen.getByText('Public top-up and subscription plans page.')
  ).toBeVisible()
  expect(
    screen.queryByText(
      'Native top-up and subscription page for Bei API only. Hidden on agent sites.'
    )
  ).toBeNull()
  const pricingSwitch = screen.getByRole('switch', { name: 'Model Square' })
  const plansSwitch = screen.getByRole('switch', { name: 'Top-up Plans' })
  expect(
    pricingSwitch.compareDocumentPosition(plansSwitch) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  expect(switches.length).toBeGreaterThan(0)
  fireEvent.click(
    screen.getByRole('switch', { name: 'Require login to view top-up plans' })
  )
  const form = document.querySelector('form')
  if (!form) throw new Error('Missing navigation settings form')
  fireEvent.submit(form)
  await waitFor(() => expect(put).toHaveBeenCalled())
  const body = put.mock.calls[0][1] as { key: string; value: string }
  expect(body.key).toBe('HeaderNavModules')
  expect(JSON.parse(body.value)).toMatchObject({
    home: false,
    custom: false,
    plans: { enabled: true, requireAuth: true },
  })
})
test('guest catalog shows live display data and links to login without creating orders', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        topup_amounts: [20],
        subscriptions: [
          {
            id: 1,
            title: 'Local plan',
            subtitle: 'Local only',
            price_amount: 128,
            duration_unit: 'month',
            duration_value: 1,
            total_amount: 62500000,
            quota_reset_period: 'weekly',
            quota_windows: JSON.stringify([
              {
                key: 'monthly',
                name: 'Monthly cap',
                period_unit: 'month',
                period_value: 1,
                amount_total: 250000000,
              },
            ]),
            allow_renewal: true,
            max_purchase_per_user: 1,
          },
        ],
      },
    },
  })
  const post = vi.spyOn(api, 'post')
  const onCredit = vi.fn()
  const root = createRootRoute({
    component: () => <PublicCatalog onCredit={onCredit} onMonthly={vi.fn()} />,
  })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={clientFor()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  expect(
    await screen.findByRole('heading', {
      name: 'Choose your credits. Focus on research.',
    })
  ).toBeVisible()
  expect(document.querySelectorAll('.credit-card')).toHaveLength(6)
  expect(await screen.findByText('Local plan')).toBeVisible()
  expect(screen.getByText('128')).toBeVisible()
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Buy Professional credit pack, pay 200 yuan for 220 USD credits',
    })
  )
  expect(onCredit).toHaveBeenCalledWith(220)
  expect(get).toHaveBeenCalledWith('/api/plans/catalog')
  expect(post).not.toHaveBeenCalled()
  expect(document.querySelector('iframe')).toBeNull()
})
test('plans mode skips the hidden affiliate code request', () => {
  const get = vi.spyOn(api, 'get')
  const hook = renderHook(() => useAffiliate(false))
  expect(hook.result.current.loading).toBe(false)
  expect(get).not.toHaveBeenCalled()
})

test('preserved credit offers and support interactions keep the original UI', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { subscriptions: [], topup_amounts: [] } },
  })
  const onCredit = vi.fn()
  render(
    <QueryClientProvider client={clientFor()}>
      <PublicCatalog onCredit={onCredit} onMonthly={vi.fn()} />
    </QueryClientProvider>
  )
  const offers = [...document.querySelectorAll('.credit-card')]
  expect(
    offers.map((card) => [
      card.querySelector('[data-pay]')?.getAttribute('data-pay'),
      card.querySelector('[data-amount]')?.getAttribute('data-amount'),
    ])
  ).toEqual([
    ['10', '10'],
    ['20', '20'],
    ['100', '100'],
    ['200', '220'],
    ['400', '450'],
    ['1000', '1200'],
  ])
  expect(document.querySelector('.credit-card.featured h3')).toHaveTextContent(
    'Pro'
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Contact support to claim' })
  )
  expect(
    await screen.findByRole('dialog', { name: 'Contact Bei support' })
  ).toBeVisible()
  expect(screen.getByAltText('Bei support WeChat QR code')).toHaveAttribute(
    'src',
    '/beiapi-assets/wechat-community.png'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Can I buy another monthly plan or renew?',
    })
  )
  expect(
    screen.getByRole('button', {
      name: 'Can I buy another monthly plan or renew?',
    })
  ).toHaveAttribute('aria-expanded', 'true')
})

test('original offer buttons reuse native quote and subscription dialogs before any order', async () => {
  const plan = subscriptionPlanSchema.parse({
    id: 6,
    title: 'Plus monthly',
    price_amount: 128,
    duration_unit: 'month',
    duration_value: 1,
    quota_reset_period: 'weekly',
    enabled: true,
    sort_order: 0,
    max_purchase_per_user: 1,
    total_amount: 62500000,
    allow_renewal: true,
  })
  const get = vi.spyOn(api, 'get').mockImplementation(async (path) => {
    let data: unknown
    if (path === '/api/user/topup/info') {
      data = {
        enable_online_topup: true,
        enable_stripe_topup: false,
        pay_methods: [{ type: 'alipay', name: 'Alipay' }],
        min_topup: 1,
        stripe_min_topup: 1,
        amount_options: [220],
        discount: { 220: 0.9 },
      }
    } else if (path === '/api/user/self') data = { quota: 0, aff_quota: 0 }
    else if (path === '/api/subscription/plans') data = [{ plan }]
    else if (path === '/api/subscription/self') {
      data = {
        billing_preference: 'wallet_first',
        subscriptions: [],
        all_subscriptions: [],
      }
    } else throw new Error(`Unexpected read: ${path}`)
    return { data: { success: true, data } }
  })
  const post = vi.spyOn(api, 'post').mockImplementation(async (path) => {
    if (path !== '/api/user/amount') {
      throw new Error(`Unexpected write: ${path}`)
    }
    return { data: { success: true, data: '200' } }
  })
  render(
    <QueryClientProvider client={clientFor()}>
      <Wallet
        renderPlans={(actions) => (
          <>
            <Button
              disabled={actions.loading}
              onClick={() => void actions.purchaseTopup(220)}
            >
              Original credit offer
            </Button>
            <Button
              disabled={actions.loading}
              onClick={() => actions.purchaseSubscription(6)}
            >
              Original monthly offer
            </Button>
          </>
        )}
      />
    </QueryClientProvider>
  )
  const topup = screen.getByRole('button', { name: 'Original credit offer' })
  await waitFor(() => expect(topup).toBeEnabled())
  expect(post).not.toHaveBeenCalled()
  fireEvent.click(topup)
  const confirmation = await screen.findByRole('alertdialog', {
    name: 'Confirm Payment',
  })
  expect(within(confirmation).getByText('200')).toBeVisible()
  expect(
    post.mock.calls.filter(([path]) => path === '/api/user/amount')
  ).toHaveLength(1)
  expect(post.mock.calls[0][1]).toMatchObject({ amount: 220 })
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  fireEvent.click(
    screen.getByRole('button', { name: 'Original monthly offer' })
  )
  const subscription = await screen.findByRole('dialog')
  expect(
    within(subscription).getAllByText('Plus monthly').length
  ).toBeGreaterThan(0)
  expect(post.mock.calls.every(([path]) => path === '/api/user/amount')).toBe(
    true
  )
  expect(get.mock.calls.some(([path]) => String(path).includes('aff'))).toBe(
    false
  )
})

test('Chinese presentation retains all six original package names', async () => {
  const language = createInstance()
  await language.init({
    lng: 'zh',
    resources: { zh },
    interpolation: { escapeValue: false },
  })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { subscriptions: [], topup_amounts: [] } },
  })
  render(
    <I18nextProvider i18n={language}>
      <QueryClientProvider client={clientFor()}>
        <PublicCatalog onCredit={vi.fn()} onMonthly={vi.fn()} />
      </QueryClientProvider>
    </I18nextProvider>
  )
  expect(
    [...document.querySelectorAll('.credit-card h3')].map(
      (el) => el.textContent
    )
  ).toEqual(['轻量包', '标准包', '进阶包', '专业包', '团队包', '旗舰包'])
})
