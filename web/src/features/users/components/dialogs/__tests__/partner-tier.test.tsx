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
import { UserPartnerTierDrawer } from '../user-partner-tier-drawer'

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
        <UserPartnerTierDrawer open user={target} onClose={close} />
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

it('user row action opens the selected account and assigns a minimum level with confirmation and no reason field', async () => {
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
  const select = await screen.findByRole('combobox', {
    name: 'Partner level',
  })
  expect(get).toHaveBeenCalledWith('/api/campus/admin/members/42/tier')
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  await user.click(select)
  await user.click(await screen.findByRole('option', { name: /^Lv\.3/ }))
  expect(
    screen.queryByRole('textbox', { name: 'Reason' })
  ).not.toBeInTheDocument()
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
      enroll: false,
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
  await user.click(
    await screen.findByRole('combobox', { name: 'Partner level' })
  )
  await user.click(
    await screen.findByRole('option', { name: /^Automatic level/ })
  )
  expect(
    screen.getByRole('combobox', { name: 'Partner level' })
  ).toHaveTextContent('Lv.1')
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

it.each([0, 3])(
  'an administrator can activate an unenrolled user with level %s after explicit confirmation',
  async (level) => {
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true } })
    const { close } = renderDialog({ joined: false, revision: 0 })
    const user = userEvent.setup()
    const select = await screen.findByRole('combobox', {
      name: 'Partner level',
    })
    await user.click(select)
    await user.click(
      await screen.findByRole('option', {
        name: level === 0 ? /^Automatic level/ : /^Lv\.3/,
      })
    )
    expect(
      screen.queryByRole('textbox', { name: 'Reason' })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Activate partner' }))
    const confirm = await screen.findByRole('alertdialog', {
      name: 'Confirm partner activation',
    })
    expect(confirm).toHaveTextContent('partner-42 (#42)')
    expect(confirm).toHaveTextContent('Not joined')
    expect(confirm).not.toHaveTextContent('%')
    expect(confirm).not.toHaveTextContent('Minimum partner level')
    expect(put).not.toHaveBeenCalled()
    await user.click(within(confirm).getByRole('button', { name: 'Confirm' }))
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/api/campus/admin/members/42/tier', {
        level,
        enroll: true,
        revision: 0,
        config_revision: 2,
      })
    )
    await waitFor(() => expect(close).toHaveBeenCalledTimes(1))
  }
)

it('a rejected save preserves the form and does not report success or close', async () => {
  vi.spyOn(api, 'put').mockResolvedValue({
    data: {
      success: false,
      message: 'The record has changed; refresh and try again',
    },
  })
  const { close } = renderDialog()
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('combobox', { name: 'Partner level' })
  )
  await user.click(await screen.findByRole('option', { name: /^Lv\.3/ }))
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  await user.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'Confirm',
    })
  )
  await waitFor(() =>
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  )
  expect(
    screen.getByRole('combobox', { name: 'Partner level' })
  ).toHaveTextContent('Lv.3')
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
  await user.click(
    await screen.findByRole('combobox', { name: 'Partner level' })
  )
  await user.click(await screen.findByRole('option', { name: /^Lv\.2/ }))
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
  ['zhCN', zhCN, '管理合伙人', '合伙人等级', '自动等级', true, '开通合伙人'],
  ['zhTW', zhTW, '管理合夥人', '合夥人等級', '自動等級', true, '開通合夥人'],
  ['zhCN', zhCN, '管理合伙人', '合伙人等级', '自动等级', false, '开通合伙人'],
  ['zhTW', zhTW, '管理合夥人', '合夥人等級', '自動等級', false, '開通合夥人'],
] as const)(
  'the %s user menu and level editor use the real Chinese translation resources',
  async (language, resource, title, field, automatic, joined, activate) => {
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
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: { ...data, joined } },
    })
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
    expect(
      screen.getByRole('heading', {
        name: language === 'zhCN' ? '合伙人信息' : '合夥人資訊',
      })
    ).toBeVisible()
    expect(
      screen.getByRole('heading', {
        name: language === 'zhCN' ? '等级调整' : '等級調整',
      })
    ).toBeVisible()
    expect(screen.getByRole('combobox', { name: field })).toHaveTextContent(
      automatic
    )
    expect(screen.getByRole('combobox', { name: field })).toHaveTextContent(
      '30%'
    )
    if (!joined) {
      expect(screen.getByRole('button', { name: activate })).toBeEnabled()
    }
    expect(
      screen.queryByText(
        'Assigned levels remain fixed until changed or restored to automatic. Only future settlements are affected; actual performance, historical commissions and subscription rates stay unchanged.'
      )
    ).not.toBeInTheDocument()
  }
)

it('the compact editor keeps level and commission, without explanatory copy or dot separators', async () => {
  renderDialog({ joined: false })
  const select = await screen.findByRole('combobox', {
    name: 'Partner level',
  })
  const dialog = screen.getByRole('dialog', { name: 'Manage partner' })
  expect(dialog).not.toHaveTextContent('·')
  expect(screen.getAllByText(/Not joined/)).toHaveLength(1)
  expect(screen.queryByText(/Effective after saving/)).not.toBeInTheDocument()
  expect(
    screen.queryByText(/Assigned levels remain fixed/)
  ).not.toBeInTheDocument()
  expect(
    screen.queryByText(/Select a level and confirm/)
  ).not.toBeInTheDocument()
  expect(select).toHaveTextContent('Lv.1')
  expect(select).toHaveTextContent('30%')
  const user = userEvent.setup()
  await user.click(select)
  const option = await screen.findByRole('option', { name: /^Lv\.3/ })
  expect(option).toHaveTextContent('40%')
  await user.click(option)
  expect(select).toHaveTextContent('Lv.3')
  expect(select).toHaveTextContent('40%')
})

