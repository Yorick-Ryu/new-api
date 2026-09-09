import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosRequestConfig } from 'axios'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import type { ApiKey } from '@/features/keys/types'
import { api } from '@/lib/api'

import { DesktopSetupDialog } from '../desktop-setup-dialog'

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
const originalAdapter = api.defaults.adapter
const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  api.defaults.adapter = originalAdapter
  vi.unstubAllEnvs()
})

function requests(
  options: {
    models?: string[]
    creationFails?: boolean
    keyFails?: boolean
    modelsFail?: boolean
    keys?: Partial<ApiKey>[]
    keysFail?: boolean
    keyPages?: Partial<ApiKey>[][]
  } = {}
) {
  const storedKeys: Partial<ApiKey>[] = [...(options.keys ?? [])]
  const calls: AxiosRequestConfig[] = []
  const launch = vi
    .spyOn(window.location, 'assign')
    .mockImplementation(() => {})
  api.defaults.adapter = async (config) => {
    calls.push(config)
    let data: unknown
    if (config.url === '/api/user/models') {
      expect(config.params).toEqual({
        group: 'default',
        client_version: 'codexbei',
      })
      data = options.modelsFail
        ? { success: false }
        : {
            models: (
              options.models ?? ['gpt-6-astra', 'gpt-5.6-terra', 'gpt-5.6-sol']
            ).map((slug) => ({
              slug,
              visibility: slug.startsWith('codex-auto-') ? 'hide' : 'list',
              supported_in_api: true,
            })),
          }
    } else if (config.url?.startsWith('/api/token/?')) {
      const page = Number(
        new URL(config.url, 'http://localhost').searchParams.get('p')
      )
      const items = options.keyPages
        ? (options.keyPages[page - 1] ?? [])
        : storedKeys
      data = {
        success: !options.keysFail,
        data: {
          items,
          total: options.keyPages
            ? options.keyPages.flat().length
            : storedKeys.length,
          page,
          page_size: 100,
        },
      }
    } else if (config.url === '/api/token/') {
      data = { success: !options.creationFails, data: { id: 42 } }
      if (!options.creationFails) {
        storedKeys.push({
          id: 42,
          status: 1,
          group: 'default',
          expired_time: -1,
          unlimited_quota: true,
          model_limits_enabled: false,
        })
      }
    } else if (/^\/api\/token\/\d+\/key$/.test(config.url ?? '')) {
      data = {
        success: !options.keyFails,
        data: { key: 'fixture-not-a-real-credential' },
      }
    } else throw new Error('Unexpected request')
    return { config, status: 200, statusText: 'OK', headers: {}, data }
  }
  return { calls, launch }
}

function renderDialog(
  downloads: { label: string; url: string }[] | undefined = undefined,
  showDownloads = false,
  baseUrl = 'https://api.beiapi.cn/v1'
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  const onConfirmed = vi.fn()
  const content = (open: boolean) => (
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <DesktopSetupDialog
          open={open}
          onOpenChange={() => {}}
          onConfirmed={onConfirmed}
          userId={7}
          hasCredits
          downloads={downloads}
          showDownloads={showDownloads}
          baseUrl={baseUrl}
        />
      </I18nextProvider>
    </QueryClientProvider>
  )
  const view = render(content(true))
  return { onConfirmed, close: () => view.rerender(content(false)) }
}

it('opens without a key, loads only default group models and prefers the recommended available model', async () => {
  const { calls } = requests()
  renderDialog()
  await waitFor(() =>
    expect(
      (screen.getByRole('combobox', { name: 'Model' }) as HTMLButtonElement)
        .disabled
    ).toBe(false)
  )
  expect(screen.getByRole('combobox', { name: 'Model' }).textContent).toBe(
    'gpt-6-astra'
  )
  expect(screen.getByRole('combobox', { name: 'Agent' }).textContent).toContain(
    'ChatGPT'
  )
  expect(
    screen
      .getByRole('combobox', { name: 'Agent' })
      .querySelector('svg[aria-hidden="true"]')
  ).not.toBeNull()
  await userEvent.click(screen.getByRole('combobox', { name: 'Agent' }))
  expect(
    (await screen.findByRole('option', { name: /Claude Code/ })).getAttribute(
      'aria-disabled'
    )
  ).toBe('true')
  await userEvent.keyboard('{Escape}')
  expect(calls.every((call) => call.method === 'get')).toBe(true)
  expect(screen.queryByRole('button', { name: 'Create API Key' })).toBeNull()
})

