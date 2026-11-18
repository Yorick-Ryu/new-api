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
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test } from 'vitest'

import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { PublicFooter } from '../public-footer'

const clients: QueryClient[] = []
const originalConfig = useSystemConfigStore.getState().config

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  useSystemConfigStore.getState().setConfig(originalConfig)
})

function renderFooter(footerHtml = '') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  clients.push(client)
  client.setQueryData(STATUS_QUERY_KEY, {
    user_agreement_enabled: true,
    privacy_policy_enabled: true,
  })
  useSystemConfigStore.getState().setConfig({
    systemName: 'Research Lab',
    footerHtml,
    demoSiteEnabled: true,
  })
  const router = createRouter({
    routeTree: createRootRoute({ component: PublicFooter }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

test('public pages share the configured brand, legal links and keyboard-accessible attribution', async () => {
  renderFooter()
  const footer = await screen.findByRole('contentinfo')
  expect(within(footer).getByText('Research Lab')).toBeVisible()
  expect(
    within(footer).getByText(`© ${new Date().getFullYear()} Research Lab`)
  ).toBeVisible()
  expect(
    within(footer).getByRole('link', { name: 'User Agreement' })
  ).toHaveAttribute('href', '/user-agreement')
  expect(
    within(footer).getByRole('link', { name: 'Privacy Policy' })
  ).toHaveAttribute('href', '/privacy-policy')
  expect(within(footer).queryByRole('list')).not.toBeInTheDocument()
  const user = userEvent.setup()
  within(footer)
    .getByRole('button', { name: 'Open-source attribution' })
    .focus()
  await user.keyboard('{Enter}')
  const dialog = await screen.findByRole('dialog', {
    name: 'Open-source attribution',
  })
  expect(
    within(dialog).getByRole('link', { name: 'GNU AGPLv3' })
  ).toHaveAttribute(
    'href',
    'https://github.com/QuantumNous/new-api/blob/main/LICENSE'
  )
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test('the project link and the open-source explanation use matching text colors', async () => {
  renderFooter()
  const footer = await screen.findByRole('contentinfo')
  const projectLink = within(footer).getByRole('link', {
    name: 'Designed and developed based on New API.',
  })
  const explanation = within(footer).getByRole('button', {
    name: 'Open-source attribution',
  })

  for (const control of [projectLink, explanation]) {
    expect(control).toHaveClass(
      'text-muted-foreground/40',
      'hover:text-muted-foreground/80'
    )
  }
})

test('configured footer content retains legal links and project attribution', async () => {
  renderFooter('<p>Custom lab footer</p>')
  const footer = await screen.findByRole('contentinfo')
  expect(within(footer).getByText('Custom lab footer')).toBeVisible()
  expect(
    within(footer).getByRole('link', { name: 'User Agreement' })
  ).toBeVisible()
  expect(
    within(footer).getByRole('link', {
      name: 'Designed and developed based on New API.',
    })
  ).toHaveAttribute('href', 'https://github.com/QuantumNous/new-api')
})
