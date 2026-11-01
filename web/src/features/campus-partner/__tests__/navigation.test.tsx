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
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { AxiosResponse } from 'axios'
import { afterEach, expect, test, vi } from 'vitest'

import { useSidebarData } from '@/hooks/use-sidebar-data'
import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

const clients: QueryClient[] = []

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  useAuthStore.getState().auth.reset()
  vi.restoreAllMocks()
})

function Navigation() {
  const data = useSidebarData()
  return (
    <nav>
      {data.navGroups
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

function renderNavigation() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'admin', role: ROLE.ADMIN })
  render(
    <QueryClientProvider client={client}>
      <Navigation />
    </QueryClientProvider>
  )
  return client
}

test('the partner entry stays hidden while campaign status loads and when enrollment is disabled', async () => {
  let resolve!: (response: AxiosResponse) => void
  vi.spyOn(api, 'get').mockImplementation(
    () =>
      new Promise<AxiosResponse>((done) => {
        resolve = done
      })
  )
  const client = renderNavigation()
  expect(
    screen.queryByRole('link', { name: 'Campus Partner' })
  ).not.toBeInTheDocument()
  await act(async () => {
    resolve({
      data: { success: true, data: { enabled: false } },
    } as AxiosResponse)
  })
  await waitFor(() =>
    expect(client.getQueryData(['campus', 'overview'])).toEqual({
      enabled: false,
    })
  )
  expect(
    screen.queryByRole('link', { name: 'Campus Partner' })
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: 'Campus Partner administration' })
  ).toBeVisible()
})

test('the partner entry follows enabled status after campaign settings refresh without hiding administration', async () => {
  let enabled = true
  vi.spyOn(api, 'get').mockImplementation(
    async () =>
      ({ data: { success: true, data: { enabled } } }) as AxiosResponse
  )
  const client = renderNavigation()
  expect(
    await screen.findByRole('link', { name: 'Campus Partner' })
  ).toHaveAttribute('href', '/campus-partner')
  enabled = false
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['campus'] })
  })
  await waitFor(() =>
    expect(
      screen.queryByRole('link', { name: 'Campus Partner' })
    ).not.toBeInTheDocument()
  )
  expect(
    screen.getByRole('link', { name: 'Campus Partner administration' })
  ).toBeVisible()
  enabled = true
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['campus'] })
  })
  expect(
    await screen.findByRole('link', { name: 'Campus Partner' })
  ).toBeVisible()
})

test('a failed status refresh hides the partner entry even if an earlier response enabled it', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { enabled: true } },
  } as AxiosResponse)
  const client = renderNavigation()
  expect(
    await screen.findByRole('link', { name: 'Campus Partner' })
  ).toBeVisible()
  get.mockRejectedValue(new Error('offline'))
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['campus'] })
  })
  await waitFor(() =>
    expect(
      screen.queryByRole('link', { name: 'Campus Partner' })
    ).not.toBeInTheDocument()
  )
  expect(
    screen.getByRole('link', { name: 'Campus Partner administration' })
  ).toBeVisible()
})
