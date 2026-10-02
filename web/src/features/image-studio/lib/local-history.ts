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
import type { ImageJob } from '../api'

export type HistoryEntry = {
  user_id: number
  id: string
  expires_at: number
  remote: boolean
  cached: boolean
  job: ImageJob
}

type StoredAsset = {
  user_id: number
  id: string
  job_id: string
  expires_at: number
  blob: Blob
}

type Deletion = {
  user_id: number
  key: string
  replacement?: string
}

function transactionResult<T>(
  transaction: IDBTransaction,
  request?: IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener(
      'complete',
      () => resolve(request?.result as T),
      { once: true }
    )
    transaction.addEventListener(
      'abort',
      () =>
        reject(
          transaction.error ?? new Error('Browser storage is unavailable')
        ),
      { once: true }
    )
    transaction.addEventListener(
      'error',
      () =>
        reject(
          transaction.error ?? new Error('Browser storage is unavailable')
        ),
      { once: true }
    )
  })
}

function isActive(entry: HistoryEntry): boolean {
  return ['queued', 'running', 'saving'].includes(entry.job.status)
}

// Bytes stay local until explicit deletion. expires_at is only the server's
// delivery deadline, including for records written by older application versions.
export class ImageHistoryStore {
  private database?: Promise<IDBDatabase>
  private memoryJobs = new Map<string, HistoryEntry>()
  private memoryAssets = new Map<string, StoredAsset>()
  private removed = new Set<string>()
  private deletedJobs = new Set<string>()
  private removedAssets = new Set<string>()
  private failures = new Set<string>()
  private urls = new Map<string, string>()
  private activeUser?: number
  private urlEpoch = 0

  constructor(private readonly name = 'new-api-image-studio') {}