it('creates a default group key only on confirmation and passes the selected model and preset with the connection', async () => {
  const { calls, launch } = requests()
  renderDialog([], false, 'https://gateway.example.com/api/v1')
  await waitFor(() =>
    expect(
      (screen.getByRole('combobox', { name: 'Model' }) as HTMLButtonElement)
        .disabled
    ).toBe(false)
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('combobox', { name: 'Model' }))
  await user.click(await screen.findByRole('option', { name: 'gpt-5.6-terra' }))
  await user.click(screen.getByRole('button', { name: 'One-click setup' }))
  await waitFor(() => expect(launch).toHaveBeenCalledOnce())
  const created = calls.find((call) => call.url === '/api/token/')
  expect(JSON.parse(String(created?.data))).toMatchObject({
    name: 'CodexBei · ChatGPT',
    group: 'default',
    unlimited_quota: true,
    cross_group_retry: false,
  })
  const link = new URL(String(launch.mock.calls[0][0]))
  expect(link.protocol).toBe('codexbei:')
  expect(Object.fromEntries(link.searchParams)).toEqual({
    base_url: 'https://gateway.example.com/api/v1',
    api_key: 'sk-fixture-not-a-real-credential',
    model: 'gpt-5.6-terra',
    preset: 'codexbei-v1',
  })
  expect(document.body.textContent).not.toContain(
    'fixture-not-a-real-credential'
  )
  expect(document.querySelector('a[href*="api_key="]')).toBeNull()
})

it('retries key retrieval using the already created token', async () => {
  const options = { keyFails: true }
  const { calls, launch } = requests(options)
  renderDialog()
  await waitFor(() =>
    expect(
      (screen.getByRole('combobox', { name: 'Model' }) as HTMLButtonElement)
        .disabled
    ).toBe(false)
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'One-click setup' }))
  await screen.findByRole('alert')
  options.keyFails = false
  await user.click(screen.getByRole('button', { name: 'One-click setup' }))
  await waitFor(() => expect(launch).toHaveBeenCalledOnce())
  expect(calls.filter((call) => call.url === '/api/token/')).toHaveLength(1)
})

it('does not fetch a key or launch when creation fails', async () => {
  const { calls, launch } = requests({ creationFails: true })
  renderDialog()
  await waitFor(() =>
    expect(
      (screen.getByRole('combobox', { name: 'Model' }) as HTMLButtonElement)
        .disabled
    ).toBe(false)
  )
  await userEvent.click(screen.getByRole('button', { name: 'One-click setup' }))
  expect((await screen.findByRole('alert')).textContent).toBe(
    'Setup failed. Please retry.'
  )
  expect(calls.some((call) => call.url?.endsWith('/key'))).toBe(false)
  expect(launch).not.toHaveBeenCalled()
})

