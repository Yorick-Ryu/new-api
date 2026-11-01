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
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosResponse } from 'axios'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, expect, test, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import fr from '@/i18n/locales/fr.json'
import ja from '@/i18n/locales/ja.json'
import ru from '@/i18n/locales/ru.json'
import viLocale from '@/i18n/locales/vi.json'
import zhTW from '@/i18n/locales/zh-TW.json'
import zhCN from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'

import { InvitationField } from '../forms'

function renderInvitation(registration = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <InvitationField registration={registration} />
    </QueryClientProvider>
  )
}
afterEach(() => {
  sessionStorage.clear()
  window.history.replaceState({}, '', '/')
  vi.restoreAllMocks()
})

test('changing a valid invitation never shows the previous inviter or enables binding while verification is pending', async () => {
  const first = 'ABC012'
  const next = 'Z9Y8X7'
  let resolveNext!: (value: AxiosResponse) => void
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (String(url).endsWith(first)) {
      return {
        data: { success: true, data: { inviter: 'Alice*' } },
      } as AxiosResponse
    }
    return new Promise<AxiosResponse>((resolve) => {
      resolveNext = resolve
    })
  })
  const user = userEvent.setup()
  renderInvitation()
  const code = screen.getByRole('textbox', {
    name: 'Campus invitation code (optional)',
  })
  expect(code).toHaveAttribute('maxlength', '6')
  await user.type(code, first.toLowerCase())
  expect(code).toHaveValue(first)
  expect(await screen.findByText('Invited by Alice*')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Bind invitation' })).toBeEnabled()
  await user.clear(code)
  await user.type(code, next)
  expect(screen.queryByText('Invited by Alice*')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Bind invitation' })).toBeDisabled()
  expect(screen.getByText('Checking invitation...')).toBeVisible()
  await act(async () =>
    resolveNext({
      data: { success: true, data: { inviter: 'Bob*' } },
    } as AxiosResponse)
  )
  expect(await screen.findByText('Invited by Bob*')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Bind invitation' }))
  expect(
    await screen.findByRole('alertdialog', { name: 'Confirm invitation' })
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})

test('an invalid invitation shows a text error and cannot be bound', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: false, message: 'Invalid invitation' },
  } as AxiosResponse)
  const user = userEvent.setup()
  renderInvitation()
  await user.type(screen.getByRole('textbox'), 'ABC!12')
  expect(get).not.toHaveBeenCalled()
  expect(
    screen.getByText('Enter a 6-character invitation code (A–Z, 0–9).')
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Bind invitation' })).toBeDisabled()
  await user.clear(screen.getByRole('textbox'))
  await user.type(screen.getByRole('textbox'), 'BAD123')
  expect(
    await screen.findByText(
      'Unable to validate this code. Correct it or try again.'
    )
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Bind invitation' })).toBeDisabled()
})

test('an invitation link survives an untouched registration form and clearing it removes the signup intent', async () => {
  const code = 'K7MN2R'
  window.history.replaceState({}, '', `/?campus=${code.toLowerCase()}`)
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { inviter: 'Friend*' } },
  } as AxiosResponse)
  const user = userEvent.setup()
  renderInvitation(true)
  expect(screen.getByRole('textbox')).toHaveValue(code)
  expect(sessionStorage.getItem('campus-invitation')).toBe(code)
  await user.clear(screen.getByRole('textbox'))
  expect(sessionStorage.getItem('campus-invitation')).toBe('')
  expect(
    screen.queryByRole('button', { name: 'Bind invitation' })
  ).not.toBeInTheDocument()
})

test('the registration invitation renders Chinese from the actual locale resource and responds to language changes', async () => {
  const instance = createInstance()
  await instance.use(initReactI18next).init({
    lng: 'zhCN',
    fallbackLng: 'en',
    resources: { en, zhCN, zhTW, fr, ru, ja, vi: viLocale },
    interpolation: { escapeValue: false },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <I18nextProvider i18n={instance}>
      <QueryClientProvider client={client}>
        <InvitationField registration />
      </QueryClientProvider>
    </I18nextProvider>
  )
  expect(
    screen.getByRole('textbox', { name: '校园合伙人邀请码（选填）' })
  ).toBeVisible()
  expect(
    screen.getByText('成功绑定邀请后，获得一张仅限本人使用的 95 折充值券。')
  ).toBeVisible()
  await act(async () => {
    await instance.changeLanguage('zhTW')
  })
  expect(
    screen.getByRole('textbox', { name: '校園合夥人邀請碼（選填）' })
  ).toBeVisible()
  await act(async () => {
    await instance.changeLanguage('en')
  })
  expect(
    screen.getByRole('textbox', { name: 'Campus invitation code (optional)' })
  ).toBeVisible()
})

test.each(Object.entries({ zhCN, zhTW, fr, ru, ja, vi: viLocale }))(
  'the %s resource translates each invitation state inside the loaded namespace',
  async (language, resource) => {
    expect(Object.keys(resource)).toEqual(['translation'])
    const instance = createInstance()
    await instance.init({
      lng: language,
      fallbackLng: false,
      resources: { [language]: resource },
    })
    for (const key of [
      'Campus invitation code (optional)',
      'Get a personal 5% off top-up coupon when you bind an invitation.',
      'Checking invitation...',
      'Enter a 6-character invitation code (A–Z, 0–9).',
      'Unable to validate this code. Correct it or try again.',
      'Bind invitation',
      'Confirm invitation',
      'Campus Partner',
      'Campus coupon available',
      'This invitation cannot be bound to your account',
      'View campus partner finances',
      'Campaign configuration updated',
      'First verified settlement',
      'Enable campaign',
      'Disable campaign',
      'Enable campaign?',
      'Disable campaign?',
      'Campaign status changes are saved automatically.',
      'Enabling shows the campaign to users and starts new participation and commission accrual.',
      'Disabling hides the campaign and stops new participation and commission accrual. Existing balances, withdrawals and issued coupons are preserved.',
      'Save plan settings',
      'Plan settings saved',
      'Campaign enabled',
      'Campaign disabled',
      'Refund registration',
      'Top-up commission tiers',
      'Save commission tiers',
      'Subscription commissions',
      'Save subscription commissions',
      'Tier {{level}} commission (%)',
      'Subscription plan {{number}}',
    ]) {
      expect(instance.exists(key), key).toBe(true)
      expect(instance.t(key), key).not.toBe(key)
    }
    const inviter = instance.t('Invited by {{name}}', { name: 'Friend*' })
    expect(inviter).toContain('Friend*')
    expect(inviter).not.toBe('Invited by Friend*')
  }
)
