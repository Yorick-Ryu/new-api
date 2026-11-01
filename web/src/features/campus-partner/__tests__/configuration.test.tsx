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
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosResponse } from 'axios'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { CampusAdmin } from '../admin'

const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
})

function renderConfiguration(enabled = false) {
  let config = { enabled, plus_plan_id: 1, ultra_plan_id: 2 }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  clients.push(client)
  client.setQueryData(['campus', 'config'], config)
  client.setQueryData(['campus', 'records', true, 'withdrawals', 1], {
    items: [],
    total: 0,
  })
  vi.spyOn(api, 'get').mockImplementation(
    async (url) =>
      ({
        data: {
          success: true,
          data:
            url === '/api/campus/admin/config'
              ? config
              : { items: [], total: 0 },
        },
      }) as AxiosResponse
  )
  const put = vi.spyOn(api, 'put').mockImplementation(async (_url, data) => {
    config = data as typeof config
    return { data: { success: true, data: config } } as AxiosResponse
  })
  render(
    <QueryClientProvider client={client}>
      <CampusAdmin />
    </QueryClientProvider>
  )
  return { put, client, user: userEvent.setup() }
}

test.each([false, true])(
  'changing the campaign from enabled=%s requires confirmation and cancel leaves the saved state unchanged',
  async (enabled) => {
    const { user, put } = renderConfiguration(enabled)
    const control = screen.getByRole('switch', { name: 'Enable campaign' })
    await user.click(control)
    const dialog = await screen.findByRole('alertdialog', {
      name: enabled ? 'Disable campaign?' : 'Enable campaign?',
    })
    expect(control).toHaveAttribute('aria-checked', String(enabled))
    expect(put).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(control).toHaveAttribute('aria-checked', String(enabled))
    expect(put).not.toHaveBeenCalled()
  }
)

test.each([false, true])(
  'confirming the campaign change from enabled=%s saves once and updates the switch',
  async (enabled) => {
    const { user, put } = renderConfiguration(enabled)
    await user.click(screen.getByRole('switch', { name: 'Enable campaign' }))
    const dialog = await screen.findByRole('alertdialog', {
      name: enabled ? 'Disable campaign?' : 'Enable campaign?',
    })
    await user.click(
      within(dialog).getByRole('button', {
        name: enabled ? 'Disable campaign' : 'Enable campaign',
      })
    )
    await waitFor(() =>
      expect(
        screen.getByRole('switch', { name: 'Enable campaign' })
      ).toHaveAttribute('aria-checked', String(!enabled))
    )
    expect(put).toHaveBeenCalledExactlyOnceWith('/api/campus/admin/config', {
      enabled: !enabled,
      plus_plan_id: 1,
      ultra_plan_id: 2,
    })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  }
)

test('a failed activation keeps the previous switch state and confirmation open for retry', async () => {
  const { user, put } = renderConfiguration()
  put.mockRejectedValueOnce(new Error('offline'))
  const control = screen.getByRole('switch', { name: 'Enable campaign' })
  await user.click(control)
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Enable campaign?',
  })
  await user.click(
    within(dialog).getByRole('button', { name: 'Enable campaign' })
  )
  await waitFor(() =>
    expect(
      within(dialog).getByRole('button', { name: 'Enable campaign' })
    ).toBeEnabled()
  )
  expect(control).not.toBeChecked()
  expect(dialog).toBeVisible()
  await user.click(
    within(dialog).getByRole('button', { name: 'Enable campaign' })
  )
  await waitFor(() =>
    expect(
      screen.getByRole('switch', { name: 'Enable campaign' })
    ).toBeChecked()
  )
})

test('activation waits for the server and prevents duplicate confirmation while the request is pending', async () => {
  const { user, put } = renderConfiguration()
  let resolve!: (response: AxiosResponse) => void
  put.mockImplementationOnce(
    () =>
      new Promise<AxiosResponse>((done) => {
        resolve = done
      })
  )
  const control = screen.getByRole('switch', { name: 'Enable campaign' })
  await user.click(control)
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Enable campaign?',
  })
  const confirm = within(dialog).getByRole('button', {
    name: 'Enable campaign',
  })
  await user.click(confirm)
  expect(confirm).toBeDisabled()
  expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
  expect(control).not.toBeChecked()
  await user.click(confirm)
  expect(put).toHaveBeenCalledTimes(1)
  await act(async () => {
    resolve({
      data: { success: false, message: 'Operation failed' },
    } as AxiosResponse)
  })
  await waitFor(() => expect(confirm).toBeEnabled())
  expect(control).not.toBeChecked()
})

test('activation uses saved plan settings and preserves unsaved plan edits for a separate save', async () => {
  const { user, put } = renderConfiguration()
  const plus = screen.getByRole('spinbutton', {
    name: 'Plus subscription plan ID',
  })
  await user.clear(plus)
  await user.type(plus, '3')
  await user.click(screen.getByRole('switch', { name: 'Enable campaign' }))
  const dialog = await screen.findByRole('alertdialog', {
    name: 'Enable campaign?',
  })
  await user.click(
    within(dialog).getByRole('button', { name: 'Enable campaign' })
  )
  await waitFor(() =>
    expect(
      screen.getByRole('switch', { name: 'Enable campaign' })
    ).toBeChecked()
  )
  expect(put).toHaveBeenNthCalledWith(1, '/api/campus/admin/config', {
    enabled: true,
    plus_plan_id: 1,
    ultra_plan_id: 2,
  })
  expect(
    screen.getByRole('spinbutton', { name: 'Plus subscription plan ID' })
  ).toHaveValue(3)
  await user.click(screen.getByRole('button', { name: 'Save plan settings' }))
  await waitFor(() =>
    expect(put).toHaveBeenNthCalledWith(2, '/api/campus/admin/config', {
      enabled: true,
      plus_plan_id: 3,
      ultra_plan_id: 2,
    })
  )
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})
