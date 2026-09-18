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
// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createRootRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { SystemInfoSection } from '../system-info-section'

const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  document.body.innerHTML = ''
  window.localStorage.clear()
})

async function openSettings() {
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  const actions = document.createElement('div')
  document.body.append(actions)
  const root = createRootRoute({
    component: () => (
      <SettingsPageProvider actionsContainer={actions}>
        <SystemInfoSection
          defaultValues={{
            SystemName: 'New API',
            TaskPublicAddress: '',
            ServerAddress: 'https://api.example.com',
            SiteAddress: 'https://example.com',
            SiteAllowedOrigins: 'https://www.example.com',
            legal: {},
          }}
        />
      </SettingsPageProvider>
    ),
  })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>
  )
  await screen.findByRole('textbox', { name: 'Business site address' })
  return userEvent.setup()
}

it('saves a changed business address without submitting the API address and clears cached status', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true, message: '' } })
  window.localStorage.setItem('status', '{}')
  const user = await openSettings()
  const field = screen.getByRole('textbox', { name: 'Business site address' })
  await user.clear(field)
  await user.type(field, 'https://www.example.com/')
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/option/', {
      key: 'SiteAddress',
      value: 'https://www.example.com',
    })
  )
  expect(put).toHaveBeenCalledTimes(1)
  expect(
    (
      screen.getByRole('textbox', {
        name: 'API request address',
      }) as HTMLInputElement
    ).value
  ).toBe('https://api.example.com')
  expect(window.localStorage.getItem('status')).toBeNull()
})
it('shows an inline validation error and does not save a business address containing a path', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true, message: '' } })
  const user = await openSettings()
  const field = screen.getByRole('textbox', { name: 'Business site address' })
  await user.clear(field)
  await user.type(field, 'https://example.com/user/reset')
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await screen.findByText(
    'Enter an HTTP or HTTPS origin without a path, query, or fragment'
  )
  expect(field.getAttribute('aria-invalid')).toBe('true')
  expect(put).not.toHaveBeenCalled()
})
