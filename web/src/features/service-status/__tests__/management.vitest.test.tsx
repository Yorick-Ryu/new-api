import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  fireEvent,
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

import { api } from '@/lib/api'

import type { ServiceStatusSettings } from '../lib/settings'
import { ServiceStatusManagementPage } from '../manage'

const i18n = createInstance()
await i18n.init({
  lng: 'en',
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
})
const adapter = api.defaults.adapter
const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  api.defaults.adapter = adapter
  clients.splice(0).forEach((client) => client.clear())
})
function fixture(): ServiceStatusSettings {
  return {
    groups: [
      {
        group: 'default',
        description: 'GPT',
        hidden: false,
        models: [
          { model: 'gpt-6', hidden: false },
          { model: 'gpt-5', hidden: false },
        ],
      },
      {
        group: 'premium',
        description: 'Premium',
        hidden: false,
        models: [{ model: 'gpt-6', hidden: false }],
      },
    ],
  }
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <ServiceStatusManagementPage />
      </QueryClientProvider>
    </I18nextProvider>
  )
}
function respond(data: unknown) {
  return { data, status: 200, statusText: 'OK', headers: {} }
}

it('saves group order, model order and visibility independently per group', async () => {
  let saved: ServiceStatusSettings | undefined
  api.defaults.adapter = async (config) => {
    if (config.method === 'put') saved = JSON.parse(config.data as string)
    return {
      ...respond(
        config.method === 'put'
          ? { success: true }
          : { success: true, data: fixture() }
      ),
      config,
    }
  }
  mount()
  const user = userEvent.setup()
  await screen.findByRole('switch', { name: 'Show group: default' })
  await user.click(screen.getByRole('button', { name: 'Move up: premium' }))
  expect(
    screen.getAllByRole('region').map((node) => node.getAttribute('aria-label'))
  ).toEqual(['premium', 'default'])
  await user.click(
    within(screen.getByRole('region', { name: 'default' })).getByText(
      'Models (2)'
    )
  )
  await user.click(
    screen.getByRole('button', { name: 'Move up: default / gpt-5' })
  )
  await user.click(
    screen.getByRole('switch', { name: 'Show model: default / gpt-6' })
  )
  await user.click(screen.getByRole('switch', { name: 'Show group: premium' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(saved?.groups[0].group).toBe('premium'))
  expect(saved?.groups[0].hidden).toBe(true)
  expect(saved?.groups[0].models).toEqual([{ model: 'gpt-6', hidden: false }])
  expect(saved?.groups[1].models).toEqual([
    { model: 'gpt-5', hidden: false },
    { model: 'gpt-6', hidden: true },
  ])
  expect(saved?.groups[0]).not.toHaveProperty('description')
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')
    ).toBe(true)
  )
})

it('reset discards unsaved toggles and order, with boundary moves disabled', async () => {
  api.defaults.adapter = async (config) => ({
    ...respond({ success: true, data: fixture() }),
    config,
  })
  mount()
  const user = userEvent.setup()
  await screen.findByRole('switch', { name: 'Show group: default' })
  expect(
    screen
      .getByRole('button', { name: 'Move up: default' })
      .hasAttribute('disabled')
  ).toBe(true)
  expect(
    screen
      .getByRole('button', { name: 'Move down: premium' })
      .hasAttribute('disabled')
  ).toBe(true)
  await user.click(screen.getByRole('switch', { name: 'Show group: default' }))
  await user.click(screen.getByRole('button', { name: 'Move up: premium' }))
  await user.click(screen.getByRole('button', { name: 'Reset' }))
  expect(screen.getAllByRole('region')[0].getAttribute('aria-label')).toBe(
    'default'
  )
  expect(
    screen
      .getByRole('switch', { name: 'Show group: default' })
      .getAttribute('aria-checked')
  ).toBe('true')
})

it('keeps edits after save failure and allows retry', async () => {
  let fail = true
  api.defaults.adapter = async (config) => ({
    ...respond(
      config.method === 'put'
        ? { success: !fail, message: 'Save failed' }
        : { success: true, data: fixture() }
    ),
    config,
  })
  mount()
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('switch', { name: 'Show group: default' })
  )
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByRole('alert')
  expect(
    screen
      .getByRole('switch', { name: 'Show group: default' })
      .getAttribute('aria-checked')
  ).toBe('false')
  fail = false
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
})

it('offers retry after loading failure and recovers to the editor', async () => {
  let fail = true
  api.defaults.adapter = async (config) => ({
    ...respond({ success: !fail, data: fixture() }),
    config,
  })
  mount()
  await screen.findByRole('alert')
  fail = false
  await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByRole('switch', { name: 'Show group: default' })
  expect(screen.queryByRole('alert')).toBeNull()
})

it('shows an empty state when no groups are available', async () => {
  api.defaults.adapter = async (config) => ({
    ...respond({ success: true, data: { groups: [] } }),
    config,
  })
  mount()
  await screen.findByText('No groups available yet.')
  expect(
    screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')
  ).toBe(true)
})

it('places save and reset above the editor in the settings header', async () => {
  api.defaults.adapter = async (config) => ({
    ...respond({ success: true, data: fixture() }),
    config,
  })
  mount()
  const save = await screen.findByRole('button', { name: 'Save' })
  const reset = screen.getByRole('button', { name: 'Reset' })
  const group = screen.getByRole('region', { name: 'default' })
  const list = screen.getByLabelText('Group display order')
  expect(list.classList.contains('h-full')).toBe(true)
  expect(list.parentElement?.classList.contains('flex-1')).toBe(true)
  expect(save.closest('form')).toBeNull()
  expect(reset.closest('form')).toBeNull()
  expect(
    save.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING
  ).not.toBe(0)
})

