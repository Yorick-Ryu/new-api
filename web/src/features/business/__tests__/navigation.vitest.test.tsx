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
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, within } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import { OverviewDashboard } from '@/features/dashboard/components/overview/overview-dashboard'
import { getDashboardSectionNavItems } from '@/features/dashboard/section-registry'
import { useSidebarView } from '@/hooks/use-sidebar-view'
import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { Route as BusinessRoute } from '@/routes/_authenticated/business'
import { Route as LegacyRoute } from '@/routes/_authenticated/dashboard/$section'
import { useAuthStore } from '@/stores/auth-store'

import { BusinessPage } from '..'

// Routing tests do not exercise VChart's browser canvas renderer.
vi.mock('@visactor/react-vchart', () => ({ VChart: () => null }))

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  useAuthStore.getState().auth.reset()
  vi.restoreAllMocks()
})

function Navigation() {
  const view = useSidebarView()
  return (
    <>
      {view.navGroups.map((group) => (
        <nav key={group.id} aria-label={group.title}>
          {group.items.map((item) =>
            'url' in item && item.url ? (
              <a key={item.url} href={item.url}>
                {item.title}
              </a>
            ) : null
          )}
        </nav>
      ))}
      <Outlet />
    </>
  )
}

function mount(role: number, path = '/business', sidebarConfig = '') {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'test', role })
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  clients.push(client)
  client.setQueryData(['status'], { SidebarModulesAdmin: sidebarConfig })
  const get = vi
    .spyOn(api, 'get')
    .mockImplementation(() => new Promise(() => {}))
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({
    component: Navigation,
  })
  // Reuse production guards in a memory router with different route IDs.
  const routes = [
    createRoute({
      getParentRoute: () => root,
      path: '/business',
      beforeLoad: (context) => {
        const guard = BusinessRoute.options.beforeLoad
        return guard?.(
          context as unknown as NonNullable<
            Parameters<NonNullable<typeof guard>>[0]
          >
        )
      },
      component: BusinessPage,
    }),
    createRoute({
      getParentRoute: () => root,
      path: '/dashboard/$section',
      beforeLoad: (context) => {
        const guard = LegacyRoute.options.beforeLoad
        return guard?.(
          context as unknown as NonNullable<
            Parameters<NonNullable<typeof guard>>[0]
          >
        )
      },
    }),
    createRoute({
      getParentRoute: () => root,
      path: '/home',
      component: OverviewDashboard,
    }),
    createRoute({
      getParentRoute: () => root,
      path: '/403',
      component: () => <p>Forbidden</p>,
    }),
  ]
  const router = createRouter({
    routeTree: root.addChildren(routes),
    context: { queryClient: client },
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>
  )
  return { get, router }
}

it.each([ROLE.ADMIN, ROLE.SUPER_ADMIN])(
  'gives role %s a separate business page in Admin after Subscriptions',
  async (role) => {
    mount(role)
    await screen.findByRole('region', { name: 'Business overview' })
    const admin = screen.getByRole('navigation', { name: 'Admin' })
    const links = within(admin).getAllByRole('link')
    const index = links.findIndex(
      (link) => link.textContent === 'Business overview'
    )
    expect(links[index].getAttribute('href')).toBe('/business')
    expect(links[index - 1].textContent).toBe('Subscriptions')
    if (role === ROLE.SUPER_ADMIN) {
      expect(links[index + 1].textContent).toBe('System Info')
    }
    expect(
      within(screen.getByRole('navigation', { name: 'General' })).queryByRole(
        'link',
        { name: 'Business overview' }
      )
    ).toBeNull()
    expect(
      getDashboardSectionNavItems(i18n.t, { isAdmin: true }).some(
        (item) => item.title === 'Business overview'
      )
    ).toBe(false)
  }
)

it.each(['/business', '/dashboard/business'])(
  'blocks regular users at %s without requesting business data',
  async (path) => {
    const { get, router } = mount(ROLE.USER, path)
    await screen.findByText('Forbidden')
    expect(router.state.location.pathname).toBe('/403')
    expect(screen.queryByRole('link', { name: 'Business overview' })).toBeNull()
    expect(get).not.toHaveBeenCalled()
  }
)

it('redirects old administrator bookmarks to the independent business page', async () => {
  const { router } = mount(ROLE.ADMIN, '/dashboard/business')
  await screen.findByRole('region', { name: 'Business overview' })
  expect(router.state.location.pathname).toBe('/business')
})

it('keeps the administrator homepage free of business cards and business requests', async () => {
  const { get } = mount(ROLE.ADMIN, '/home')
  await screen.findByRole('heading', { name: 'Usage at a glance' })
  expect(screen.queryByRole('region', { name: 'Business overview' })).toBeNull()
  expect(get.mock.calls.some(([url]) => url === '/api/data/business')).toBe(
    false
  )
})

it('honors an administrator hiding the business navigation module', async () => {
  mount(ROLE.ADMIN, '/business', '{"admin":{"enabled":true,"business":false}}')
  await screen.findByRole('region', { name: 'Business overview' })
  expect(screen.queryByRole('link', { name: 'Business overview' })).toBeNull()
})
