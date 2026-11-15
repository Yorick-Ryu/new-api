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
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { ThemeProvider } from '@/context/theme-provider'
import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { Home } from '..'

let client: QueryClient
const homeResponse = { success: true, data: '' }

async function renderHome(): Promise<void> {
  const root = createRootRoute()
  const route = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: Home,
  })
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider defaultTheme='light'>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>
  )
  await router.load()
}

beforeEach(async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  localStorage.clear()
  i18next.addResourceBundle('en', 'translation', en.translation, true, true)
  i18next.addResourceBundle('zhCN', 'translation', zh.translation, true, true)
  await i18next.changeLanguage('en')
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(STATUS_QUERY_KEY, {
    system_name: 'BeiAPI',
    version: 'test',
  })
  useSystemConfigStore
    .getState()
    .setConfig({ systemName: 'BeiAPI', footerHtml: '', demoSiteEnabled: false })
  homeResponse.data = ''
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/home_page_content') return { data: { ...homeResponse } }
    return { data: { success: true, data: '' } }
  })
})

afterEach(async () => {
  client.clear()
  localStorage.clear()
  await i18next.changeLanguage('en')
})

describe('configured homepage rendering', () => {
  test('empty content replaces a cached iframe with the native homepage', async () => {
    localStorage.setItem('home_page_content', 'https://old.example/home')
    await renderHome()
    expect(
      await screen.findByRole('heading', { level: 1, name: 'BeiAPI' })
    ).toBeVisible()
    expect(document.querySelector('iframe')).not.toBeInTheDocument()
    expect(localStorage.getItem('home_page_content')).toBeNull()
    expect(screen.getByRole('link', { name: 'New API' })).toHaveAttribute(
      'href',
      'https://github.com/QuantumNous/new-api'
    )
    expect(screen.getByRole('link', { name: 'Get started' })).toHaveAttribute(
      'href',
      '/sign-in'
    )
    expect(document.querySelector('video')).toHaveAttribute('preload', 'none')
    expect(
      screen.queryByRole('img', { name: 'Bei WeChat contact QR codes' })
    ).not.toBeInTheDocument()
  })
  test('homepage credits distinguish BeiAPI content from the underlying New API project', async () => {
    useSystemConfigStore
      .getState()
      .setConfig({ systemName: 'Local test system' })
    await renderHome()
    expect(
      await screen.findByRole('heading', { level: 1, name: 'BeiAPI' })
    ).toBeVisible()
    const footer = document.querySelector('footer') as HTMLElement
    expect(within(footer).getByText(/©.*BEI API/)).toBeVisible()
    expect(within(footer).getByText('Powered by')).toBeVisible()
    expect(
      within(footer).getByText(
        'Frontend design and development by New API contributors.'
      )
    ).toBeVisible()
    expect(
      within(footer).getByRole('link', { name: 'New API' })
    ).toHaveAttribute('href', 'https://github.com/QuantumNous/new-api')
    expect(within(footer).queryByText(/©.*New API/)).not.toBeInTheDocument()
    await act(async () => {
      await i18next.changeLanguage('zhCN')
    })
    expect(
      within(footer).getByText('前端界面由 New API 贡献者设计与开发。')
    ).toBeVisible()
  })
  test('a configured URL keeps the existing sandboxed iframe', async () => {
    homeResponse.data = 'https://agent.example/home'
    await renderHome()
    const frame = await screen.findByTitle('Custom Home Page')
    expect(frame).toHaveAttribute('src', homeResponse.data)
    expect(frame).toHaveAttribute(
      'sandbox',
      'allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts allow-top-navigation-by-user-activation'
    )
    expect(
      screen.queryByRole('heading', { level: 1, name: 'BeiAPI' })
    ).not.toBeInTheDocument()
  })
  test('configured HTML keeps isolated rendering', async () => {
    homeResponse.data = '<h1>Agent custom homepage</h1>'
    await renderHome()
    await waitFor(() => {
      const host = document.querySelector('.custom-home-content')
      expect(host?.shadowRoot?.textContent).toContain('Agent custom homepage')
    })
    expect(document.querySelector('.beiapi-home')).not.toBeInTheDocument()
  })
  test('configured Markdown keeps its native rendering', async () => {
    homeResponse.data = '# Agent custom homepage'
    await renderHome()
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Agent custom homepage',
      })
    ).toBeVisible()
    expect(document.querySelector('.beiapi-home')).not.toBeInTheDocument()
  })
  test('switching the UI language updates native homepage copy', async () => {
    await renderHome()
    expect(
      await screen.findByRole('heading', {
        name: 'Bring ChatGPT and Claude into your everyday research tasks.',
      })
    ).toBeVisible()
    await act(async () => {
      await i18next.changeLanguage('zhCN')
    })
    expect(
      screen.getByRole('heading', {
        name: '把 ChatGPT 和 Claude 接入科研里的每一个高频场景。',
      })
    ).toBeVisible()
  })
  test('support opens on demand, shows QR load failures and closes with Escape', async () => {
    const user = userEvent.setup()
    await renderHome()
    const trigger = await screen.findByRole('button', {
      name: 'After-sales support: scan to contact Bei on WeChat',
    })
    await user.click(trigger)
    const dialog = await screen.findByRole('dialog', {
      name: 'Contact Bei · Consultation and support',
    })
    const image = within(dialog).getByRole('img', {
      name: 'Bei WeChat contact QR codes',
    })
    fireEvent.error(image)
    expect(
      within(dialog).getByText(
        'The WeChat QR codes could not be loaded. Refresh the page to retry.'
      )
    ).toBeVisible()
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    expect(trigger).toHaveFocus()
  })
  test('service information keeps the existing regional restriction and closes by keyboard', async () => {
    const user = userEvent.setup()
    await renderHome()
    const trigger = await screen.findByRole('button', {
      name: 'About the service',
    })
    trigger.focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', {
      name: 'Service scope and usage guidelines',
    })
    expect(
      within(dialog).getByText('only for users outside mainland China')
    ).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Got it' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
  })
})