it('reorders groups and models from drag handles with keyboard focus preserved', async () => {
  api.defaults.adapter = async (config) => ({
    ...respond({ success: true, data: fixture() }),
    config,
  })
  mount()
  const user = userEvent.setup()
  const groupHandle = await screen.findByRole('button', {
    name: 'Drag premium to reorder',
  })
  groupHandle.focus()
  await user.keyboard('{ArrowUp}')
  expect(screen.getAllByRole('region')[0].getAttribute('aria-label')).toBe(
    'premium'
  )
  expect(document.activeElement).toBe(groupHandle)
  await user.keyboard('{ArrowUp}')
  expect(screen.getAllByRole('region')[0].getAttribute('aria-label')).toBe(
    'premium'
  )
  await user.click(
    within(screen.getByRole('region', { name: 'default' })).getByText(
      'Models (2)'
    )
  )
  const modelHandle = screen.getByRole('button', {
    name: 'Drag default / gpt-5 to reorder',
  })
  modelHandle.focus()
  await user.keyboard('{ArrowUp}')
  const models = within(
    screen.getByRole('list', { name: 'Model display order: default' })
  ).getAllByRole('listitem')
  expect(within(models[0]).getByText('gpt-5')).toBeTruthy()
  expect(document.activeElement).toBe(modelHandle)
  expect(screen.getAllByRole('region')[0].getAttribute('aria-label')).toBe(
    'premium'
  )
})

it.each(['group', 'model'] as const)(
  'moves a %s by dragging its handle without changing the other level',
  async (kind) => {
    // Supply browser page coordinates, which Happy DOM leaves at zero.
    class BrowserPointerEvent extends MouseEvent {
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init)
        Object.defineProperties(this, {
          pageX: { value: init.clientX ?? 0, configurable: true },
          pageY: { value: init.clientY ?? 0, configurable: true },
          pointerType: {
            value: init.pointerType ?? 'mouse',
            configurable: true,
          },
          isPrimary: { value: true, configurable: true },
        })
      }
    }
    vi.stubGlobal('PointerEvent', BrowserPointerEvent)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: Element) {
        if (kind === 'model' && this.tagName === 'LI') {
          const index = [...(this.parentElement?.children ?? [])].indexOf(this)
          return new DOMRect(0, index * 100, 600, 80)
        }
        if (this.tagName === 'SECTION' && this.hasAttribute('aria-label')) {
          const index = [
            ...document.querySelectorAll('section[aria-label]'),
          ].indexOf(this)
          return new DOMRect(0, index * 100, 600, 80)
        }
        return new DOMRect(0, 0, 600, 400)
      }
    )
    api.defaults.adapter = async (config) => ({
      ...respond({ success: true, data: fixture() }),
      config,
    })
    mount()
    await screen.findByRole('region', { name: 'default' })
    if (kind === 'model') {
      await userEvent
        .setup()
        .click(
          within(screen.getByRole('region', { name: 'default' })).getByText(
            'Models (2)'
          )
        )
    }
    const handle = screen.getByRole('button', {
      name:
        kind === 'group'
          ? 'Drag premium to reorder'
          : 'Drag default / gpt-5 to reorder',
    })
    await act(async () => {
      await new Promise(requestAnimationFrame)
    })
    fireEvent.pointerDown(handle, {
      clientX: 16,
      clientY: 140,
      buttons: 1,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    })
    fireEvent.pointerMove(window, {
      clientX: 16,
      clientY: 120,
      buttons: 1,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    })
    await act(async () => {
      await new Promise(requestAnimationFrame)
    })
    fireEvent.pointerMove(window, {
      clientX: 16,
      clientY: 10,
      buttons: 1,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    })
    await act(async () => {
      await new Promise(requestAnimationFrame)
    })
    await waitFor(() => {
      if (kind === 'group') {
        expect(
          screen.getAllByRole('region')[0].getAttribute('aria-label')
        ).toBe('premium')
      } else {
        const list = screen.getByRole('list', {
          name: 'Model display order: default',
        })
        expect(
          within(within(list).getAllByRole('listitem')[0]).getByText('gpt-5')
        ).toBeTruthy()
        expect(
          screen.getAllByRole('region')[0].getAttribute('aria-label')
        ).toBe('default')
      }
    })
    fireEvent.pointerUp(window, {
      clientX: 16,
      clientY: 10,
      buttons: 0,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    })
  }
)

it('uses standard settings text and keeps group descriptions and names on one line', async () => {
  api.defaults.adapter = async (config) => ({
    ...respond({ success: true, data: fixture() }),
    config,
  })
  mount()
  await screen.findByRole('region', { name: 'default' })
  const description = screen.getByText(/Drag groups and models or use/)
  expect(description.textContent).toContain(
    'New groups and models are shown by default.'
  )
  expect(description.classList.contains('text-sm')).toBe(true)
  expect(description.classList.contains('text-muted-foreground')).toBe(true)
  const heading = screen.getByRole('heading', { name: 'GPT default' })
  expect(heading.classList.contains('flex')).toBe(true)
  expect(heading.classList.contains('flex-col')).toBe(false)
  const header = heading.parentElement?.parentElement
  expect(header?.classList.contains('py-2')).toBe(true)
  await userEvent
    .setup()
    .click(
      within(screen.getByRole('region', { name: 'default' })).getByText(
        'Models (2)'
      )
    )
  const model = within(
    screen.getByRole('region', { name: 'default' })
  ).getByText('gpt-6')
  expect(model.classList.contains('text-sm')).toBe(true)
  expect(model.closest('li')?.classList.contains('py-1.5')).toBe(true)
})
