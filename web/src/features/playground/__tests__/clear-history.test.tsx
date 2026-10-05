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
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { Playground } from '..'
import { DEFAULT_CONFIG, STORAGE_KEYS } from '../constants'
import { saveConfig, saveMessages } from '../lib/storage/storage'

let client: QueryClient

beforeEach(() => {
  localStorage.clear()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/user/models') {
      return { data: { success: true, data: ['gpt-6-astra'] } }
    }
    if (url === '/api/user/self/groups') {
      return {
        data: {
          success: true,
          data: { default: { desc: 'Default', ratio: 1 } },
        },
      }
    }
    throw new Error(`Unexpected request: ${url}`)
  })
})

afterEach(() => {
  cleanup()
  client.clear()
  vi.restoreAllMocks()
  localStorage.clear()
})

it('provides one standalone clear action and clears only after confirmation', async () => {
  const user = userEvent.setup()
  saveMessages([
    {
      key: 'saved-message',
      from: 'user',
      versions: [{ id: 'v1', content: 'Saved conversation' }],
    },
  ])
  render(
    <QueryClientProvider client={client}>
      <Playground />
    </QueryClientProvider>
  )
  await screen.findByText('Saved conversation')
  const button = screen.getByRole('button', { name: 'Clear chat history' })
  expect(button.closest('form')).toBeNull()
  expect(
    screen.getAllByRole('button', { name: 'Clear chat history' })
  ).toHaveLength(1)
  await user.click(button)
  let dialog = screen.getByRole('alertdialog', { name: 'Clear chat history?' })
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  expect(screen.getByText('Saved conversation')).toBeInTheDocument()
  button.focus()
  await user.keyboard('{Enter}')
  dialog = screen.getByRole('alertdialog', { name: 'Clear chat history?' })
  await user.click(within(dialog).getByRole('button', { name: /^Clear$/ }))
  await waitFor(() =>
    expect(screen.queryByText('Saved conversation')).not.toBeInTheDocument()
  )
  expect(button).toBeDisabled()
  await waitFor(() =>
    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEYS.MESSAGES) || '{}').data
    ).toEqual([])
  )
})

it('disables the clear action while loading and when history is empty', async () => {
  render(
    <QueryClientProvider client={client}>
      <Playground />
    </QueryClientProvider>
  )
  const button = screen.getByRole('button', { name: 'Clear chat history' })
  expect(button).toBeDisabled()
  await waitFor(() =>
    expect(
      screen.queryByText('Loading conversation...')
    ).not.toBeInTheDocument()
  )
  expect(button).toBeDisabled()
})

it('disables clearing while an answer is being generated', async () => {
  const user = userEvent.setup()
  saveConfig({ ...DEFAULT_CONFIG, stream: false })
  type Response = { data: { choices: { message: { content: string } }[] } }
  let finishRequest!: (value: Response) => void
  const response = new Promise<Response>((resolve) => {
    finishRequest = resolve
  })
  vi.spyOn(api, 'post').mockReturnValue(response)
  render(
    <QueryClientProvider client={client}>
      <Playground />
    </QueryClientProvider>
  )
  await waitFor(() =>
    expect(
      screen.queryByText('Loading conversation...')
    ).not.toBeInTheDocument()
  )
  await user.type(screen.getByPlaceholderText('Ask anything'), 'A new question')
  const send = screen.getAllByRole('button', { name: /Send/ })[0]
  await waitFor(() => expect(send).toBeEnabled())
  await user.click(send)
  const clear = screen.getByRole('button', { name: 'Clear chat history' })
  await screen.findAllByRole('button', { name: /Stop/ })
  expect(clear).toBeDisabled()
  finishRequest({
    data: { choices: [{ message: { content: 'Finished answer' } }] },
  })
  await screen.findByText('Finished answer')
  expect(clear).toBeEnabled()
})
