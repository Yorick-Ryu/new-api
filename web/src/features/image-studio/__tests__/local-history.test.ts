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

import { ImageHistoryStore, type HistoryEntry } from '../lib/local-history'

const now = 1_800_000_000

function historyEntry(userID = 1, id = 'job-a'): HistoryEntry {
  return {
    user_id: userID,
    id,
    remote: true,
    cached: true,
    expires_at: now + 86400,
    job: {
      id,
      status: 'success',
      created_at: now,
      expires_at: now + 86400,
      input: {
        model: 'gpt-image-2',
        prompt: 'A bird',
        size: '',
        quality: '',
        n: 1,
      },
      assets: [
        {
          id: 'original-a',
          kind: 'original',
          url: 'https://temporary.invalid/a',
        },
      ],
    },
  }
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:test-image')
      static revokeObjectURL = vi.fn()
    }
  )
  vi.spyOn(Date, 'now').mockReturnValue(now * 1000)
})

afterEach(() => vi.unstubAllGlobals())

describe('browser image history', () => {
  it('restores metadata and original bytes after reload without persisting temporary URLs', async () => {
    const store = new ImageHistoryStore()
    await store.saveJob(historyEntry())
    await store.saveAsset({
      user_id: 1,
      id: 'original-a',
      job_id: 'job-a',
      expires_at: now + 86400,
      blob: new Blob(['original pixels'], { type: 'image/png' }),
    })
    const reloaded = new ImageHistoryStore()
    const entries = await reloaded.list(1)
    expect(entries).toHaveLength(1)
    expect(entries[0].job.assets[0].url).toBe('')
    expect(entries[0].job.storage_error).toBe(false)
    expect(await (await reloaded.getAsset(1, 'original-a'))?.blob.text()).toBe(
      'original pixels'
    )
    expect(await reloaded.list(2)).toEqual([])
    expect(await reloaded.getAsset(2, 'original-a')).toBeUndefined()
  })

  it('keeps old metadata, original bytes and URLs beyond the server delivery deadline', async () => {
    const store = new ImageHistoryStore()
    store.setActiveUser(1)
    await store.saveJob(historyEntry())
    await store.saveAsset({
      user_id: 1,
      id: 'original-a',
      job_id: 'job-a',
      expires_at: now + 86400,
      blob: new Blob(['image'], { type: 'image/png' }),
    })
    expect(await store.getURL(1, 'original-a')).toBe('blob:test-image')
    vi.spyOn(Date, 'now').mockReturnValue((now + 86400 * 400) * 1000)
    expect(await store.list(1)).toHaveLength(1)
    expect(await (await store.getAsset(1, 'original-a'))?.blob.text()).toBe(
      'image'
    )
    expect(await store.getURL(1, 'original-a')).toBe('blob:test-image')
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    const reloaded = new ImageHistoryStore()
    expect(await reloaded.list(1)).toHaveLength(1)
    expect(await (await reloaded.getAsset(1, 'original-a'))?.blob.text()).toBe(
      'image'
    )
  })

  it('keeps a successful generation downloadable when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const store = new ImageHistoryStore()
    store.setActiveUser(1)
    await store.saveJob(historyEntry())
    await store.saveAsset({
      user_id: 1,
      id: 'original-a',
      job_id: 'job-a',
      expires_at: now + 86400,
      blob: new Blob(['image'], { type: 'image/png' }),
    })
    const entries = await store.list(1)
    expect(entries[0].job.status).toBe('success')
    expect(entries[0].job.storage_error).toBe(true)
    expect(await store.getURL(1, 'original-a')).toBe('blob:test-image')
    expect(await store.list(2)).toEqual([])
  })

  it('keeps the original bytes in memory when a write transaction fails', async () => {
    const store = new ImageHistoryStore()
    await store.saveJob(historyEntry())
    const open = indexedDB.open('new-api-image-studio')
    const db = await new Promise<IDBDatabase>((resolve) => {
      open.onsuccess = () => resolve(open.result)
    })
    const prototype = Object.getPrototypeOf(
      db.transaction('assets').objectStore('assets')
    ) as IDBObjectStore
    vi.spyOn(prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Full', 'QuotaExceededError')
    })
    await store.saveAsset({
      user_id: 1,
      id: 'original-a',
      job_id: 'job-a',
      expires_at: now + 86400,
      blob: new Blob(['unlost image'], { type: 'image/png' }),
    })
    expect((await store.list(1))[0].job.storage_error).toBe(true)
    expect(await (await store.getAsset(1, 'original-a'))?.blob.text()).toBe(
      'unlost image'
    )
    db.close()
  })

  it('does not create an object URL after the view closes during an IndexedDB read', async () => {
    const store = new ImageHistoryStore()
    store.setActiveUser(1)
    await store.saveJob(historyEntry())
    await store.saveAsset({
      user_id: 1,
      id: 'original-a',
      job_id: 'job-a',
      expires_at: now + 86400,
      blob: new Blob(['image'], { type: 'image/png' }),
    })
    const pending = store.getURL(1, 'original-a')
    store.releaseURLs()
    expect(await pending).toBeUndefined()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('shares one object URL when two image consumers load the same original', async () => {
    const store = new ImageHistoryStore()
    store.setActiveUser(1)
    await store.saveJob(historyEntry())
    await store.saveAsset({
      user_id: 1,
      id: 'original-a',
      job_id: 'job-a',
      expires_at: now + 86400,
      blob: new Blob(['image'], { type: 'image/png' }),
    })
    expect(
      await Promise.all([
        store.getURL(1, 'original-a'),
        store.getURL(1, 'original-a'),
      ])
    ).toEqual(['blob:test-image', 'blob:test-image'])
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('keeps deletion durable when an earlier write is still opening the database', async () => {
    const store = new ImageHistoryStore()
    await Promise.all([
      store.saveJob(historyEntry()),
      store.deleteJob(1, 'job-a'),
    ])
    expect(await new ImageHistoryStore().list(1)).toEqual([])
  })

  it('revokes images on account changes and does not revive a deleted job from a late poll', async () => {
    const store = new ImageHistoryStore()
    store.setActiveUser(1)
    await store.saveJob(historyEntry())
    await store.saveAsset({
      user_id: 1,
      id: 'original-a',
      job_id: 'job-a',
      expires_at: now + 86400,
      blob: new Blob(['image'], { type: 'image/png' }),
    })
    await store.getURL(1, 'original-a')
    store.setActiveUser(2)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-image')
    expect(await store.getURL(1, 'original-a')).toBeUndefined()
    await store.deleteJob(1, 'job-a')
    await store.saveJob(historyEntry())
    expect(await store.list(1)).toEqual([])
    expect(await store.getAsset(1, 'original-a')).toBeUndefined()
  })

  it('retains expired version-one records when upgrading browser storage', async () => {
    const request = indexedDB.open('old-history', 1)
    request.onupgradeneeded = () => {
      const jobs = request.result.createObjectStore('jobs', {
        keyPath: ['user_id', 'id'],
      })
      jobs.createIndex('user', 'user_id')
      const assets = request.result.createObjectStore('assets', {
        keyPath: ['user_id', 'id'],
      })
      assets.createIndex('job', ['user_id', 'job_id'])
    }
    const db = await new Promise<IDBDatabase>((resolve) => {
      request.onsuccess = () => resolve(request.result)
    })
    const tx = db.transaction(['jobs', 'assets'], 'readwrite')
    tx.objectStore('jobs').put(historyEntry())
    tx.objectStore('assets').put({
      user_id: 1,
      id: 'original-a',
      job_id: 'job-a',
      expires_at: now + 86400,
      blob: new Blob(['old image'], { type: 'image/png' }),
    })
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve()
    })
    db.close()
    vi.spyOn(Date, 'now').mockReturnValue((now + 86400 * 2) * 1000)
    const upgraded = new ImageHistoryStore('old-history')
    expect(await upgraded.list(1)).toHaveLength(1)
    expect(await (await upgraded.getAsset(1, 'original-a'))?.blob.text()).toBe(
      'old image'
    )
  })

  it('deletes one original with its thumbnail and prevents stale tabs restoring either', async () => {
    const store = new ImageHistoryStore()
    const entry = historyEntry()
    entry.cached = false
    entry.job.input.n = 2
    entry.job.quota = 42
    entry.job.assets = [0, 1].flatMap((index) => [
      { id: `job-a-${index}-original`, kind: 'original' as const, url: '' },
      { id: `job-a-${index}-thumbnail`, kind: 'thumbnail' as const, url: '' },
    ])
    await store.saveJob(entry)
    for (const asset of entry.job.assets) {
      await store.saveAsset({
        user_id: 1,
        id: asset.id,
        job_id: 'job-a',
        expires_at: now + 86400,
        blob: new Blob([asset.id], { type: 'image/png' }),
      })
    }
    const otherTab = new ImageHistoryStore()
    const stale = (await otherTab.list(1))[0]
    expect(await store.deleteAssets(1, ['job-a-0-original'])).toEqual([])
    await otherTab.saveJob(stale)
    await otherTab.saveAsset({
      user_id: 1,
      id: 'job-a-0-original',
      job_id: 'job-a',
      expires_at: now + 86400,
      blob: new Blob(['late bytes'], { type: 'image/png' }),
    })
    const reloaded = new ImageHistoryStore()
    const remaining = (await reloaded.list(1))[0]
    expect(remaining.job.assets.map((asset) => asset.id)).toEqual([
      'job-a-1-original',
      'job-a-1-thumbnail',
    ])
    expect(remaining.job.input.n).toBe(2)
    expect(remaining.job.quota).toBe(42)
    expect(await reloaded.getAsset(1, 'job-a-0-original')).toBeUndefined()
    expect(await reloaded.getAsset(1, 'job-a-0-thumbnail')).toBeUndefined()
    expect(await reloaded.getAsset(1, 'job-a-1-original')).toBeDefined()
    expect(await store.deleteAssets(1, ['job-a-1-original'])).toEqual(['job-a'])
    await otherTab.saveJob(stale)
    expect(await new ImageHistoryStore().list(1)).toEqual([])
  })

  it('batch deletion preserves active tasks and another account with matching IDs', async () => {
    const store = new ImageHistoryStore()
    const active = historyEntry(1, 'running-job')
    active.job.status = 'running'
    await store.saveJob(historyEntry())
    await store.saveJob(active)
    await store.saveJob(historyEntry(2))
    await store.saveAsset({
      user_id: 2,
      id: 'original-a',
      job_id: 'job-a',
      expires_at: now + 86400,
      blob: new Blob(['other user'], { type: 'image/png' }),
    })
    expect(await store.deleteJobs(1, ['job-a', 'running-job'])).toEqual([
      'job-a',
    ])
    const reloaded = new ImageHistoryStore()
    expect((await reloaded.list(1)).map((entry) => entry.id)).toEqual([
      'running-job',
    ])
    expect(await reloaded.list(2)).toHaveLength(1)
    expect(await (await reloaded.getAsset(2, 'original-a'))?.blob.text()).toBe(
      'other user'
    )
  })

  it('keeps all rows, bytes and URLs visible when a batch deletion transaction aborts', async () => {
    const store = new ImageHistoryStore()
    store.setActiveUser(1)
    await store.saveJob(historyEntry())
    await store.saveAsset({
      user_id: 1,
      id: 'original-a',
      job_id: 'job-a',
      expires_at: now + 86400,
      blob: new Blob(['retained'], { type: 'image/png' }),
    })
    await store.getURL(1, 'original-a')
    const request = indexedDB.open('new-api-image-studio')
    const db = await new Promise<IDBDatabase>((resolve) => {
      request.onsuccess = () => resolve(request.result)
    })
    const prototype = Object.getPrototypeOf(
      db.transaction('assets').objectStore('assets')
    ) as IDBObjectStore
    const original = prototype.delete
    const deleting = vi
      .spyOn(prototype, 'delete')
      .mockImplementation(function (this: IDBObjectStore, key) {
        if (this.name === 'assets') {
          throw new DOMException('Storage write failed', 'UnknownError')
        }
        return original.call(this, key)
      })
    await expect(store.deleteJobs(1, ['job-a'])).rejects.toThrow()
    deleting.mockRestore()
    expect(await store.list(1)).toHaveLength(1)
    expect(await new ImageHistoryStore().list(1)).toHaveLength(1)
    expect(await (await store.getAsset(1, 'original-a'))?.blob.text()).toBe(
      'retained'
    )
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    db.close()
  })

  it('does not replace a manually deleted pending request with a late job response', async () => {
    const store = new ImageHistoryStore()
    const pending = historyEntry(1, 'pending:request-a')
    pending.job.request_key = 'request-a'
    pending.job.status = 'unknown'
    await store.saveJob(pending)
    const otherTab = new ImageHistoryStore()
    await otherTab.list(1)
    await store.deleteJobs(1, [pending.id])
    const completed = historyEntry()
    completed.job.request_key = 'request-a'
    await otherTab.saveJob(completed, pending.id)
    expect(await new ImageHistoryStore().list(1)).toEqual([])
  })

  it('reports unavailable storage instead of hiding an unconfirmed deletion', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const store = new ImageHistoryStore()
    await store.saveJob(historyEntry())
    await expect(store.deleteJobs(1, ['job-a'])).rejects.toThrow()
    expect(await store.list(1)).toHaveLength(1)
    vi.stubGlobal('indexedDB', new IDBFactory())
    await expect(store.deleteJobs(1, ['job-a'])).resolves.toEqual(['job-a'])
    expect(await store.list(1)).toEqual([])
    expect(await new ImageHistoryStore().list(1)).toEqual([])
  })
})