it('does not offer a fabricated model when the group has no available models', async () => {
  const { calls } = requests({ models: [] })
  renderDialog()
  await screen.findByText('No models available')
  expect(
    (
      screen.getByRole('button', {
        name: 'One-click setup',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
  expect(calls.every((call) => call.method === 'get')).toBe(true)
})

it('allows a failed model list to be reloaded before enabling setup', async () => {
  const options = { modelsFail: true, models: ['gpt-5.6-terra'] }
  requests(options)
  renderDialog()
  await screen.findByRole('alert')
  expect(
    (
      screen.getByRole('button', {
        name: 'One-click setup',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
  options.modelsFail = false
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() =>
    expect(
      (screen.getByRole('combobox', { name: 'Model' }) as HTMLButtonElement)
        .disabled
    ).toBe(false)
  )
  expect(screen.getByRole('combobox', { name: 'Model' }).textContent).toBe(
    'gpt-5.6-terra'
  )
})

it('does not launch after the user closes the dialog while credentials are loading', async () => {
  const { launch } = requests()
  const adapter = api.defaults.adapter
  let release: (() => void) | undefined
  let keyRequested = false
  api.defaults.adapter = async (config) => {
    if (config.url?.endsWith('/key')) {
      keyRequested = true
      await new Promise<void>((resolve) => {
        release = resolve
      })
    }
    if (typeof adapter !== 'function') throw new Error('Missing test adapter')
    return adapter(config)
  }
  const view = renderDialog()
  await waitFor(() =>
    expect(
      (screen.getByRole('combobox', { name: 'Model' }) as HTMLButtonElement)
        .disabled
    ).toBe(false)
  )
  await userEvent.click(screen.getByRole('button', { name: 'One-click setup' }))
  await waitFor(() => expect(keyRequested).toBe(true))
  view.close()
  release?.()
  await waitFor(() => expect(clients[0].isMutating()).toBe(0))
  expect(launch).not.toHaveBeenCalled()
})

it('marks completion only after the user confirms finishing in the app', async () => {
  requests()
  const { onConfirmed } = renderDialog([
    { label: 'Windows x64', url: 'https://example.com/CodexBei.exe' },
  ])
  await waitFor(() =>
    expect(
      (screen.getByRole('combobox', { name: 'Model' }) as HTMLButtonElement)
        .disabled
    ).toBe(false)
  )
  expect(
    screen.queryByRole('button', {
      name: 'I have finished setup on this device',
    })
  ).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'One-click setup' }))
  await screen.findByRole('status')
  expect(onConfirmed).not.toHaveBeenCalled()
  const button = screen.getByRole('button', {
    name: 'I have finished setup on this device',
  })
  button.focus()
  await userEvent.keyboard('{Enter}')
  expect(onConfirmed).toHaveBeenCalledOnce()
  expect(
    screen.queryByRole('link', { name: 'Windows x64', hidden: true })
  ).toBeNull()
  expect(screen.queryByText('Download CodexBei')).toBeNull()
})

it('opens download links immediately from the download step without creating a key', async () => {
  const { calls } = requests()
  renderDialog(
    [{ label: 'Windows x64', url: 'https://example.com/CodexBei.exe' }],
    true
  )
  await screen.findByRole('link', { name: 'Windows x64' })
  expect(
    screen.getByRole('link', { name: 'Windows x64' }).getAttribute('href')
  ).toBe('https://example.com/CodexBei.exe')
  expect(screen.queryByRole('combobox')).toBeNull()
  expect(screen.queryByRole('button', { name: 'One-click setup' })).toBeNull()
  expect(calls).toHaveLength(0)
})

it('offers all published CodexBei installers when download URLs are not configured', async () => {
  for (const name of [
    'VITE_SETUP_WINDOWS_X64_URL',
    'VITE_SETUP_WINDOWS_ARM64_URL',
    'VITE_SETUP_MAC_ARM64_URL',
    'VITE_SETUP_MAC_X64_URL',
  ]) {
    vi.stubEnv(name, '')
  }
  const { calls } = requests()
  renderDialog(undefined, true)
  const expected = [
    ['Windows x64', 'CodexBei_0.1.0_x64-setup.exe'],
    ['Windows ARM64', 'CodexBei_0.1.0_arm64-setup.exe'],
    ['macOS Apple Silicon', 'CodexBei_0.1.0_aarch64.dmg'],
    ['macOS Intel', 'CodexBei_0.1.0_x64.dmg'],
  ]
  for (const [label, file] of expected) {
    const link = screen.getByRole('link', { name: label })
    expect(link.getAttribute('href')).toBe(
      `https://codexbei.beiapi.cn/downloads/0.1.0/${file}`
    )
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  }
  expect(screen.queryByText('Installers are not published yet.')).toBeNull()
  expect(calls).toHaveLength(0)
})

it('uses a configured HTTPS installer URL and excludes unsafe overrides', () => {
  vi.stubEnv(
    'VITE_SETUP_WINDOWS_X64_URL',
    'https://downloads.example.com/setup.exe'
  )
  vi.stubEnv('VITE_SETUP_MAC_X64_URL', 'http://downloads.example.com/setup.dmg')
  requests()
  renderDialog(undefined, true)
  expect(
    screen.getByRole('link', { name: 'Windows x64' }).getAttribute('href')
  ).toBe('https://downloads.example.com/setup.exe')
  expect(screen.queryByRole('link', { name: 'macOS Intel' })).toBeNull()
})

it('preserves the dedicated Codex catalog order and hides automatic models', async () => {
  requests({
    models: [
      'gpt-6-astra',
      'codex-auto-hidden',
      'gpt-5.6-terra',
      'gpt-5.6-sol',
    ],
  })
  renderDialog()
  await waitFor(() =>
    expect(
      (screen.getByRole('combobox', { name: 'Model' }) as HTMLButtonElement)
        .disabled
    ).toBe(false)
  )
  const select = screen.getByRole('combobox', {
    name: 'Model',
  })
  await userEvent.click(select)
  expect(
    (await screen.findAllByRole('option')).map((option) => option.textContent)
  ).toEqual(['gpt-6-astra', 'gpt-5.6-terra', 'gpt-5.6-sol'])
})

it.each([
  '',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://[::1]:3000',
  'http://api.example.com',
  'http://localhost.example.com',
  'http://192.168.1.2',
])(
  'rejects missing or HTTP gateway %s before creating a key',
  async (baseUrl) => {
    const { calls, launch } = requests()
    renderDialog([], false, baseUrl)
    await waitFor(() =>
      expect(
        (screen.getByRole('combobox', { name: 'Model' }) as HTMLButtonElement)
          .disabled
      ).toBe(false)
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'One-click setup' })
    )
    expect((await screen.findByRole('alert')).textContent).toBe(
      'HTTPS gateway address is not configured.'
    )
    expect(calls.every((call) => call.method === 'get')).toBe(true)
    expect(launch).not.toHaveBeenCalled()
  }
)

it('embeds accessible agent and model selectors in the Chinese sentence', async () => {
  const { default: zh } = await import('@/i18n/locales/zh.json')
  i18n.addResourceBundle('zh', 'translation', zh.translation)
  await i18n.changeLanguage('zh')
  try {
    requests()
    renderDialog()
    await waitFor(() =>
      expect(
        (screen.getByRole('combobox', { name: '模型' }) as HTMLButtonElement)
          .disabled
      ).toBe(false)
    )
    const sentence = screen.getByRole('group', {
      name: '选择要在 CodexBei 中配置的 Agent 和模型。',
    })
    expect(sentence.textContent).toContain('我想在')
    expect(sentence.textContent).toContain('中使用')
    expect(screen.queryByText('Agent')).toBeNull()
    expect(screen.queryByText('模型')).toBeNull()
    const agent = screen.getByRole('combobox', { name: 'Agent' })
    const model = screen.getByRole('combobox', { name: '模型' })
    agent.focus()
    await userEvent.tab()
    expect(document.activeElement).toBe(model)
    await userEvent.click(model)
    await userEvent.click(
      await screen.findByRole('option', { name: 'gpt-5.6-terra' })
    )
    expect(screen.getByRole('combobox', { name: '模型' }).textContent).toBe(
      'gpt-5.6-terra'
    )
  } finally {
    await i18n.changeLanguage('en')
  }
})

it('reuses an enabled unexpired default group key that allows the selected model', async () => {
  const { calls, launch } = requests({
    keys: [
      {
        id: 17,
        status: 1,
        group: 'default',
        expired_time: Math.floor(Date.now() / 1000) + 3600,
        unlimited_quota: false,
        remain_quota: 50,
        model_limits_enabled: true,
        model_limits: 'gpt-6-astra,gpt-5.6-sol',
      },
    ],
  })
  renderDialog()
  await waitFor(() =>
    expect(
      (screen.getByRole('combobox', { name: 'Model' }) as HTMLButtonElement)
        .disabled
    ).toBe(false)
  )
  await userEvent.click(screen.getByRole('button', { name: 'One-click setup' }))
  await waitFor(() => expect(launch).toHaveBeenCalledOnce())
  expect(calls.some((call) => call.url === '/api/token/17/key')).toBe(true)
  expect(calls.some((call) => call.url === '/api/token/')).toBe(false)
})

it('checks subsequent pages and skips keys that cannot be used by the desktop', async () => {
  const eligible = {
    status: 1,
    group: 'default',
    expired_time: -1,
    unlimited_quota: true,
    model_limits_enabled: false,
  }
  const { calls, launch } = requests({
    keyPages: [
      [
        { id: 1, ...eligible, status: 2 },
        { id: 2, ...eligible, expired_time: 1 },
        { id: 3, ...eligible, unlimited_quota: false, remain_quota: 0 },
        { id: 4, ...eligible, group: 'auto' },
        { id: 5, ...eligible, allow_ips: '127.0.0.1' },
        {
          id: 6,
          ...eligible,
          model_limits_enabled: true,
          model_limits: 'gpt-5.6-sol',
        },
      ],
      [{ id: 18, ...eligible }],
    ],
  })
  renderDialog()
  await waitFor(() =>
    expect(
      (screen.getByRole('combobox', { name: 'Model' }) as HTMLButtonElement)
        .disabled
    ).toBe(false)
  )
  await userEvent.click(screen.getByRole('button', { name: 'One-click setup' }))
  await waitFor(() => expect(launch).toHaveBeenCalledOnce())
  expect(calls.some((call) => call.url === '/api/token/18/key')).toBe(true)
  expect(calls.some((call) => call.url === '/api/token/')).toBe(false)
})

it('does not create a key when checking existing keys fails', async () => {
  const { calls, launch } = requests({ keysFail: true })
  renderDialog()
  await waitFor(() =>
    expect(
      (screen.getByRole('combobox', { name: 'Model' }) as HTMLButtonElement)
        .disabled
    ).toBe(false)
  )
  await userEvent.click(screen.getByRole('button', { name: 'One-click setup' }))
  await screen.findByRole('alert')
  expect(calls.some((call) => call.url === '/api/token/')).toBe(false)
  expect(launch).not.toHaveBeenCalled()
})

it('rechecks model restrictions after changing the selected model', async () => {
  const { calls, launch } = requests({
    keys: [
      {
        id: 19,
        status: 1,
        group: 'default',
        expired_time: -1,
        unlimited_quota: true,
        model_limits_enabled: true,
        model_limits: 'gpt-6-astra',
      },
    ],
  })
  renderDialog()
  await waitFor(() =>
    expect(
      (screen.getByRole('combobox', { name: 'Model' }) as HTMLButtonElement)
        .disabled
    ).toBe(false)
  )
  await userEvent.click(screen.getByRole('button', { name: 'One-click setup' }))
  await waitFor(() => expect(launch).toHaveBeenCalledOnce())
  await userEvent.click(screen.getByRole('combobox', { name: 'Model' }))
  await userEvent.click(
    await screen.findByRole('option', { name: 'gpt-5.6-terra' })
  )
  await userEvent.click(screen.getByRole('button', { name: 'One-click setup' }))
  await waitFor(() => expect(launch).toHaveBeenCalledTimes(2))
  expect(calls.filter((call) => call.url === '/api/token/')).toHaveLength(1)
  expect(calls.some((call) => call.url === '/api/token/42/key')).toBe(true)
})

it('opens a themed model menu with keyboard selection and explains automatic key preparation', async () => {
  requests()
  renderDialog()
  await waitFor(() =>
    expect(
      screen.getByRole('combobox', { name: 'Model' }).textContent
    ).toContain('gpt-6-astra')
  )
  const model = screen.getByRole('combobox', { name: 'Model' })
  expect(model.tagName).toBe('BUTTON')
  expect(
    screen.getByText(
      'An API key is configured for your selection and created automatically if no suitable key is available.'
    )
  ).toBeTruthy()
  model.focus()
  await userEvent.keyboard('{ArrowDown}')
  expect(await screen.findByRole('listbox')).toBeTruthy()
  expect(model.getAttribute('aria-expanded')).toBe('true')
  await userEvent.keyboard('{End}{Enter}')
  await waitFor(() =>
    expect(
      screen.getByRole('combobox', { name: 'Model' }).textContent
    ).toContain('gpt-5.6-sol')
  )
  expect(
    screen
      .getByRole('combobox', { name: 'Model' })
      .getAttribute('aria-expanded')
  ).toBe('false')
  expect(document.activeElement).toBe(
    screen.getByRole('combobox', { name: 'Model' })
  )
})

it('keeps mobile menus outside the scrolling dialog and supports long model names', async () => {
  const matchMedia = window.matchMedia.bind(window)
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => {
    const media = matchMedia(query)
    Object.defineProperty(media, 'matches', {
      value: query === '(max-width: 640px)',
      configurable: true,
    })
    return media
  })
  const longModel =
    'model-with-a-very-long-name-for-responsive-layout-verification-2026'
  requests({ models: ['gpt-6-astra', longModel] })
  renderDialog()
  const trigger = screen.getByRole('combobox', { name: 'Model' })
  await waitFor(() =>
    expect((trigger as HTMLButtonElement).disabled).toBe(false)
  )
  await userEvent.click(trigger)
  const menu = await screen.findByRole('listbox')
  expect(menu.closest('[role="dialog"]')).toBeNull()
  await userEvent.click(screen.getByRole('option', { name: longModel }))
  expect(screen.getByRole('combobox', { name: 'Model' }).textContent).toBe(
    longModel
  )
  expect(screen.getByRole('combobox', { name: 'Model' }).title).toBe(longModel)
})

it('lays out the setup sentence directly without an extra card or inset padding', async () => {
  requests()
  renderDialog()
  const row = screen.getByRole('group', {
    name: 'Choose an agent and model for CodexBei.',
  })
  expect(row.classList.contains('flex-wrap')).toBe(true)
  expect(
    [...row.classList].filter((name) =>
      /^(?:.*:)?(?:bg-|border(?:-|$)|rounded-|p[xytrbl]?-)/.test(name)
    )
  ).toEqual([])
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Model' }).textContent).toBe(
      'gpt-6-astra'
    )
  )
})

