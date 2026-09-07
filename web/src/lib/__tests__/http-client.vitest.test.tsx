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
import { act, cleanup, render, screen } from '@testing-library/react'
import { AxiosError } from 'axios'
import { Toaster, toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { api } from '../http-client'

const originalAdapter = api.defaults.adapter

afterEach(() => {
  toast.dismiss()
  cleanup()
  vi.useRealTimers()
  api.defaults.adapter = originalAdapter
})

describe('HTTP request cancellation', () => {
  it('does not reuse an aborted GET for a new caller with its own signal', async () => {
    api.defaults.adapter = async (config) => ({
      data: { success: true },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    })
    const first = new AbortController()
    const second = new AbortController()
    const canceled = api.get('/api/test-cancellation', { signal: first.signal })
    first.abort()
    const current = api.get('/api/test-cancellation', { signal: second.signal })
    const results = await Promise.allSettled([canceled, current])
    expect(results[0]).toMatchObject({
      status: 'rejected',
      reason: { code: 'ERR_CANCELED' },
    })
    expect(results[1]).toMatchObject({
      status: 'fulfilled',
      value: { data: { success: true } },
    })
  })

  it('does not display an error toast when the caller cancels a request', async () => {
    vi.useFakeTimers()
    render(<Toaster />)
    api.defaults.adapter = async (config) => ({
      data: { success: true },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    })
    await act(async () => {
      const controller = new AbortController()
      const request = api.get('/api/test-canceled-toast', {
        signal: controller.signal,
      })
      controller.abort()
      await expect(request).rejects.toMatchObject({ code: 'ERR_CANCELED' })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.queryByText('canceled')).toBeNull()
  })

  it('still displays a genuine server failure', async () => {
    render(<Toaster />)
    api.defaults.adapter = async (config) => {
      throw new AxiosError(
        'Request failed',
        'ERR_BAD_RESPONSE',
        config,
        undefined,
        {
          data: { message: 'Upstream unavailable' },
          status: 503,
          statusText: 'Unavailable',
          headers: {},
          config,
        }
      )
    }
    await act(async () => {
      await expect(api.get('/api/test-server-error')).rejects.toMatchObject({
        response: { status: 503 },
      })
    })
    expect(await screen.findByText('Upstream unavailable')).toBeTruthy()
  })

  it('continues deduplicating concurrent GETs without cancellation ownership and releases completed requests', async () => {
    let requests = 0
    api.defaults.adapter = async (config) => {
      requests += 1
      return {
        data: { success: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }
    const results = await Promise.all([
      api.get('/api/test-deduplication'),
      api.get('/api/test-deduplication'),
    ])
    expect(results.map((result) => result.data.success)).toEqual([true, true])
    expect(requests).toBe(1)
    await api.get('/api/test-deduplication')
    expect(requests).toBe(2)
  })
})
