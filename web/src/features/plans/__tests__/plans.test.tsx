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
} from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { SettingsPageProvider } from '@/features/system-settings/components/settings-page-context'
import {
  parseHeaderNavModules,
  serializeHeaderNavModules,
} from '@/features/system-settings/maintenance/config'
import { HeaderNavigationSection } from '@/features/system-settings/maintenance/header-navigation-section'
import { useAffiliate } from '@/features/wallet/hooks/use-affiliate'
import { useTopNavLinks } from '@/hooks/use-top-nav-links'
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
  const root = createRootRoute({ component: PublicCatalog })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={clientFor()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  expect(await screen.findByText('Local plan')).toBeVisible()
  expect(screen.getByText('¥128')).toBeVisible()
  expect(screen.getByText(/^Weekly quota:/)).toBeVisible()
  expect(screen.getByText(/^Monthly cap:/)).toBeVisible()
  expect(
    screen
      .getByRole('button', { name: 'Sign in to top up' })
      .getAttribute('href')
  ).toContain('/sign-in')
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
