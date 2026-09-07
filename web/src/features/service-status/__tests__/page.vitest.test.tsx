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
import { StrictMode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { ServiceStatusPage } from '../index'
import type { ServiceStatusResponse } from '../types'

const i18n = createInstance()
await i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
})
const originalAdapter = api.defaults.adapter
const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  api.defaults.adapter = originalAdapter
  clients.splice(0).forEach((client) => client.clear())
  useAuthStore.getState().auth.reset()
})
function fixture(): ServiceStatusResponse {
  const metrics = {
    cache_hit_rate: 84.29,
    success_rate: 98,
    avg_ttft_ms: 340,
    avg_latency_ms: 2000,
    avg_tps: 25,
  }
  return {
    success: true,
    enabled: true,
    data: {
      start_ts: 3600,
      end_ts: 12600,
      bucket_seconds: 3600,
      groups: [
        {
          group: 'default',
          models: [
            {
              model_name: 'alpha',
              ...metrics,
              series: [
                { ts: 3600, ...metrics, success_rate: 0 },
                { ts: 10800, ...metrics, success_rate: 100 },
              ],
            },
            {
              model_name: 'no-traffic',
              success_rate: null,
              avg_ttft_ms: null,
              avg_latency_ms: null,
              avg_tps: null,
              series: [],
            },
          ],
        },
      ],
    },
  }
}
function renderPage(strictMode = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  const page = (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <ServiceStatusPage />
      </QueryClientProvider>
    </I18nextProvider>
  )
  return render(strictMode ? <StrictMode>{page}</StrictMode> : page)
}
function respond(data: () => ServiceStatusResponse, hours: number[] = []) {
  api.defaults.adapter = async (config) => {
    expect(config.url).toBe('/api/service-status')
    hours.push(config.params.hours)
    return { data: data(), status: 200, statusText: 'OK', headers: {}, config }
  }
}
describe('Service status page', () => {
  it.each([false, true])(
    'shows image duration instead of token metrics when requests are absent: %s',
    async (empty) => {
      const response = fixture()
      const model = response.data.groups[0].models[0]
      Object.assign(model, {
        model_name: 'gpt-image-2',
        is_image_model: true,
        success_rate: empty ? null : 100,
        avg_ttft_ms: null,
        avg_tps: empty ? null : 21.2,
        avg_latency_ms: empty ? null : 52400,
        cache_hit_rate: empty ? null : 0,
        series: empty ? [] : [{ ...model.series[1], avg_latency_ms: 42000 }],
      })
      respond(() => response)
      renderPage()
      const article = await screen.findByRole('article', {
        name: 'gpt-image-2',
      })
      expect(within(article).getByText('Average duration')).toBeTruthy()
      expect(within(article).getByText('Success rate')).toBeTruthy()
      expect(within(article).queryByText('TTFT')).toBeNull()
      expect(within(article).queryByText('Throughput (short)')).toBeNull()
      expect(within(article).queryByText('Cache rate')).toBeNull()
      if (empty) {
        expect(within(article).getAllByText('—')).toHaveLength(2)
      } else {
        expect(within(article).getByText('52.40s')).toBeTruthy()
        await userEvent.click(within(article).getByRole('button'))
        const tooltip = await screen.findByRole('tooltip')
        expect(
          within(tooltip).getByText('Average duration: 42.00s')
        ).toBeTruthy()
        expect(within(tooltip).queryByText(/TTFT|Cache rate/)).toBeNull()
      }
    }
  )
  it('starts the loaded content with groups without an introductory or update row', async () => {
    respond(fixture)
    renderPage()
    const group = await screen.findByRole('region', { name: 'default' })
    expect(screen.queryByText('Model request performance by group')).toBeNull()
    expect(screen.queryByText(/Updated at/)).toBeNull()
    expect(group.parentElement?.firstElementChild).toBe(group)
  })
  it('keeps time controls without a management shortcut even for administrators', async () => {
    useAuthStore
      .getState()
      .auth.setUser({ id: 1, username: 'test', role: ROLE.SUPER_ADMIN })
    respond(fixture)
    renderPage()
    await screen.findByRole('article', { name: 'alpha' })
    expect(screen.queryByRole('button', { name: 'Manage display' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Manage display' })).toBeNull()
    expect(screen.getAllByRole('tab')).toHaveLength(3)
  })
  it('shows the group description before the subdued group name', async () => {
    const response = fixture()
    Object.assign(response.data.groups[0], { description: 'OpenAI official' })
    respond(() => response)
    renderPage()
    const heading = await screen.findByRole('heading', {
      name: 'OpenAI official default',
    })
    expect(
      within(heading)
        .getByText('default')
        .classList.contains('text-neutral-500')
    ).toBe(true)
  })
  it('falls back to the group name when its description is blank', async () => {
    const response = fixture()
    Object.assign(response.data.groups[0], { description: '  ' })
    respond(() => response)
    renderPage()
    const heading = await screen.findByRole('heading', { name: 'default' })
    expect(heading.textContent?.trim()).toBe('default')
  })
  it('loads on the first visit under StrictMode without requiring a retry', async () => {
    respond(fixture)
    renderPage(true)
    await screen.findByRole('region', { name: 'default' })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })
  it('loads grouped model statistics and requests the selected period', async () => {
    const hours: number[] = []
    respond(fixture, hours)
    renderPage()
    expect(
      screen.getByRole('status', { name: 'Loading service status' })
    ).toBeTruthy()
    const group = await screen.findByRole('region', { name: 'default' })
    expect(within(group).getAllByRole('article').length).toBe(2)
    expect(within(group).getByText('98.00%')).toBeTruthy()
    expect(
      within(screen.getByRole('article', { name: 'no-traffic' })).getAllByText(
        '—'
      ).length
    ).toBe(4)
    await userEvent.click(screen.getByRole('tab', { name: 'Last 3 days' }))
    await waitFor(() => expect(hours).toEqual([24, 72]))
    expect(
      screen
        .getByRole('tab', { name: 'Last 3 days' })
        .getAttribute('aria-selected')
    ).toBe('true')
    await userEvent.click(screen.getByRole('tab', { name: 'Last week' }))
    await waitFor(() => expect(hours).toEqual([24, 72, 168]))
  })
  it('shows the period cache rate and the selected interval rate independently', async () => {
    const response = fixture()
    response.data.groups[0].models[0].series[1].cache_hit_rate = 50
    respond(() => response)
    renderPage()
    const article = await screen.findByRole('article', { name: 'alpha' })
    expect(within(article).getByText('Cache rate')).toBeTruthy()
    expect(within(article).getByText('84.29%')).toBeTruthy()
    await userEvent.click(within(article).getByRole('button'))
    const tooltip = await screen.findByRole('tooltip')
    expect(within(tooltip).getByText('Cache rate: 50.00%')).toBeTruthy()
  })
  it.each([0, null, undefined])(
    'distinguishes a cache rate of %s from missing usage',
    async (rate) => {
      const response = fixture()
      const model = response.data.groups[0].models[0]
      model.cache_hit_rate = rate
      model.series[1].cache_hit_rate = rate
      respond(() => response)
      renderPage()
      const article = await screen.findByRole('article', { name: 'alpha' })
      const metric = within(article).getByText('Cache rate').parentElement
      if (!metric) {
        throw new Error('Missing cache metric')
      }
      expect(within(metric).getByText(rate === 0 ? '0.00%' : '—')).toBeTruthy()
      await userEvent.click(within(article).getByRole('button'))
      const tooltip = await screen.findByRole('tooltip')
      expect(
        within(tooltip).getByText(
          rate === 0 ? 'Cache rate: 0.00%' : 'Cache rate: —'
        )
      ).toBeTruthy()
    }
  )
  it('labels the timeline with the selected relative range and keeps exact dates available', async () => {
    respond(fixture)
    renderPage()
    const article = await screen.findByRole('article', { name: 'alpha' })
    expect(
      within(article).getByText('24h ago').getAttribute('title')
    ).toBeTruthy()
    expect(
      within(article).getByText('Now').getAttribute('datetime')
    ).toBeTruthy()
    await userEvent.click(screen.getByRole('tab', { name: 'Last 3 days' }))
    await waitFor(() =>
      expect(
        within(screen.getByRole('article', { name: 'alpha' })).getByText(
          '3d ago'
        )
      ).toBeTruthy()
    )
    await userEvent.click(screen.getByRole('tab', { name: 'Last week' }))
    await waitFor(() =>
      expect(
        within(screen.getByRole('article', { name: 'alpha' })).getByText(
          '7d ago'
        )
      ).toBeTruthy()
    )
  })
  it('keeps compact metric pairs together', async () => {
    respond(fixture)
    renderPage()
    const article = await screen.findByRole('article', { name: 'alpha' })
    const ttft = within(article).getByText('TTFT')
    expect(ttft.getAttribute('title')).toBeNull()
    expect(within(article).getByText('0.34s')).toBeTruthy()
    expect(within(article).getByText('25.0 tok/s')).toBeTruthy()
    for (const term of within(article).getAllByRole('term')) {
      expect(term.parentElement?.classList.contains('whitespace-nowrap')).toBe(
        true
      )
    }
  })
  it('lets keyboard users inspect a missing interval and a total failure', async () => {
    respond(fixture)
    renderPage()
    const history = await screen.findByRole('button', {
      name: 'Request history for alpha. Use arrow keys to select an interval.',
    })
    history.focus()
    fireEvent.keyDown(history, { key: 'ArrowLeft' })
    await screen.findByText('No requests in this interval')
    const tooltip = screen.getByRole('tooltip')
    expect(history.getAttribute('aria-describedby')).toBe(tooltip.id)
    fireEvent.keyDown(history, { key: 'ArrowLeft' })
    await screen.findByText('Success rate: 0.00%')
    fireEvent.keyDown(history, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByText('Success rate: 0.00%')).toBeNull()
    )
  })
  it('selects the tapped interval on touch devices without needing a pointer move', async () => {
    respond(fixture)
    renderPage()
    const history = await screen.findByRole('button', {
      name: 'Request history for alpha. Use arrow keys to select an interval.',
    })
    // Compact bars must retain a 44px touch target on coarse pointers.
    expect(history.classList.contains('pointer-coarse:min-h-11')).toBe(true)
    vi.spyOn(history, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 300, 44)
    )
    fireEvent.pointerDown(history, { pointerType: 'touch', clientX: 25 })
    fireEvent.click(history)
    expect(await screen.findByText('Success rate: 0.00%')).toBeTruthy()
  })
  it('moves the tooltip from the left interval to the right interval with the pointer', async () => {
    respond(fixture)
    renderPage()
    const history = await screen.findByRole('button', {
      name: 'Request history for alpha. Use arrow keys to select an interval.',
    })
    vi.spyOn(history, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(100, 200, 300, 24)
    )
    const bars = history.querySelectorAll('span[aria-hidden] > span')
    bars.forEach((bar, index) => {
      vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(100 + index * 100, 204, 98, 16)
      )
    })
    fireEvent.pointerMove(history, { clientX: 125, pointerType: 'mouse' })
    await screen.findByText('Success rate: 0.00%')
    const positioner = screen.getByRole('tooltip').parentElement
    if (!positioner) throw new Error('Missing tooltip positioner')
    await waitFor(() =>
      expect(positioner.style.transform).toContain('translate(')
    )
    const leftPosition = positioner.style.transform
    fireEvent.pointerMove(history, { clientX: 375, pointerType: 'mouse' })
    await screen.findByText('Success rate: 100.00%')
    await waitFor(() =>
      expect(positioner.style.transform).not.toBe(leftPosition)
    )
  })
  it('uses the compact TTFT label inside the tooltip', async () => {
    respond(fixture)
    renderPage()
    const history = await screen.findByRole('button', {
      name: 'Request history for alpha. Use arrow keys to select an interval.',
    })
    await userEvent.click(history)
    const tooltip = await screen.findByRole('tooltip')
    expect(within(tooltip).getByText('TTFT: 340ms')).toBeTruthy()
    expect(within(tooltip).queryByText(/Average TTFT/)).toBeNull()
  })
  it('shows a recoverable error and reloads after retry', async () => {
    let fail = true
    respond(() => ({ ...fixture(), success: !fail }))
    renderPage()
    await screen.findByRole('alert')
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByRole('region', { name: 'default' })
    expect(screen.queryByRole('alert')).toBeNull()
  })
  it('wraps long model names while keeping their complete accessible name', async () => {
    const name = 'long-model-name-'.repeat(30)
    const response = fixture()
    response.data.groups[0].models[0].model_name = name
    respond(() => response)
    renderPage()
    const article = await screen.findByRole('article', { name })
    expect(within(article).getByRole('heading', { name })).toBeTruthy()
    expect(
      within(article).getByText(name).classList.contains('break-all')
    ).toBe(true)
    expect(article.classList.contains('min-w-0')).toBe(true)
  })
  it('explains an empty result when collection is disabled', async () => {
    respond(() => ({
      success: true,
      enabled: false,
      data: { ...fixture().data, groups: [] },
    }))
    renderPage()
    await screen.findByText(
      'No model performance data is available for your groups yet.'
    )
    expect(
      screen.getByText(
        'Performance collection is disabled. Historical data may still be shown.'
      )
    ).toBeTruthy()
    expect(screen.queryByRole('article')).toBeNull()
  })
})
