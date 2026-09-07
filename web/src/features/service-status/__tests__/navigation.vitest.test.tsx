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
import { cleanup, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it } from 'vitest'

import { getOperationsSectionNavItems } from '@/features/system-settings/operations/section-registry'
import { useSidebarConfig } from '@/hooks/use-sidebar-config'
import { useSidebarData } from '@/hooks/use-sidebar-data'
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
  const data = useSidebarData()
  const groups = useSidebarConfig(data.navGroups)
  return (
    <nav>
      {groups
        .flatMap((group) => group.items)
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
function renderNavigation(admin = '', personal = '') {
  const client = new QueryClient()
  clients.push(client)
  client.setQueryData(['status'], { SidebarModulesAdmin: admin })
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'test',
    role: 1,
    sidebar_modules: personal,
  })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <Navigation />
      </QueryClientProvider>
    </I18nextProvider>
  )
}
describe('Service status navigation', () => {
  it('places management under Operations instead of the main sidebar', () => {
    renderNavigation()
    expect(
      screen
        .getAllByRole('link')
        .some((link) => link.getAttribute('href') === '/service-status/manage')
    ).toBe(false)
    expect(getOperationsSectionNavItems(i18n.t)).toContainEqual({
      title: 'Service status',
      url: '/system-settings/operations/service-status',
    })
  })

  it('appears directly after Dashboard for existing users with legacy settings', () => {
    renderNavigation(
      '{"console":{"enabled":true,"detail":true}}',
      '{"console":{"enabled":true,"detail":true}}'
    )
    const links = screen.getAllByRole('link')
    const dashboard = links.findIndex(
      (link) => link.textContent === 'Dashboard'
    )
    expect(links[dashboard + 1].textContent).toBe('Service status')
    expect(links[dashboard + 1].getAttribute('href')).toBe('/service-status')
  })
  it('honors the administrator visibility setting even if the user enables it', () => {
    renderNavigation(
      '{"console":{"enabled":true,"service_status":false}}',
      '{"console":{"enabled":true,"service_status":true}}'
    )
    expect(screen.queryByRole('link', { name: 'Service status' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeTruthy()
  })
  it('allows a user to hide the service status entry without hiding Dashboard', () => {
    renderNavigation('', '{"console":{"enabled":true,"service_status":false}}')
    expect(screen.queryByRole('link', { name: 'Service status' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeTruthy()
  })
})
