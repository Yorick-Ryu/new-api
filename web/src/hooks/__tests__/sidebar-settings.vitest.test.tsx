import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it } from 'vitest'

import { useSidebarView } from '@/hooks/use-sidebar-view'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  useAuthStore.getState().auth.reset()
})
function Navigation() {
  const view = useSidebarView()
  return (
    <nav>
      {view.navGroups
        .flatMap((group) => group.items)
        .flatMap((item) => item.items ?? [item])
        .map((item) =>
          'url' in item && item.url ? (
            <a key={item.url} href={item.url}>
              {item.title}
            </a>
          ) : null
        )}
    </nav>
  )
}
function mount(role: number) {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'test', role })
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  })
  clients.push(client)
  client.setQueryData(['status'], {})
  const root = createRootRoute({ component: Navigation })
  const route = createRoute({
    getParentRoute: () => root,
    path: '/system-settings/operations/service-status',
  })
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({
      initialEntries: ['/system-settings/operations/service-status'],
    }),
  })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>
  )
}
it('shows only service status settings in the nested menu for an administrator', async () => {
  mount(ROLE.ADMIN)
  await screen.findByRole('link', { name: 'Service status' })
  expect(screen.getAllByRole('link')).toHaveLength(1)
})
it('keeps the other Operations settings available in the nested menu for root', async () => {
  mount(ROLE.SUPER_ADMIN)
  await screen.findByRole('link', { name: 'Service status' })
  expect(screen.getByRole('link', { name: 'Monitoring & Alerts' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'System Behavior' })).toBeTruthy()
})
