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
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { SettingsPageProvider } from '../../components/settings-page-context'
import { CodexSettingsCard } from '../codex-settings-card'

let client: QueryClient
const defaults = {
  profiles: { 'gpt-official': { priority: 0, context_window: 400000 } },
  fallback: { priority: 1000, context_window: 200000 },
  models: ['gpt-official', 'gemini-flash', 'claude-opus'],
  group_models: {
    default: ['gpt-official'],
    antigravity: ['claude-opus', 'gemini-flash'],
    empty: [],
  },
  official_sync: null,
}
const overrides = {
  'gpt-official': { context_window: 500000 },
  'gemini-flash': { priority: 10 },
  'claude-opus': { priority: 20 },
  'override-only': { priority: 30 },
}

function mount(
  officialSync: {
    revision: string
    synced_at: number
    model_count: number
    source_url: string
  } | null = null
) {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { ...defaults, official_sync: officialSync } },
  })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const actions = document.createElement('div')
  document.body.append(actions)
  render(
    <QueryClientProvider client={client}>
      <SettingsPageProvider actionsContainer={actions}>
        <CodexSettingsCard overrides={JSON.stringify(overrides)} />
      </SettingsPageProvider>
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  client?.clear()
  document.body.replaceChildren()
})

it('filters enabled models by group, preserves priority order, and handles empty groups', async () => {
  mount()
  const user = userEvent.setup()
  const group = await screen.findByRole('combobox', { name: 'Group' })
  const model = screen.getByRole('combobox', { name: 'Model' })
  expect(model).toHaveValue('gpt-official')
  await user.click(group)
  await user.click(screen.getByRole('option', { name: 'antigravity' }))
  expect(model).toHaveValue('gemini-flash')
  await user.click(model)
  expect(
    screen.getAllByRole('option').map((option) => option.textContent)
  ).toEqual(['gemini-flash', 'claude-opus'])
  await user.click(screen.getByRole('option', { name: 'claude-opus' }))
  expect(
    JSON.parse(
      (
        screen.getByRole('textbox', {
          name: 'Model capabilities JSON',
        }) as HTMLTextAreaElement
      ).value
    ).context_window
  ).toBe(200000)
  await user.click(group)
  await user.click(screen.getByRole('option', { name: 'empty' }))
  expect(model).toBeDisabled()
  expect(model).toHaveValue('')
  expect(screen.getByText('No models in this group yet.')).toBeInTheDocument()
  expect(
    screen.queryByRole('textbox', { name: 'Model capabilities JSON' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()
  await user.click(group)
  await user.click(screen.getByRole('option', { name: 'All groups' }))
  await user.click(model)
  expect(
    screen.getByRole('option', { name: 'override-only' })
  ).toBeInTheDocument()
})

it('supports keyboard group selection and protects unsaved edits while saving only the chosen model', async () => {
  mount()
  const save = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const user = userEvent.setup()
  const group = await screen.findByRole('combobox', { name: 'Group' })
  await user.click(group)
  await user.type(group, 'antigravity')
  await user.keyboard('{ArrowDown}{Enter}')
  expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue(
    'gemini-flash'
  )
  const editor = screen.getByRole('textbox', {
    name: 'Model capabilities JSON',
  })
  fireEvent.input(editor, {
    target: { value: '{"priority":10,"context_window":300000}' },
  })
  await waitFor(() => expect(group).toBeDisabled())
  expect(screen.getByRole('combobox', { name: 'Model' })).toBeDisabled()
  expect(editor).toHaveValue('{"priority":10,"context_window":300000}')
  await user.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  const request = save.mock.calls[0][1] as { key: string; value: string }
  expect(request.key).toBe('CodexModelProfiles')
  expect(JSON.parse(request.value)).toEqual({
    ...overrides,
    'gemini-flash': { priority: 10, context_window: 300000 },
  })
  await waitFor(() => expect(group).toBeEnabled())
})

it.each([
  null,
  {
    revision: '1234567890abcdef',
    synced_at: 1760000000,
    model_count: 11,
    source_url: 'https://example.com/models',
  },
])(
  'allows configuration actions and sync status to wrap without horizontal scrolling (%j)',
  async (officialSync) => {
    mount(officialSync)
    const sync = await screen.findByRole('button', {
      name: 'Sync official configuration',
    })
    const toolbar = sync.parentElement
    const status = officialSync
      ? screen.getByText(/Last sync/)
      : screen.getByText('Not synced yet; using bundled model profiles.')
    expect(toolbar).toHaveClass('flex-wrap')
    expect(toolbar).not.toHaveClass('overflow-x-auto')
    expect(status.parentElement).toBe(toolbar)
    expect(status).not.toHaveClass('whitespace-nowrap')
    expect(status).toHaveClass('min-w-0', 'max-w-full', 'break-words')
  }
)
