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
import i18next from 'i18next'
import { afterEach, beforeEach, expect, test } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'
import { DEFAULT_LOGO } from '@/lib/constants'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { ResearchHub } from '../components/research-hub'

let client: QueryClient

beforeEach(async () => {
  i18next.addResourceBundle('en', 'translation', en.translation, true, true)
  i18next.addResourceBundle('zhCN', 'translation', zh.translation, true, true)
  await i18next.changeLanguage('en')
  useSystemConfigStore
    .getState()
    .setConfig({ systemName: '', logo: DEFAULT_LOGO })
  client = new QueryClient()
})

afterEach(async () => {
  client.clear()
  useSystemConfigStore
    .getState()
    .setConfig({ systemName: '', logo: DEFAULT_LOGO })
  await i18next.changeLanguage('en')
})

function renderHub() {
  return render(
    <QueryClientProvider client={client}>
      <ResearchHub />
    </QueryClientProvider>
  )
}

test('selecting another research task moves the selection and selecting it again clears it', async () => {
  const user = userEvent.setup()
  renderHub()
  const writing = screen.getByRole('button', { name: /Academic writing/ })
  const code = screen.getByRole('button', { name: /Code experiments/ })
  await user.click(writing)
  expect(writing).toHaveAttribute('aria-pressed', 'true')
  await user.click(code)
  expect(writing).toHaveAttribute('aria-pressed', 'false')
  expect(code).toHaveAttribute('aria-pressed', 'true')
  await user.click(code)
  expect(code).toHaveAttribute('aria-pressed', 'false')
})

test('keyboard users can focus a task and toggle its selection', async () => {
  const user = userEvent.setup()
  renderHub()
  await user.tab()
  const tools = screen.getByRole('button', { name: /ChatGPT \/ Claude/ })
  expect(tools).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(tools).toHaveAttribute('aria-pressed', 'true')
  await user.keyboard(' ')
  expect(tools).toHaveAttribute('aria-pressed', 'false')
})

test('language changes update the research tasks and default site name without losing selection', async () => {
  const user = userEvent.setup()
  renderHub()
  await user.click(screen.getByRole('button', { name: /Academic writing/ }))
  expect(screen.getByText('Bei API')).toBeVisible()
  await act(async () => {
    await i18next.changeLanguage('zhCN')
  })
  expect(screen.getByText('小北科研API')).toBeVisible()
  expect(screen.getByRole('button', { name: /论文写作/ })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
})

test('a configured brand replaces the default glyph and retains the configured name', () => {
  useSystemConfigStore
    .getState()
    .setConfig({ systemName: 'Research Lab', logo: '/lab-logo.svg' })
  const view = renderHub()
  expect(screen.getByText('Research Lab')).toBeVisible()
  expect(view.container.querySelector('img')).toHaveAttribute(
    'src',
    '/lab-logo.svg'
  )
  expect(
    view.container.querySelector('.research-hub-mark')
  ).not.toBeInTheDocument()
})
