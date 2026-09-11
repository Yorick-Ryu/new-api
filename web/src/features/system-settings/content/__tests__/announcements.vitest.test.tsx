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
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { AnnouncementsSection } from '../announcements-section'

const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
})

async function openAnnouncementForm() {
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
  const client = new QueryClient()
  clients.push(client)
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <AnnouncementsSection enabled data='[]' />
      </QueryClientProvider>
    </I18nextProvider>
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Add Announcement' }))
  return user
}

it.each(['公', '😀'])(
  'accepts an announcement containing 500 %s characters',
  async (character) => {
    const user = await openAnnouncementForm()
    await user.click(screen.getByRole('textbox', { name: 'Content' }))
    await user.paste(character.repeat(500))
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText(character.repeat(500))).toBeDefined()
  }
)

it('counts Chinese, emoji, Markdown symbols and newlines in the editor', async () => {
  const user = await openAnnouncementForm()
  await user.click(screen.getByRole('textbox', { name: 'Content' }))
  await user.paste('## 公告\n😀')
  expect(screen.getByText('7 / 500')).toBeDefined()
})

it('rejects 501 characters and allows correction to 500 without truncating input', async () => {
  const user = await openAnnouncementForm()
  const content = screen.getByRole('textbox', { name: 'Content' })
  await user.click(content)
  await user.paste('公'.repeat(501))
  await user.click(screen.getByRole('button', { name: 'Add' }))
  expect(
    await screen.findByText('Content must be at most 500 characters')
  ).toBeDefined()
  expect(content.getAttribute('aria-invalid')).toBe('true')
  expect((content as HTMLTextAreaElement).value).toBe('公'.repeat(501))
  await user.clear(content)
  await user.paste('公'.repeat(500))
  await user.click(screen.getByRole('button', { name: 'Add' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('accepts 200 Unicode notes characters and rejects 201', async () => {
  const user = await openAnnouncementForm()
  await user.type(screen.getByRole('textbox', { name: 'Content' }), '公告')
  const extra = screen.getByRole('textbox', { name: 'Extra Notes (Optional)' })
  await user.click(extra)
  await user.paste('😀'.repeat(201))
  await user.click(screen.getByRole('button', { name: 'Add' }))
  expect(
    await screen.findByText('Extra must be at most 200 characters')
  ).toBeDefined()
  expect(extra.getAttribute('aria-invalid')).toBe('true')
  await user.clear(extra)
  await user.paste('😀'.repeat(200))
  expect(screen.getByText('200 / 200')).toBeDefined()
  await user.click(screen.getByRole('button', { name: 'Add' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('previews a popup and saves the popup option with the announcement', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const user = await openAnnouncementForm()
  await user.type(
    screen.getByRole('textbox', { name: 'Content' }),
    'Important update'
  )
  const popup = screen.getByRole('checkbox', { name: 'Show as popup' })
  expect(popup.getAttribute('aria-checked')).toBe('false')
  await user.click(popup)
  await user.click(screen.getByRole('button', { name: 'Preview popup' }))
  const preview = await screen.findByRole('dialog', {
    name: 'Important announcement',
  })
  expect(within(preview).getByText('Important update')).toBeDefined()
  await user.click(screen.getByRole('button', { name: 'I understand' }))
  await user.click(screen.getByRole('button', { name: 'Add' }))
  await user.click(screen.getByRole('button', { name: 'Save Settings' }))
  await waitFor(() => expect(put).toHaveBeenCalled())
  const payload = put.mock.calls[0][1] as { key: string; value: string }
  expect(payload.key).toBe('console_setting.announcements')
  expect(JSON.parse(payload.value)).toEqual([
    expect.objectContaining({ content: 'Important update', popup: true }),
  ])
})