it('uses matching compact spacing for both selectors and their menu rows', async () => {
  requests()
  renderDialog()
  const model = screen.getByRole('combobox', { name: 'Model' })
  await waitFor(() => expect((model as HTMLButtonElement).disabled).toBe(false))
  for (const name of ['Agent', 'Model']) {
    const trigger = screen.getByRole('combobox', { name })
    expect(trigger.classList.contains('data-[size=default]:h-9')).toBe(true)
    expect(trigger.classList.contains('px-2.5')).toBe(true)
    expect(trigger.classList.contains('py-1.5')).toBe(true)
    await userEvent.click(trigger)
    const options = await screen.findAllByRole('option')
    for (const option of options) {
      expect(option.classList.contains('min-h-8')).toBe(true)
      expect(option.classList.contains('pl-2.5')).toBe(true)
    }
    await userEvent.keyboard('{Escape}')
  }
})

it('emphasizes Apple Silicon and Windows x64 while showing other architectures directly in a compact row', () => {
  requests()
  renderDialog(undefined, true)
  const otherArchitectures = screen.getByRole('group', {
    name: 'Other architectures',
  })
  expect(
    within(otherArchitectures).getByText('Other architectures:')
  ).toBeTruthy()
  expect(otherArchitectures.classList.contains('flex-wrap')).toBe(true)
  expect(
    otherArchitectures.querySelector('details, summary, button')
  ).toBeNull()
  for (const label of ['macOS Apple Silicon', 'Windows x64']) {
    const link = screen.getByRole('link', { name: label })
    expect(link.textContent).toBe('Download')
    expect(otherArchitectures.contains(link)).toBe(false)
  }
  for (const label of ['macOS Intel', 'Windows ARM64']) {
    const link = within(otherArchitectures).getByRole('link', { name: label })
    expect(link.getAttribute('href')).toMatch(/^https:/)
  }
})

it('shows the unpublished message when no installer is available', () => {
  requests()
  renderDialog([], true)
  expect(screen.getByText('Installers are not published yet.')).toBeTruthy()
  expect(screen.queryByRole('link')).toBeNull()
  expect(screen.queryByText('Other architectures')).toBeNull()
})

it('uses matching typography and equal vertical gaps for setup guidance and the launch status', async () => {
  requests()
  renderDialog()
  await waitFor(() =>
    expect(
      (
        screen.getByRole('button', {
          name: 'One-click setup',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  )
  await userEvent.click(screen.getByRole('button', { name: 'One-click setup' }))
  const status = await screen.findByRole('status')
  const guidance = screen.getByText(
    'An API key is configured for your selection and created automatically if no suitable key is available.'
  )
  for (const text of [guidance, status]) {
    for (const style of [
      'text-xs',
      'text-muted-foreground',
      'leading-relaxed',
    ]) {
      expect(text.classList.contains(style)).toBe(true)
    }
  }
  // Both hints participate in the same grid so their top and bottom gaps match.
  expect(status.parentElement).toBe(guidance.parentElement)
  expect(status.parentElement?.classList.contains('gap-5')).toBe(true)
})
