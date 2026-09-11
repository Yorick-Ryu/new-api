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
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import { AnnouncementReminder } from '@/components/announcement-popup'
import type { AnnouncementItem } from '@/features/dashboard/types'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  useAuthStore.getState().auth.reset()
  vi.restoreAllMocks()
  localStorage.clear()
})

const announcement: AnnouncementItem = {
  id: 1,
  content: '## Pricing update\n\nPlease read this announcement.',
  publishDate: '2020-01-01T00:00:00Z',
  popup: true,
}

function mount(
  announcements = [announcement],
  enabled = true,
  userId: number | null = 1
) {
  useAuthStore
    .getState()
    .auth.setUser(userId ? { id: userId, username: 'test', role: 1 } : null)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  client.setQueryData(['status'], {
    announcements_enabled: enabled,
    announcements,
  })
  const view = render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <AnnouncementReminder />
      </QueryClientProvider>
    </I18nextProvider>
  )
  return { ...view, client }
}

it('automatically displays a published popup and remembers acknowledgement after remount', async () => {
  const first = mount()
  expect(
    screen.getByRole('dialog', { name: 'Important announcement' })
  ).toBeDefined()
  expect(screen.getByText('Please read this announcement.')).toBeDefined()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'I understand' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  first.unmount()
  mount()
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('shows a changed announcement again and keeps acknowledgements separate for another account', async () => {
  const view = mount()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'I understand' }))
  act(() => {
    view.client.setQueryData(['status'], {
      announcements_enabled: true,
      announcements: [{ ...announcement, content: 'Updated pricing' }],
    })
  })
  expect(await screen.findByText('Updated pricing')).toBeDefined()
  await user.click(screen.getByRole('button', { name: 'I understand' }))
  act(() =>
    useAuthStore.getState().auth.setUser({ id: 2, username: 'second', role: 1 })
  )
  expect(await screen.findByText('Updated pricing')).toBeDefined()
  await user.click(screen.getByRole('button', { name: 'I understand' }))
  act(() =>
    useAuthStore.getState().auth.setUser({ id: 1, username: 'test', role: 1 })
  )
  expect(screen.queryByRole('dialog')).toBeNull()
})

it.each([
  {
    name: 'disabled announcements',
    items: [announcement],
    enabled: false,
    userId: 1,
  },
  {
    name: 'signed-out visitor',
    items: [announcement],
    enabled: true,
    userId: null,
  },
  {
    name: 'ordinary announcement',
    items: [{ ...announcement, popup: false }],
    enabled: true,
    userId: 1,
  },
  {
    name: 'legacy announcement without a popup option',
    items: [{ ...announcement, popup: undefined }],
    enabled: true,
    userId: 1,
  },
  {
    name: 'scheduled announcement',
    items: [{ ...announcement, publishDate: '2999-01-01T00:00:00Z' }],
    enabled: true,
    userId: 1,
  },
  { name: 'empty announcements', items: [], enabled: true, userId: 1 },
])('does not open a popup for $name', ({ items, enabled, userId }) => {
  mount(items, enabled, userId)
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('shows unread popups newest first and allows keyboard dismissal', async () => {
  mount([
    announcement,
    {
      ...announcement,
      id: 2,
      content: 'Newer announcement',
      publishDate: '2020-02-01T00:00:00Z',
    },
  ])
  expect(screen.getByText('Newer announcement')).toBeDefined()
  const user = userEvent.setup()
  await user.keyboard('{Escape}')
  expect(
    await screen.findByText('Please read this announcement.')
  ).toBeDefined()
  await user.click(screen.getByRole('button', { name: 'I understand' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('can be acknowledged for this visit when browser storage is unavailable', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Storage unavailable')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage unavailable')
  })
  const view = mount()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'I understand' }))
  act(() =>
    view.client.setQueryData(['status'], {
      announcements_enabled: true,
      announcements: [announcement],
    })
  )
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('waits for the server instead of displaying a removed popup from cached status', async () => {
  localStorage.setItem(
    'status',
    JSON.stringify({
      announcements_enabled: true,
      announcements: [announcement],
    })
  )
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: { announcements_enabled: true, announcements: [] },
    },
  })
  useAuthStore.getState().auth.setUser({ id: 1, username: 'test', role: 1 })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <AnnouncementReminder />
      </QueryClientProvider>
    </I18nextProvider>
  )
  expect(screen.queryByRole('dialog')).toBeNull()
  await waitFor(() =>
    expect(client.getQueryData(['status'])).toMatchObject({ announcements: [] })
  )
  expect(screen.queryByRole('dialog')).toBeNull()
})