  private key(userID: number, id: string): string {
    return `${userID}:${id}`
  }

  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      let failed = false
      const opening = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(this.name, 2)
        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains('jobs')) {
            const jobs = db.createObjectStore('jobs', {
              keyPath: ['user_id', 'id'],
            })
            jobs.createIndex('user', 'user_id')
            const assets = db.createObjectStore('assets', {
              keyPath: ['user_id', 'id'],
            })
            assets.createIndex('job', ['user_id', 'job_id'])
          }
          if (!db.objectStoreNames.contains('deleted')) {
            const deleted = db.createObjectStore('deleted', {
              keyPath: ['user_id', 'key'],
            })
            deleted.createIndex('user', 'user_id')
          }
        }
        request.onsuccess = () => {
          if (failed) {
            request.result.close()
            return
          }
          request.result.onversionchange = () => {
            request.result.close()
            if (this.database === opening) this.database = undefined
          }
          resolve(request.result)
        }
        request.addEventListener(
          'error',
          () => {
            failed = true
            reject(request.error)
          },
          { once: true }
        )
        request.onblocked = () => {
          failed = true
          reject(new Error('Browser storage is busy'))
        }
      })
      this.database = opening
      void opening.catch(() => {
        if (this.database === opening) this.database = undefined
      })
    }
    return this.database
  }

  setActiveUser(userID: number | undefined): void {
    if (this.activeUser !== userID) {
      this.releaseURLs()
      this.activeUser = userID
    }
  }

  releaseURLs(): void {
    this.urlEpoch += 1
    for (const value of this.urls.values()) URL.revokeObjectURL(value)
    this.urls.clear()
  }

  markStorageFailure(userID: number, jobID: string): void {
    this.failures.add(this.key(userID, jobID))
  }

  clearStorageFailure(userID: number, jobID: string): void {
    if (this.hasUnpersistedData(userID, jobID)) return
    this.failures.delete(this.key(userID, jobID))
  }

  hasUnpersistedData(userID: number, jobID: string): boolean {
    if (this.memoryJobs.has(this.key(userID, jobID))) return true
    for (const asset of this.memoryAssets.values()) {
      if (asset.user_id === userID && asset.job_id === jobID) return true
    }
    return false
  }

  isAssetVolatile(userID: number, assetID: string): boolean {
    return this.memoryAssets.has(this.key(userID, assetID))
  }

  private revokeAsset(userID: number, id: string): void {
    const key = this.key(userID, id)
    const existing = this.urls.get(key)
    if (existing) URL.revokeObjectURL(existing)
    this.urls.delete(key)
  }

  private acceptDeletions(deletions: Deletion[]): void {
    for (const deletion of deletions) {
      if (deletion.key.startsWith('job:')) {
        const id = deletion.key.slice(4)
        const key = this.key(deletion.user_id, id)
        this.removed.add(key)
        if (!deletion.replacement) this.deletedJobs.add(key)
        this.memoryJobs.delete(key)
        this.failures.delete(key)
        for (const asset of this.memoryAssets.values()) {
          if (asset.user_id === deletion.user_id && asset.job_id === id) {
            this.memoryAssets.delete(this.key(asset.user_id, asset.id))
            this.revokeAsset(asset.user_id, asset.id)
          }
        }
      } else {
        const id = deletion.key.slice(6)
        const key = this.key(deletion.user_id, id)
        this.removedAssets.add(key)
        this.memoryAssets.delete(key)
        this.revokeAsset(deletion.user_id, id)
      }
    }
  }

  async saveJob(entry: HistoryEntry, replaces?: string): Promise<void> {
    const key = this.key(entry.user_id, entry.id)
    if (
      this.removed.has(key) ||
      (replaces && this.deletedJobs.has(this.key(entry.user_id, replaces)))
    ) {
      return
    }
    const clean: HistoryEntry = {
      ...entry,
      job: {
        ...entry.job,
        storage_error: undefined,
        assets: entry.job.assets
          .filter(
            (asset) =>
              !this.removedAssets.has(this.key(entry.user_id, asset.id))
          )
          .map((asset) => ({ ...asset, url: '' })),
      },
    }
    this.memoryJobs.set(key, clean)
    let blocked = false
    try {
      const db = await this.open()
      if (this.removed.has(key)) return
      const transaction = db.transaction(['jobs', 'deleted'], 'readwrite')
      const deleted = transaction.objectStore('deleted')
      const request = deleted.index('user').getAll(entry.user_id)
      request.onsuccess = () => {
        try {
          const markers = request.result as Deletion[]
          this.acceptDeletions(markers)
          blocked =
            this.removed.has(key) ||
            Boolean(
              replaces &&
              this.deletedJobs.has(this.key(entry.user_id, replaces))
            )
          if (blocked) return
          clean.job.assets = clean.job.assets.filter(
            (asset) =>
              !this.removedAssets.has(this.key(entry.user_id, asset.id))
          )
          const jobs = transaction.objectStore('jobs')
          jobs.put(clean)
          if (replaces) {
            jobs.delete([entry.user_id, replaces])
            deleted.put({
              user_id: entry.user_id,
              key: `job:${replaces}`,
              replacement: entry.id,
            } satisfies Deletion)
          }
        } catch {
          transaction.abort()
        }
      }
      await transactionResult(transaction)
      if (this.memoryJobs.get(key) === clean) this.memoryJobs.delete(key)
    } catch {
      this.failures.add(key)
    }
    if (replaces && !blocked) {
      const oldKey = this.key(entry.user_id, replaces)
      this.memoryJobs.delete(oldKey)
      this.removed.add(oldKey)
      if (this.failures.has(oldKey)) this.failures.add(key)
    }
  }

  async list(userID: number): Promise<HistoryEntry[]> {
    const entries = new Map<string, HistoryEntry>()
    try {
      const db = await this.open()
      const transaction = db.transaction(['jobs', 'deleted'], 'readonly')
      const request = transaction
        .objectStore('jobs')
        .index('user')
        .getAll(userID)
      const deleted = transaction
        .objectStore('deleted')
        .index('user')
        .getAll(userID)
      const saved = (await transactionResult(
        transaction,
        request
      )) as HistoryEntry[]
      this.acceptDeletions(deleted.result as Deletion[])
      for (const entry of saved) entries.set(entry.id, entry)
    } catch {
      // New results can still be used in memory when browser storage is denied.
    }
    for (const entry of this.memoryJobs.values()) {
      if (entry.user_id === userID) entries.set(entry.id, entry)
    }
    return [...entries.values()]
      .filter((entry) => !this.removed.has(this.key(userID, entry.id)))
      .map((entry) => ({
        ...entry,
        job: {
          ...entry.job,
          assets: entry.job.assets.filter(
            (asset) => !this.removedAssets.has(this.key(userID, asset.id))
          ),
          storage_error: this.failures.has(this.key(userID, entry.id)),
        },
      }))
      .sort((a, b) => b.job.created_at - a.job.created_at)
  }

  async saveAsset(asset: StoredAsset): Promise<void> {
    const key = this.key(asset.user_id, asset.id)
    const jobKey = this.key(asset.user_id, asset.job_id)
    if (this.removed.has(jobKey) || this.removedAssets.has(key)) return
    this.memoryAssets.set(key, asset)
    let blocked = false
    try {
      const db = await this.open()
      if (this.removed.has(jobKey) || this.removedAssets.has(key)) return
      const transaction = db.transaction(
        ['jobs', 'assets', 'deleted'],
        'readwrite'
      )
      const parent = transaction
        .objectStore('jobs')
        .get([asset.user_id, asset.job_id])
      const deleted = transaction
        .objectStore('deleted')
        .index('user')
        .getAll(asset.user_id)
      deleted.onsuccess = () => {
        try {
          this.acceptDeletions(deleted.result as Deletion[])
          blocked =
            (!parent.result && !this.memoryJobs.has(jobKey)) ||
            this.removed.has(jobKey) ||
            this.removedAssets.has(key)
          if (!blocked) transaction.objectStore('assets').put(asset)
        } catch {
          transaction.abort()
        }
      }
      await transactionResult(transaction)
      if (this.memoryAssets.get(key) === asset) this.memoryAssets.delete(key)
    } catch {
      if (!blocked) this.failures.add(jobKey)
    }
  }

  async getAsset(userID: number, id: string): Promise<StoredAsset | undefined> {
    const key = this.key(userID, id)
    let asset = this.memoryAssets.get(key)
    try {
      const db = await this.open()
      const transaction = db.transaction(['assets', 'deleted'], 'readonly')
      const request = transaction.objectStore('assets').get([userID, id])
      const deleted = transaction
        .objectStore('deleted')
        .index('user')
        .getAll(userID)
      const saved = (await transactionResult(transaction, request)) as
        | StoredAsset
        | undefined
      this.acceptDeletions(deleted.result as Deletion[])
      asset ??= saved
    } catch {
      // A quota failure may leave the only usable copy in memory.
    }
    if (
      !asset ||
      this.removedAssets.has(key) ||
      this.removed.has(this.key(userID, asset.job_id))
    ) {
      return undefined
    }
    return asset
  }

  async getURL(userID: number, id: string): Promise<string | undefined> {
    const epoch = this.urlEpoch
    const key = this.key(userID, id)
    if (this.activeUser !== userID || this.removedAssets.has(key)) return
    const existing = this.urls.get(key)
    if (existing) return existing
    const asset = await this.getAsset(userID, id)
    if (!asset || epoch !== this.urlEpoch || this.activeUser !== userID) return
    const concurrent = this.urls.get(key)
    if (concurrent) return concurrent
    const value = URL.createObjectURL(asset.blob)
    this.urls.set(key, value)
    return value
  }

  // A server-rejected submission never became a job. Discard its placeholder
  // without a deletion marker so the same idempotency key can be confirmed.
  async discardRejectedSubmission(
    userID: number,
    requestKey: string
  ): Promise<void> {
    const id = `pending:${requestKey}`
    const db = await this.open()
    const transaction = db.transaction('jobs', 'readwrite')
    const jobs = transaction.objectStore('jobs')
    const request = jobs.get([userID, id])
    request.onsuccess = () => {
      const entry = request.result as HistoryEntry | undefined
      if (entry && !entry.remote) jobs.delete([userID, id])
    }
    await transactionResult(transaction)
    const key = this.key(userID, id)
    this.memoryJobs.delete(key)
    this.failures.delete(key)
  }

  async deleteJob(userID: number, id: string): Promise<void> {
    await this.deleteJobs(userID, [id])
  }

  async deleteJobs(userID: number, ids: string[]): Promise<string[]> {
    return this.deleteSelection(userID, new Set(ids), new Set())
  }

  async deleteAssets(userID: number, originalIDs: string[]): Promise<string[]> {
    return this.deleteSelection(userID, new Set(), new Set(originalIDs))
  }

  private async deleteSelection(
    userID: number,
    jobIDs: Set<string>,
    originalIDs: Set<string>
  ): Promise<string[]> {
    if (!jobIDs.size && !originalIDs.size) return []
    // Do not hide anything until this transaction commits. A failed deletion
    // must remain visible and retryable, including after a reload.
    const db = await this.open()
    const transaction = db.transaction(
      ['jobs', 'assets', 'deleted'],
      'readwrite'
    )
    const jobs = transaction.objectStore('jobs')
    const assets = transaction.objectStore('assets')
    const deleted = transaction.objectStore('deleted')
    const request = jobs.index('user').getAll(userID)
    const previousDeletions = deleted.index('user').getAll(userID)
    const markers: Deletion[] = []
    const updatedMemory = new Map<string, HistoryEntry>()
    const removedJobs: string[] = []
    const removedAssets = new Set<string>()
    previousDeletions.onsuccess = () => {
      try {
        const alreadyDeleted = new Set(
          (previousDeletions.result as Deletion[]).map((marker) => marker.key)
        )
        const entries = new Map(
          (request.result as HistoryEntry[]).map((entry) => [entry.id, entry])
        )
        for (const entry of this.memoryJobs.values()) {
          if (entry.user_id === userID) entries.set(entry.id, entry)
        }
        const mark = (key: string) => {
          const marker: Deletion = { user_id: userID, key }
          markers.push(marker)
          deleted.put(marker)
        }
        for (const entry of entries.values()) {
          if (isActive(entry) || alreadyDeleted.has(`job:${entry.id}`)) continue
          const visible = entry.job.assets.filter(
            (asset) => !alreadyDeleted.has(`asset:${asset.id}`)
          )
          const originals = visible.filter((asset) => asset.kind === 'original')
          const selected = originals.filter((asset) =>
            originalIDs.has(asset.id)
          )
          const whole =
            jobIDs.has(entry.id) ||
            (selected.length > 0 && selected.length === originals.length)
          if (!whole && !selected.length) continue
          const selectedIDs = new Set(selected.map((asset) => asset.id))
          for (const original of selected) {
            const thumbnailID = original.id.replace(/-original$/, '-thumbnail')
            if (
              visible.some(
                (asset) =>
                  asset.kind === 'thumbnail' && asset.id === thumbnailID
              )
            ) {
              selectedIDs.add(thumbnailID)
            }
          }
          if (whole) {
            removedJobs.push(entry.id)
            jobs.delete([userID, entry.id])
            mark(`job:${entry.id}`)
            if (entry.job.request_key) {
              mark(`job:pending:${entry.job.request_key}`)
            }
            for (const asset of visible) selectedIDs.add(asset.id)
            const stored = assets.index('job').getAllKeys([userID, entry.id])
            stored.onsuccess = () => {
              try {
                for (const assetKey of stored.result) {
                  if (Array.isArray(assetKey)) {
                    removedAssets.add(String(assetKey[1]))
                  }
                  assets.delete(assetKey)
                }
              } catch {
                transaction.abort()
              }
            }
          } else {
            const next: HistoryEntry = {
              ...entry,
              job: {
                ...entry.job,
                assets: visible.filter((asset) => !selectedIDs.has(asset.id)),
              },
            }
            jobs.put(next)
            if (this.memoryJobs.get(this.key(userID, entry.id)) === entry) {
              updatedMemory.set(entry.id, entry)
            }
          }
          for (const id of selectedIDs) {
            removedAssets.add(id)
            assets.delete([userID, id])
            mark(`asset:${id}`)
          }
        }
      } catch {
        transaction.abort()
      }
    }
    await transactionResult(transaction)
    this.urlEpoch += 1
    this.acceptDeletions(markers)
    for (const id of removedAssets) this.revokeAsset(userID, id)
    for (const id of removedJobs) {
      this.memoryJobs.delete(this.key(userID, id))
      this.failures.delete(this.key(userID, id))
    }
    for (const [id, previous] of updatedMemory) {
      const key = this.key(userID, id)
      if (this.memoryJobs.get(key) === previous) this.memoryJobs.delete(key)
    }
    return removedJobs
  }
}

export const imageHistory = new ImageHistoryStore()
