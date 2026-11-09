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
import type { Row } from '@tanstack/react-table'
import {
  act,
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

import en from '@/i18n/locales/en.json'
import zhTW from '@/i18n/locales/zh-TW.json'
import zhCN from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import type { User } from '../../../types'
import { DataTableRowActions } from '../../data-table-row-actions'
import { UsersProvider } from '../../users-provider'
import { UserPartnerTierDialog } from '../user-partner-tier-dialog'

const target: User = {
  id: 42,
  username: 'partner-42',
  display_name: 'Partner',
  role: 1,
  status: 1,
  quota: 0,
  used_quota: 0,
  request_count: 0,
  group: 'default',
}
const data = {
  joined: true,
  override: 0,
  revision: 7,
  config_revision: 2,
  performance_cents: 10000,
  automatic: { level: 1, rate_percent: 30 },
  effective: { level: 1, rate_percent: 30 },
  tiers: [
    { floor_cents: 0, rate_bps: 3000 },
    { floor_cents: 200000, rate_bps: 3500 },
    { floor_cents: 1000000, rate_bps: 4000 },
  ],
  changes: [],
}
const clients: QueryClient[] = []
function renderDialog(overrides = {}, rowMenu = false, loadFailure = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { ...data, ...overrides } },
  })
  if (loadFailure) get.mockRejectedValue(new Error('load unavailable'))
  const close = vi.fn()
  render(
    <QueryClientProvider client={client}>
      {rowMenu ? (
        <UsersProvider>
          <DataTableRowActions row={{ original: target } as Row<User>} />
        </UsersProvider>
      ) : (
        <UserPartnerTierDialog user={target} onClose={close} />
      )}
    </QueryClientProvider>
  )
  return { close, get }
}
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  vi.restoreAllMocks()
  useAuthStore.getState().auth.reset()
})

it('user row action opens the selected account and requires reason and confirmation before assigning a fixed level', async () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'admin', role: 100 })
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const { get } = renderDialog({}, true)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Open menu' }))
  await user.click(
    await screen.findByRole('menuitem', { name: 'Manage partner' })
  )
  const select = await screen.findByRole('combobox', { name: 'Partner level' })
  expect(get).toHaveBeenCalledWith('/api/campus/admin/members/42/tier')
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  await user.selectOptions(select, '3')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByText('Enter a reason')).toBeVisible()
  expect(put).not.toHaveBeenCalled()
  await user.type(
    screen.getByRole('textbox', { name: 'Reason' }),
    'partner agreement'
  )
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  const confirm = await screen.findByRole('alertdialog', {
    name: 'Confirm partner level change',
  })
  expect(confirm).toHaveTextContent('partner-42 (#42)')
  expect(confirm).toHaveTextContent('Lv.3')
  expect(put).not.toHaveBeenCalled()
  await user.click(within(confirm).getByRole('button', { name: 'Confirm' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/api/campus/admin/members/42/tier', {
      level: 3,
      reason: 'partner agreement',
      revision: 7,
      config_revision: 2,
    })
  )
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Manage partner' })
    ).not.toBeInTheDocument()
  )
})

it('restoring automatic previews the earned level and submits zero', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  renderDialog({ override: 3, effective: { level: 3, rate_percent: 40 } })
  const user = userEvent.setup()
  await user.selectOptions(
    await screen.findByRole('combobox', { name: 'Partner level' }),
    '0'
  )
  expect(screen.getByText(/Effective after saving/)).toHaveTextContent('Lv.1')
  await user.type(
    screen.getByRole('textbox', { name: 'Reason' }),
    'restore earned level'
  )
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'Confirm',
    })
  )
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ level: 0 })
    )
  )
})

it('unenrolled users see an explanation without an editable level', async () => {
  renderDialog({ joined: false })
  expect(
    await screen.findByText('This user has not joined the partner program')
  ).toBeVisible()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
})

