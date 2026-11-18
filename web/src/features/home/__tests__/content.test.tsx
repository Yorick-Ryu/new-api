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
    system_name: '',
    version: 'test',
  })
  useSystemConfigStore
    .getState()
    .setConfig({ systemName: '', footerHtml: '', demoSiteEnabled: false })
  useSystemConfigStore.getState().setLoading(false)
  homeResponse.data = ''
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/home_page_content') return { data: { ...homeResponse } }
    return { data: { success: true, data: '' } }
  })
})

afterEach(async () => {
  client.clear()
  vi.unstubAllGlobals()
  localStorage.clear()
  await i18next.changeLanguage('en')
})

describe('configured homepage rendering', () => {
  test('empty content replaces a cached iframe with the native homepage', async () => {
    localStorage.setItem('home_page_content', 'https://old.example/home')
    await renderHome()
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Bei API' })
    ).toBeVisible()
    expect(document.querySelector('iframe')).not.toBeInTheDocument()
    expect(localStorage.getItem('home_page_content')).toBeNull()
    expect(
      screen.getByRole('link', {
        name: 'Designed and developed based on New API.',
      })
    ).toHaveAttribute('href', 'https://github.com/QuantumNous/new-api')
    expect(screen.getByRole('link', { name: 'Get started' })).toHaveAttribute(
      'href',
      '/sign-in'
    )
    expect(document.querySelector('video')).toHaveAttribute('preload', 'none')
    expect(
      screen.queryByRole('img', { name: 'Bei WeChat contact QR codes' })
    ).not.toBeInTheDocument()
  })
  test('homepage credits show the Bei API brand and link to the underlying project', async () => {
    await renderHome()
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Bei API' })
    ).toBeVisible()
    const footer = screen.getByRole('contentinfo')
    expect(footer.closest('.beiapi-home')).toBeNull()
    expect(within(footer).getByText(/©.*Bei API/)).toBeVisible()
    expect(
      within(footer).getByText('AI tools and access services · For researchers')
    ).toBeVisible()
    expect(
      within(footer).queryByText('Powerful API Management Platform')
    ).not.toBeInTheDocument()
    expect(
      within(footer).getByRole('link', {
        name: 'Designed and developed based on New API.',
      })
    ).toHaveAttribute('href', 'https://github.com/QuantumNous/new-api')
    await act(async () => {
      await i18next.changeLanguage('zhCN')
    })
    expect(
      within(footer).getByRole('link', { name: '基于 New API 设计与开发' })
    ).toBeVisible()
    expect(within(footer).getByText('小北科研API')).toBeVisible()
    expect(
      within(document.querySelector('header') as HTMLElement).getByText(
        '小北科研API'
      )
    ).toBeVisible()
    await act(async () => {
      await i18next.changeLanguage('en')
    })
    expect(within(footer).getByText('Bei API')).toBeVisible()
    expect(
      within(document.querySelector('header') as HTMLElement).getByText(
        'Bei API'
      )
    ).toBeVisible()
  })
  test.each(['New API', 'Lab Research API', 'Bei API'])(
    'uses configured %s in header, hero and footer across languages',
    async (name) => {
      useSystemConfigStore.getState().setConfig({ systemName: name })
      await renderHome()
      for (const language of ['en', 'zhCN']) {
        await act(async () => {
          await i18next.changeLanguage(language)
        })
        expect(screen.getByRole('heading', { level: 1, name })).toBeVisible()
        expect(
          within(document.querySelector('header') as HTMLElement).getByText(
            name
          )
        ).toBeVisible()
        expect(
          within(document.querySelector('footer') as HTMLElement).getByText(
            name
          )
        ).toBeVisible()
        expect(
          within(document.querySelector('footer') as HTMLElement).getByText(
            new RegExp(`©.*${name}`)
          )
        ).toBeVisible()
      }
    }
  )
  test('open-source attribution keeps the original contributor notice and closes by Escape', async () => {
    const user = userEvent.setup()
    await renderHome()
    const trigger = await screen.findByRole('button', {
      name: 'Open-source attribution',
    })
    await user.click(trigger)
    const dialog = await screen.findByRole('dialog', {
      name: 'Open-source attribution',
    })
    expect(
      within(dialog).getByText(
        'Frontend design and development by New API contributors.'
      )
    ).toBeVisible()
    expect(
      within(dialog).getByText(
        'Underlying software: New API. Copyright QuantumNous and contributors.'
      )
    ).toBeVisible()
    expect(
      within(dialog).getByRole('link', { name: 'GNU AGPLv3' })
    ).toHaveAttribute(
      'href',
      'https://github.com/QuantumNous/new-api/blob/main/LICENSE'
    )
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    )
    expect(trigger).toHaveFocus()
  })
  test('the native homepage omits the removed research-use footer note', async () => {
    await renderHome()
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Bei API' })
    ).toBeVisible()
    expect(
      screen.queryByLabelText('Research use notice')
    ).not.toBeInTheDocument()
  })
  test('floating support stops covering footer controls when the footer is visible', async () => {
    let notify: IntersectionObserverCallback | undefined
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        callback: IntersectionObserverCallback
        constructor(callback: IntersectionObserverCallback) {
          this.callback = callback
        }
        observe(target: Element) {
          if (target.tagName === 'FOOTER') notify = this.callback
        }
        disconnect() {}
      }
    )
    await renderHome()
    const support = await screen.findByRole('button', {
      name: 'After-sales support: scan to contact Bei on WeChat',
    })
    expect(support).toBeVisible()
    await act(async () => {
      notify?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      )
    })
    expect(support).not.toBeVisible()
    await act(async () => {
      notify?.(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver
      )
    })
    expect(support).toBeVisible()
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
      screen.queryByRole('heading', { level: 1, name: 'Bei API' })
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
  test('the Chinese setup guide addresses installation and API configuration questions', async () => {
    await i18next.changeLanguage('zhCN')
    await renderHome()
    const setup = await screen.findByRole('region', {
      name: '想用 ChatGPT 或 Claude，却卡在安装或配置？',
    })
    expect(
      within(setup).getByText(/不知道该下载哪个版本.*API 地址和密钥填在哪/)
    ).toHaveTextContent(/CodexBei 一键配置/)
    expect(
      within(setup).getByRole('heading', {
        name: '无需魔法，一键配置 Codex 或 Claude',
      })
    ).toBeVisible()
  })
  test('the Chinese setup guide lists both apps, one-click setup and connection verification', async () => {
    await i18next.changeLanguage('zhCN')
    await renderHome()
    const topics = await screen.findByLabelText('教程覆盖内容')

    for (const label of [
      'ChatGPT 安装',
      'Claude 安装',
      '一键配置',
      '连通性验证',
    ]) {
      expect(within(topics).getByText(label)).toBeVisible()
    }
  })
  test('support opens on demand, shows QR load failures and closes with Escape', async () => {
    const user = userEvent.setup()
    await renderHome()
    const trigger = await screen.findByRole('button', {
      name: 'After-sales support: scan to contact Bei on WeChat',
    })
    expect(trigger).toHaveTextContent(/^$/)
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
