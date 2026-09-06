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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { ModelDisplayOrderDialog } from '../dialogs/model-display-order-dialog'
import { ModelDisplayOrderEditor } from '../model-display-order-editor'

const i18n = createInstance()
await i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
})
const originalAdapter = api.defaults.adapter
let clients: QueryClient[] = []
beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  api.defaults.adapter = originalAdapter
  clients.forEach((client) => client.clear())
  clients = []
})

function Editor(props: { names: string[]; disabled?: boolean }) {
  const [names, setNames] = useState(props.names)
  return (
    <I18nextProvider i18n={i18n}>
      <ModelDisplayOrderEditor
        names={names}
        onChange={setNames}
        disabled={props.disabled}
      />
    </I18nextProvider>
  )
}
function renderDialog(onClose = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  const view = render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <ModelDisplayOrderDialog onClose={onClose} />
      </QueryClientProvider>
    </I18nextProvider>
  )
  return { ...view, onClose, client }
}
function order() {
  return within(screen.getByRole('list', { name: 'Model display order' }))
    .getAllByRole('listitem')
    .map((row) => within(row).getByText(/^(alpha|zeta)$/).textContent)
}

describe('Manual model ordering', () => {
  it('moves models with buttons and keeps boundary controls disabled', async () => {
    render(<Editor names={['alpha', 'zeta']} />)
    expect(
      screen
        .getByRole('button', { name: 'Move alpha up' })
        .hasAttribute('disabled')
    ).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Move zeta up' }))
    expect(order()).toEqual(['zeta', 'alpha'])
    expect(
      screen
        .getByRole('button', { name: 'Move alpha down' })
        .hasAttribute('disabled')
    ).toBe(true)
  })
  it('reorders from the keyboard while keeping focus on the same model', async () => {
    render(<Editor names={['alpha', 'zeta']} />)
    const handle = screen.getByRole('button', { name: 'Drag zeta to reorder' })
    handle.focus()
    await userEvent.keyboard('{ArrowUp}')
    expect(order()).toEqual(['zeta', 'alpha'])
    expect(document.activeElement).toBe(handle)
    await userEvent.keyboard('{ArrowUp}')
    expect(order()).toEqual(['zeta', 'alpha'])
  })
  it('shows an empty state and disables reordering for a single model', () => {
    const view = render(<Editor names={[]} />)
    expect(screen.getByText('No models available to reorder')).toBeTruthy()
    view.unmount()
    render(<Editor names={['alpha']} />)
    screen
      .getAllByRole('button')
      .forEach((button) => expect(button.hasAttribute('disabled')).toBe(true))
  })
  it('prevents keyboard and button changes while saving and wraps long model names', async () => {
    const longName = 'model-'.repeat(40)
    render(<Editor names={['alpha', longName]} disabled />)
    expect(screen.getByText(longName).classList.contains('break-all')).toBe(
      true
    )
    const handle = screen.getByRole('button', {
      name: `Drag ${longName} to reorder`,
    })
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(screen.getAllByRole('listitem')[0].textContent).toContain('alpha')
    screen
      .getAllByRole('button')
      .forEach((button) => expect(button.hasAttribute('disabled')).toBe(true))
  })
  it('saves the full order, invalidates marketplace data, and loads the saved order on reopening', async () => {
    let saved = ['alpha', 'zeta']
    const writes: string[][] = []
    api.defaults.adapter = async (config) => {
      if (config.method === 'put') {
        saved = JSON.parse(config.data).model_names
        writes.push(saved)
      }
      return {
        data: { success: true, data: saved },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }
    const view = renderDialog()
    view.client.setQueryData(['pricing'], { data: [] })
    await screen.findByRole('button', { name: 'Move zeta up' })
    expect(
      screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')
    ).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Move zeta up' }))
    expect(writes).toEqual([])
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(view.onClose).toHaveBeenCalledOnce())
    expect(writes).toEqual([['zeta', 'alpha']])
    expect(view.client.getQueryState(['pricing'])?.isInvalidated).toBe(true)
    view.unmount()
    renderDialog()
    await screen.findByRole('button', { name: 'Move zeta up' })
    expect(order()).toEqual(['zeta', 'alpha'])
  })
  it('keeps edits after a failed save and permits retry', async () => {
    let fail = true
    api.defaults.adapter = async (config) => ({
      data:
        config.method === 'put'
          ? { success: !fail }
          : { success: true, data: ['alpha', 'zeta'] },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    })
    const view = renderDialog()
    await screen.findByRole('button', { name: 'Move zeta up' })
    await userEvent.click(screen.getByRole('button', { name: 'Move zeta up' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('alert')
    expect(order()).toEqual(['zeta', 'alpha'])
    expect(view.onClose).not.toHaveBeenCalled()
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(view.onClose).toHaveBeenCalledOnce())
  })
  it('offers retry after loading fails without enabling save', async () => {
    let fail = true
    api.defaults.adapter = async (config) => ({
      data: { success: !fail, data: ['alpha', 'zeta'] },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    })
    renderDialog()
    await screen.findByRole('alert')
    expect(
      screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')
    ).toBe(true)
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('button', { name: 'Move zeta up' })
    expect(order()).toEqual(['alpha', 'zeta'])
  })
  it('discards local edits on cancel without sending a save', async () => {
    const methods: string[] = []
    api.defaults.adapter = async (config) => {
      methods.push(config.method || '')
      return {
        data: { success: true, data: ['alpha', 'zeta'] },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }
    const view = renderDialog()
    await screen.findByRole('button', { name: 'Move zeta up' })
    await userEvent.click(screen.getByRole('button', { name: 'Move zeta up' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(view.onClose).toHaveBeenCalledOnce()
    expect(methods).not.toContain('put')
  })
})