it('partner management opens on the right with a scrollable body and a separate footer like other user drawers', async () => {
  renderDialog({
    changes: [
      {
        id: 1,
        actor_id: 1,
        previous_level: 1,
        level: 2,
        override: 2,
        reason: '',
        created_at: 1794230000,
      },
    ],
  })
  const select = await screen.findByRole('combobox', {
    name: 'Partner level',
  })
  const drawer = screen.getByRole('dialog', { name: 'Manage partner' })
  expect(drawer).toHaveAttribute('data-slot', 'sheet-content')
  expect(drawer).toHaveAttribute('data-side', 'right')
  expect(drawer).toHaveClass('h-dvh', 'w-full')
  const form = select.closest('form')
  if (!form) throw new Error('Partner selector must belong to a form')
  expect(form).toHaveClass('flex-1', 'overflow-y-auto', 'gap-4')
  const info = within(form).getByRole('region', { name: 'Partner information' })
  const adjustment = within(form).getByRole('region', {
    name: 'Level adjustment',
  })
  expect(within(info).getByText('Current partner level')).toBeVisible()
  expect(
    within(info).getByText('Current partner commission rate')
  ).toBeVisible()
  expect(info).not.toContainElement(select)
  expect(adjustment).toContainElement(select)
  expect(
    within(adjustment).queryByText('Partner level')
  ).not.toBeInTheDocument()
  expect(select).toHaveAccessibleName('Partner level')
  const separator = within(form).getByRole('separator')
  expect(separator.previousElementSibling).toBe(info)
  expect(separator.nextElementSibling).toBe(adjustment)
  expect(
    within(adjustment).queryByText('Current partner level')
  ).not.toBeInTheDocument()
  expect(
    within(form).queryByText('Recent level changes')
  ).not.toBeInTheDocument()
  expect(within(form).queryByText(/Operator/)).not.toBeInTheDocument()
  const save = screen.getByRole('button', { name: 'Save changes' })
  expect(form).not.toContainElement(save)
  expect(save).toHaveAttribute('form', form.id)
  expect(save.closest('[data-slot="sheet-footer"]')).toBeInTheDocument()
})

it.each([false, true])(
  'the current partner summary only shows an active commission rate when joined=%s',
  async (joined) => {
    renderDialog({
      joined,
      override: 3,
      effective: { level: 3, rate_percent: 40 },
    })
    await screen.findByRole('combobox', { name: 'Partner level' })
    const currentLevel = screen.getByText(
      'Current partner level'
    ).nextElementSibling
    expect(currentLevel).toHaveTextContent(joined ? 'Lv.3' : 'Not joined')
    expect(currentLevel).not.toHaveTextContent('%')
    expect(
      screen.queryByText('Friends cumulative top-ups')
    ).not.toBeInTheDocument()
    if (joined) {
      expect(
        screen.getByText('Current partner commission rate').nextElementSibling
      ).toHaveTextContent('40%')
    } else {
      expect(
        screen.queryByText('Current partner commission rate')
      ).not.toBeInTheDocument()
    }
  }
)

it('closing partner management plays the shared exit animation before removal and reopening resets the selection', async () => {
  let finish!: () => void
  const animation = new Promise<void>((resolve) => {
    finish = resolve
  })
  const original = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'getAnimations'
  )
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value(this: HTMLElement) {
      return this.hasAttribute('data-ending-style')
        ? [{ finished: animation }]
        : []
    },
  })
  try {
    useAuthStore
      .getState()
      .auth.setUser({ id: 1, username: 'admin', role: 100 })
    const { get } = renderDialog({}, true)
    expect(get).not.toHaveBeenCalled()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Manage partner' })
    )
    const select = await screen.findByRole('combobox', {
      name: 'Partner level',
    })
    const drawer = screen.getByRole('dialog', { name: 'Manage partner' })
    await user.click(select)
    await user.click(await screen.findByRole('option', { name: /^Lv\.3/ }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(drawer).toHaveAttribute('data-ending-style'))
    expect(drawer).toBeInTheDocument()
    expect(drawer).toHaveAttribute('data-side', 'right')
    await act(async () => {
      finish()
    })
    await waitFor(() => expect(drawer).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Manage partner' })
    )
    expect(
      await screen.findByRole('combobox', { name: 'Partner level' })
    ).toHaveTextContent('Automatic level')
  } finally {
    finish()
    if (original) {
      Object.defineProperty(HTMLElement.prototype, 'getAnimations', original)
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations')
    }
  }
})

it('setting a minimum below earned performance previews the higher effective level', async () => {
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  renderDialog({
    automatic: { level: 3, rate_percent: 40 },
    effective: { level: 3, rate_percent: 40 },
  })
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('combobox', { name: 'Partner level' })
  )
  await user.click(await screen.findByRole('option', { name: /^Lv\.2/ }))
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  const confirm = await screen.findByRole('alertdialog')
  expect(confirm).toHaveTextContent(/→ Lv\.3/)
  expect(confirm).not.toHaveTextContent('%')
  expect(confirm).not.toHaveTextContent('Minimum partner level')
  await user.click(within(confirm).getByRole('button', { name: 'Confirm' }))
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ level: 2 })
    )
  )
})
