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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { LogSettingsSection } from '../log-settings-section'

const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  document.body.replaceChildren()
})

it.each([
  { initial: 'off', next: 'on', label: 'On', initialLabel: 'Off' },
  {
    initial: 'on',
    next: 'admin_only',
    label: 'Admins only',
    initialLabel: 'On',
  },
  {
    initial: 'admin_only',
    next: 'off',
    label: 'Off',
    initialLabel: 'Admins only',
  },
] as const)(
  'saves response model display from $initial to $next',
  async ({ initial, next, label, initialLabel }) => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: null },
    })
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true } })
    const i18n = createInstance()
    await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    clients.push(client)
    const actions = document.createElement('div')
    document.body.append(actions)
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <SettingsPageProvider actionsContainer={actions}>
            <LogSettingsSection
              defaultEnabled
              responseModelDisplayMode={initial === 'off' ? undefined : initial}
            />
          </SettingsPageProvider>
        </QueryClientProvider>
      </I18nextProvider>
    )
    const user = userEvent.setup()
    const select = screen.getByRole('combobox', { name: 'Show response model' })
    expect(select).toHaveTextContent(initialLabel)
    select.focus()
    await user.keyboard('{Enter}')
    expect(screen.getAllByRole('option')).toHaveLength(3)
    await user.click(screen.getByRole('option', { name: label }))
    expect(select).toHaveTextContent(label)
    await user.click(screen.getByRole('button', { name: 'Save log settings' }))
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/api/option/', {
        key: 'LogResponseModelDisplayMode',
        value: next,
      })
    )
    expect(put).toHaveBeenCalledTimes(1)
    expect(
      screen.getByRole('switch', { name: 'Record quota usage' })
    ).toHaveAttribute('aria-checked', 'true')
  }
)