it('a rejected save preserves the form and does not report success or close', async () => {
  vi.spyOn(api, 'put').mockResolvedValue({
    data: {
      success: false,
      message: 'The record has changed; refresh and try again',
    },
  })
  const { close } = renderDialog()
  const user = userEvent.setup()
  await user.selectOptions(
    await screen.findByRole('combobox', { name: 'Partner level' }),
    '3'
  )
  await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'agreement')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'Confirm',
    })
  )
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  )
  expect(screen.getByRole('textbox', { name: 'Reason' })).toHaveValue(
    'agreement'
  )
  expect(close).not.toHaveBeenCalled()
})

it('administrators without campus write permission do not see the assignment action', async () => {
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'readonly',
    role: 10,
    permissions: {
      admin_permissions: { campus_partner: { read: true, write: false } },
    },
  })
  renderDialog({}, true)
  await userEvent.click(screen.getByRole('button', { name: 'Open menu' }))
  expect(
    screen.queryByRole('menuitem', { name: 'Manage partner' })
  ).not.toBeInTheDocument()
})

it('a failed load shows retry and no editor until the retry succeeds', async () => {
  const { get } = renderDialog({}, false, true)
  const retry = await screen.findByRole('button', { name: /retry/i })
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  get.mockResolvedValue({ data: { success: true, data } })
  await userEvent.click(retry)
  expect(
    await screen.findByRole('combobox', { name: 'Partner level' })
  ).toBeVisible()
})

it('pending confirmation prevents duplicate saves and dismissal until the request completes', async () => {
  let finish!: () => void
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  const put = vi.spyOn(api, 'put').mockImplementation(async () => {
    await pending
    return { data: { success: true } }
  })
  const { close } = renderDialog()
  const user = userEvent.setup()
  await user.selectOptions(
    await screen.findByRole('combobox', { name: 'Partner level' }),
    '2'
  )
  await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'agreement')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  const confirm = within(await screen.findByRole('alertdialog')).getByRole(
    'button',
    { name: 'Confirm' }
  )
  await user.click(confirm)
  expect(confirm).toBeDisabled()
  await user.keyboard('{Escape}')
  expect(close).not.toHaveBeenCalled()
  expect(put).toHaveBeenCalledTimes(1)
  await act(async () => {
    finish()
    await pending
  })
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1))
})

it.each([
  ['zhCN', zhCN, '管理合伙人', '合伙人等级', '自动等级'],
  ['zhTW', zhTW, '管理合夥人', '合夥人等級', '自動等級'],
] as const)(
  'the %s user menu and level editor use the real Chinese translation resources',
  async (language, resource, title, field, automatic) => {
    const translations = createInstance()
    await translations.init({
      lng: language,
      fallbackLng: false,
      nsSeparator: false,
      resources: { [language]: resource, en },
    })
    useAuthStore
      .getState()
      .auth.setUser({ id: 1, username: 'admin', role: 100 })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    clients.push(client)
    vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data } })
    render(
      <I18nextProvider i18n={translations}>
        <QueryClientProvider client={client}>
          <UsersProvider>
            <DataTableRowActions row={{ original: target } as Row<User>} />
          </UsersProvider>
        </QueryClientProvider>
      </I18nextProvider>
    )
    await userEvent.click(
      screen.getByRole('button', { name: translations.t('Open menu') })
    )
    await userEvent.click(await screen.findByRole('menuitem', { name: title }))
    expect(await screen.findByRole('dialog', { name: title })).toBeVisible()
    expect(await screen.findByRole('combobox', { name: field })).toBeVisible()
    expect(screen.getByRole('option', { name: automatic })).toBeInTheDocument()
    expect(
      screen.queryByText(
        'Assigned levels remain fixed until changed or restored to automatic. Only future settlements are affected; actual performance, historical commissions and subscription rates stay unchanged.'
      )
    ).not.toBeInTheDocument()
  }
)
