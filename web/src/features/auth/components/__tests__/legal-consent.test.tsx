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
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'

import { UserAuthForm } from '../../sign-in/components/user-auth-form'
import { SignUpForm } from '../../sign-up/components/sign-up-form'
import { LegalConsent } from '../legal-consent'
import { TermsFooter } from '../terms-footer'

const status = {
  user_agreement_enabled: true,
  privacy_policy_enabled: true,
  github_oauth: true,
  github_client_id: 'test-client',
  wechat_login: true,
  passkey_login: true,
  linuxdo_oauth: true,
}
const clients: QueryClient[] = []

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('PublicKeyCredential', class {})
})
afterEach(() => {
  clients.forEach((client) => client.clear())
  clients.length = 0
  vi.unstubAllGlobals()
  localStorage.clear()
})

async function renderForm(mode: 'sign-in' | 'sign-up') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  client.setQueryData(STATUS_QUERY_KEY, status)
  const root = createRootRoute({
    component: mode === 'sign-in' ? UserAuthForm : SignUpForm,
  })
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByRole('checkbox')
  return userEvent.setup()
}

it.each(['sign-in', 'sign-up'] as const)(
  'opens a consent dialog before %s, and only agrees after explicit confirmation',
  async (mode) => {
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { success: false, message: 'Test response' } })
    const user = await renderForm(mode)
    const submitName = mode === 'sign-in' ? 'Sign in' : 'Create account'
    await user.click(screen.getByRole('button', { name: submitName }))
    let dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByRole('link', { name: 'User Agreement' })
    ).toHaveAttribute('href', '/user-agreement')
    expect(
      within(dialog).getByRole('link', { name: 'Privacy Policy' })
    ).toHaveAttribute('href', '/privacy-policy')
    expect(post).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: submitName }))
    dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Agree' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(post).not.toHaveBeenCalled()
    await user.type(
      screen.getByLabelText(
        mode === 'sign-in' ? 'Username or Email' : 'Username',
        { exact: true }
      ),
      'researcher'
    )
    await user.type(
      screen.getByLabelText('Password', { exact: true }),
      'ResearchPass!123'
    )
    if (mode === 'sign-up') {
      await user.type(
        screen.getByLabelText('Confirm password', { exact: true }),
        'ResearchPass!123'
      )
    }
    await user.click(screen.getByRole('button', { name: submitName }))
    await waitFor(() => expect(post).toHaveBeenCalled())
  }
)

it.each([
  'Continue with GitHub',
  'Continue with WeChat',
  'Continue with LinuxDO',
  'Sign in with Passkey',
])(
  'opens the consent dialog before %s without starting authentication',
  async (name) => {
    const post = vi
      .spyOn(api, 'post')
      .mockRejectedValue(new Error('No authentication should be started'))
    const user = await renderForm('sign-in')
    const button = screen.getByRole('button', { name: new RegExp(`${name}$`) })
    await waitFor(() => expect(button).toBeEnabled())
    const checkbox = screen.getByRole('checkbox')
    await user.click(button)
    await screen.findByRole('dialog')
    expect(post).not.toHaveBeenCalled()
    expect(checkbox).not.toBeChecked()
  }
)

it('translates consent and both footer variants when switching to Chinese', async () => {
  const i18n = createInstance()
  await i18n
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en, zhCN: zh }, fallbackLng: 'en' })
  const view = render(
    <I18nextProvider i18n={i18n}>
      <LegalConsent
        status={status}
        checked={false}
        onCheckedChange={() => {}}
      />
      <TermsFooter status={status} />
      <TermsFooter status={status} variant='sign-up' />
    </I18nextProvider>
  )
  expect(view.container.textContent).toContain(
    'By clicking sign in, you agree to our'
  )
  await act(() => i18n.changeLanguage('zhCN'))
  expect(view.container.textContent).not.toMatch(/[A-Za-z]/)
  expect(view.container.textContent).toContain('点击登录，即表示您同意')
  expect(view.container.textContent).toContain('创建账号，即表示您同意')
})
