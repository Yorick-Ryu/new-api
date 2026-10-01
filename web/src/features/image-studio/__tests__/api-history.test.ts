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
import { Blob as NodeBlob } from 'node:buffer'

import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ImageInput, ImageJob } from '../api'

const http = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
}))
vi.mock('@/lib/api', () => ({ api: http }))

const now = 1_800_000_000
const input: ImageInput = {
  model: 'gpt-image-2',
  prompt: 'A bird',
  size: '',
  quality: '',
  n: 1,
}
const job: ImageJob = {
  id: 'job-a',
  request_key: 'request-a',
  status: 'success',
  created_at: now,
  expires_at: now + 86400,
  input,
  assets: [
    {
      id: 'original-a',
      kind: 'original',
      url: 'https://untrusted.invalid/image.png',
    },
    { id: 'thumbnail-a', kind: 'thumbnail', url: '/temporary/thumbnail' },
  ],
}

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:local-image')
      static revokeObjectURL = vi.fn()
    }
  )
  vi.spyOn(Date, 'now').mockReturnValue(now * 1000)
})
afterEach(() => vi.unstubAllGlobals())

async function signedIn() {
  const { useAuthStore } = await import('@/stores/auth-store')
  useAuthStore.getState().auth.setUser({ id: 1, username: 'one', role: 1 })
  const studio = await import('../api')
  return { studio, useAuthStore }
}

function serveGeneration() {
  http.post.mockResolvedValue({ data: { success: true, data: { id: job.id } } })
  http.get.mockImplementation(async (url: string) => {
    if (url === '/api/image-studio/jobs') {
      return {
        data: {
          success: true,
          data: [
            job,
            { ...job, id: 'another-browser-job', request_key: 'another-key' },
          ],
        },
      }
    }
    if (url.startsWith('/api/image-studio/assets/')) {
      return { data: new Blob(['image bytes'], { type: 'image/png' }) }
    }
    throw new Error('Unexpected URL')
  })
}

describe('local image API history', () => {
  it('polls only active tasks or results still awaiting local delivery', async () => {
    const { studio } = await signedIn()
    expect(studio.imageJobsRefetchInterval(await studio.getImageJobs())).toBe(false)
    serveGeneration()
    await studio.createImageJob(input, 'request-a')
    http.get.mockRejectedValue(new Error('Offline'))
    expect(studio.imageJobsRefetchInterval(await studio.getImageJobs())).toBe(3000)
    serveGeneration()
    const deliver = http.get.getMockImplementation()
    if (!deliver) throw new Error('Missing generation response fixture')
    http.get.mockImplementation((url: string) =>
      url.endsWith('/original-a/content')
        ? Promise.reject(new Error('Download interrupted'))
        : deliver(url)
    )
    const pending = await studio.getImageJobs()
    expect(pending[0].status).toBe('success')
    expect(studio.imageJobsRefetchInterval(pending)).toBe(3000)
    serveGeneration()
    expect(studio.imageJobsRefetchInterval(await studio.getImageJobs())).toBe(false)
    for (const status of ['queued', 'running', 'saving']) {
      expect(studio.imageJobsRefetchInterval([{ ...job, status }])).toBe(3000)
    }
    for (const status of ['failed', 'unknown', 'expired']) {
      expect(studio.imageJobsRefetchInterval([{ ...job, status }])).toBe(false)
    }
  })

  it('shows only jobs registered by this browser and downloads through owned asset endpoints', async () => {
    const { studio } = await signedIn()
    serveGeneration()
    expect(await studio.getImageJobs()).toEqual([])
    expect(http.get).not.toHaveBeenCalled()
    await studio.createImageJob(input, 'request-a')
    const jobs = await studio.getImageJobs()
    expect(jobs.map((entry) => entry.id)).toEqual(['job-a'])
    expect(jobs[0].assets).toEqual([
      { id: 'original-a', kind: 'original', url: '' },
      { id: 'thumbnail-a', kind: 'thumbnail', url: 'blob:local-image' },
    ])
    expect(http.get).toHaveBeenCalledWith('/api/image-studio/jobs', {
      params: { ids: 'job-a', request_keys: undefined },
    })
    expect(http.get).toHaveBeenCalledWith(
      '/api/image-studio/assets/original-a/content',
      expect.objectContaining({ responseType: 'blob' })
    )
    expect(
      http.get.mock.calls.some(([url]) =>
        String(url).includes('untrusted.invalid')
      )
    ).toBe(false)
    http.get.mockRejectedValue(new Error('Offline'))
    expect(await studio.getImageURL('original-a')).toBe('blob:local-image')
    expect((await studio.getImageJobs())[0].status).toBe('success')
  })

  it('recovers a lost create response by request key without repeating generation', async () => {
    const { studio } = await signedIn()
    http.post.mockRejectedValue(new Error('Response lost'))
    await expect(studio.createImageJob(input, 'request-a')).rejects.toThrow(
      'Response lost'
    )
    serveGeneration()
    const jobs = await studio.getImageJobs()
    expect(jobs.map((entry) => entry.id)).toEqual(['job-a'])
    expect(http.get).toHaveBeenCalledWith('/api/image-studio/jobs', {
      params: { ids: undefined, request_keys: 'request-a' },
    })
    expect(http.post).toHaveBeenCalledTimes(1)
  })

  it('keeps the prior account response isolated when the user changes while creation is pending', async () => {
    const { studio, useAuthStore } = await signedIn()
    let finish!: (value: unknown) => void
    const sent = new Promise<void>((resolve) => {
      http.post.mockImplementation(() => {
        resolve()
        return new Promise((resolveResponse) => {
          finish = resolveResponse
        })
      })
    })
    const creating = studio.createImageJob(input, 'request-a')
    await sent
    useAuthStore.getState().auth.setUser({ id: 2, username: 'two', role: 1 })
    finish({ data: { success: true, data: { id: 'job-a' } } })
    await expect(creating).rejects.toThrow('Your session has changed')
    expect(await studio.getImageJobs()).toEqual([])
    await expect(studio.getImageURL('original-a')).rejects.toThrow(
      'Image unavailable'
    )
    useAuthStore.getState().auth.setUser({ id: 1, username: 'one', role: 1 })
    serveGeneration()
    expect((await studio.getImageJobs())[0].id).toBe('job-a')
  })

  it('keeps completed images usable with a storage warning when IndexedDB is blocked', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const { studio } = await signedIn()
    serveGeneration()
    await studio.createImageJob(input, 'request-a')
    const jobs = await studio.getImageJobs()
    expect(jobs[0].status).toBe('success')
    expect(jobs[0].storage_error).toBe(true)
    expect(await studio.getImageURL('original-a')).toBe('blob:local-image')
  })

  it('deletes browser history immediately without waiting for an offline server', async () => {
    const { studio } = await signedIn()
    serveGeneration()
    await studio.createImageJob(input, 'request-a')
    await studio.getImageJobs()
    http.delete.mockReturnValue(new Promise(() => undefined))
    await studio.deleteImageJob('job-a')
    expect(await studio.getImageJobs()).toEqual([])
    await expect(studio.getImageURL('original-a')).rejects.toThrow(
      'Image unavailable'
    )
  })

  it('does not expose a late image URL after the workspace has unmounted', async () => {
    const { studio } = await signedIn()
    serveGeneration()
    await studio.createImageJob(input, 'request-a')
    await studio.getImageJobs()
    const getting = studio.getImageURL('original-a')
    studio.releaseImageURLs()
    await expect(getting).rejects.toMatchObject({ name: 'AbortError' })
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('keeps old original images downloadable and reusable as references after the delivery deadline', async () => {
    const { studio } = await signedIn()
    serveGeneration()
    await studio.createImageJob(input, 'request-a')
    await studio.getImageJobs()
    const requests = http.get.mock.calls.length
    vi.spyOn(Date, 'now').mockReturnValue((now + 86400 * 365) * 1000)
    http.get.mockRejectedValue(new Error('Server data expired'))
    expect((await studio.getImageJobs())[0].status).toBe('success')
    expect(await studio.getImageURL('original-a', true)).toBe(
      'blob:local-image'
    )
    http.post.mockResolvedValue({
      data: { success: true, data: { id: 'reference-a' } },
    })
    expect(await studio.cloneImageReference('original-a')).toBe('reference-a')
    expect(http.post).toHaveBeenLastCalledWith(
      '/api/image-studio/references',
      expect.any(FormData)
    )
    expect(http.get).toHaveBeenCalledTimes(requests)
  })

  it('retains partially downloaded jobs and cached images when missing assets can no longer be delivered', async () => {
    const { studio } = await signedIn()
    const { imageHistory } = await import('../lib/local-history')
    const partial: ImageJob = {
      ...job,
      input: { ...input, n: 2 },
      assets: [
        { id: 'job-a-0-original', kind: 'original', url: '' },
        { id: 'job-a-1-original', kind: 'original', url: '' },
      ],
    }
    await imageHistory.saveJob({
      user_id: 1,
      id: job.id,
      expires_at: job.expires_at,
      remote: true,
      cached: false,
      job: partial,
    })
    await imageHistory.saveAsset({
      user_id: 1,
      id: 'job-a-0-original',
      job_id: job.id,
      expires_at: job.expires_at,
      blob: new Blob(['kept image'], { type: 'image/png' }),
    })
    vi.spyOn(Date, 'now').mockReturnValue((now + 86401) * 1000)
    const first = (await studio.getImageJobs())[0]
    expect(first.status).toBe('success')
    expect(first.delivery_expired).toBe(true)
    expect(first.assets.map((asset) => asset.unavailable)).toEqual([
      false,
      true,
    ])
    expect(await studio.getImageURL('job-a-0-original')).toBe(
      'blob:local-image'
    )
    await expect(studio.getImageURL('job-a-1-original')).rejects.toThrow(
      'Image unavailable'
    )
    expect(await studio.getImageJobs()).toHaveLength(1)
    expect(http.get).not.toHaveBeenCalled()
  })

  it('stops polling unrecoverable pending requests without deleting their history or retrying generation', async () => {
    const { studio } = await signedIn()
    http.post.mockRejectedValue(new Error('Response lost'))
    await expect(studio.createImageJob(input, 'request-a')).rejects.toThrow(
      'Response lost'
    )
    vi.spyOn(Date, 'now').mockReturnValue((now + 86401) * 1000)
    const expired = (await studio.getImageJobs())[0]
    expect(expired.id).toBe('pending:request-a')
    expect(expired.status).toBe('unknown')
    expect(expired.delivery_expired).toBe(true)
    expect(await studio.getImageJobs()).toHaveLength(1)
    expect(http.get).not.toHaveBeenCalled()
    expect(http.post).toHaveBeenCalledTimes(1)
  })

  it('deletes individual originals locally and calls the server only for the last image', async () => {
    const { studio } = await signedIn()
    const { imageHistory } = await import('../lib/local-history')
    const multi: ImageJob = {
      ...job,
      input: { ...input, n: 2 },
      assets: [0, 1].flatMap((index) => [
        { id: `job-a-${index}-original`, kind: 'original' as const, url: '' },
        { id: `job-a-${index}-thumbnail`, kind: 'thumbnail' as const, url: '' },
      ]),
    }
    await imageHistory.saveJob({
      user_id: 1,
      id: job.id,
      expires_at: job.expires_at,
      remote: true,
      cached: true,
      job: multi,
    })
    for (const asset of multi.assets) {
      await imageHistory.saveAsset({
        user_id: 1,
        id: asset.id,
        job_id: job.id,
        expires_at: job.expires_at,
        blob: new Blob(['pixels'], { type: 'image/png' }),
      })
    }
    await studio.deleteImageAssets(['job-a-0-original'])
    expect(
      (await studio.getImageJobs())[0].assets.map((asset) => asset.id)
    ).toEqual(['job-a-1-original', 'job-a-1-thumbnail'])
    expect(http.delete).not.toHaveBeenCalled()
    http.delete.mockResolvedValue({ data: { success: true } })
    await studio.deleteImageAssets(['job-a-1-original'])
    expect(await studio.getImageJobs()).toEqual([])
    expect(http.delete).toHaveBeenCalledExactlyOnceWith(
      '/api/image-studio/jobs/job-a'
    )
  })

  it('reports an unconfirmed local deletion and keeps the history visible', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const { studio } = await signedIn()
    serveGeneration()
    await studio.createImageJob(input, 'request-a')
    await studio.getImageJobs()
    await expect(studio.deleteImageJobs(['job-a'])).rejects.toThrow(
      'Failed to delete local images. Please try again.'
    )
    expect(await studio.getImageJobs()).toHaveLength(1)
    expect(http.delete).not.toHaveBeenCalled()
  })
})
