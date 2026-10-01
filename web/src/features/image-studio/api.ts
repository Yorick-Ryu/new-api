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
import { t } from 'i18next'

import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { imageHistory, type HistoryEntry } from './lib/local-history'

export type ImageInput = {
  model: string
  prompt: string
  size: string
  quality: string
  n: number
  reference_id?: string
  reference_ids?: string[]
}
export type ImageCapability = {
  model: string
  sizes: string[]
  qualities: string[]
  max_count: number
  editing: boolean
  custom_size?: boolean
}
export type ImageAsset = {
  id: string
  kind: 'original' | 'thumbnail'
  url: string
  unavailable?: boolean
}
export type ImageJob = {
  id: string
  request_key?: string
  status: string
  created_at: number
  expires_at: number
  storage_error?: boolean
  delivery_expired?: boolean
  pending_delivery?: boolean
  input: ImageInput
  error?: string
  quota?: number
  assets: ImageAsset[]
}
export type ImageOptions = { available: boolean; models: ImageCapability[] }
const base = '/api/image-studio'
let viewEpoch = 0

export function releaseImageURLs(): void {
  viewEpoch += 1
  imageHistory.releaseURLs()
}

useAuthStore.subscribe((state, previous) => {
  if (state.auth.user?.id !== previous.auth.user?.id) {
    imageHistory.setActiveUser(state.auth.user?.id)
  }
})

function currentUser(): number {
  const userID = useAuthStore.getState().auth.user?.id
  if (!userID) throw new Error(t('Your session has changed. Please try again.'))
  imageHistory.setActiveUser(userID)
  return userID
}

function assertCurrentUser(userID: number): void {
  if (useAuthStore.getState().auth.user?.id !== userID) {
    throw new Error(t('Your session has changed. Please try again.'))
  }
}

export async function getImageOptions(): Promise<ImageOptions> {
  const userID = currentUser()
  const response = await api.get(`${base}/options`)
  assertCurrentUser(userID)
  requireServerSuccess(response.data)
  return response.data.data
}
export async function getImageJobs(): Promise<ImageJob[]> {
  const userID = currentUser()
  const epoch = viewEpoch
  const entries = await imageHistory.list(userID)
  assertCurrentUser(userID)
  for (const entry of entries) {
    if (
      (!entry.cached || isImageJobActive(entry.job)) &&
      deliveryExpired(entry)
    ) {
      await finishExpiredDelivery(userID, entry)
    }
  }
  const refresh = entries.filter(
    (entry) => !entry.cached || isImageJobActive(entry.job)
  )
  for (let offset = 0; offset < refresh.length; offset += 100) {
    const batch = refresh.slice(offset, offset + 100)
    let remote: ImageJob[]
    try {
      assertCurrentUser(userID)
      const response = await api.get(`${base}/jobs`, {
        params: {
          ids:
            batch
              .filter((entry) => entry.remote)
              .map((entry) => entry.id)
              .join(',') || undefined,
          request_keys:
            batch
              .filter((entry) => !entry.remote)
              .map((entry) => entry.id.slice('pending:'.length))
              .join(',') || undefined,
        },
      })
      requireServerSuccess(response.data)
      remote = response.data.data
    } catch {
      // Saved history remains available when temporary server storage is offline.
      assertCurrentUser(userID)
      break
    }
    assertCurrentUser(userID)
    const registered = new Map(batch.map((entry) => [entry.id, entry]))
    for (const job of remote) {
      const previous =
        registered.get(job.id) ?? registered.get(`pending:${job.request_key}`)
      if (!previous) continue
      const expires = job.expires_at > 0 ? job.expires_at : previous.expires_at
      let entry: HistoryEntry = {
        user_id: userID,
        id: job.id,
        expires_at: expires,
        remote: true,
        cached: false,
        job: {
          ...job,
          expires_at: expires,
          assets: [
            ...new Map(
              [...previous.job.assets, ...job.assets].map((asset) => [
                asset.id,
                asset,
              ])
            ).values(),
          ],
        },
      }
      await imageHistory.saveJob(
        entry,
        previous.id !== job.id ? previous.id : undefined
      )
      // Re-read saved metadata so per-image deletions filter late polls from
      // another tab before any deleted assets can be downloaded again.
      const saved = (await imageHistory.list(userID)).find(
        (item) => item.id === entry.id
      )
      if (!saved) continue
      entry = saved
      if (deliveryExpired(entry)) {
        await finishExpiredDelivery(userID, entry)
        continue
      }
      if (job.status === 'success') {
        let complete = entry.job.assets.length > 0
        for (const asset of entry.job.assets) {
          try {
            await cacheImageAsset(userID, entry, asset.id)
          } catch {
            assertCurrentUser(userID)
            complete = false
            imageHistory.markStorageFailure(userID, job.id)
          }
        }
        entry.cached =
          complete && !imageHistory.hasUnpersistedData(userID, entry.id)
      } else if (!isImageJobActive(job)) {
        entry.cached = true
      }
      await imageHistory.saveJob(entry)
      if (entry.cached) imageHistory.clearStorageFailure(userID, entry.id)
    }
  }
  const jobs = await imageHistory.list(userID)
  assertCurrentUser(userID)
  const result: ImageJob[] = []
  for (const entry of jobs) {
    const assets: ImageAsset[] = []
    for (const asset of entry.job.assets) {
      let url = ''
      if (asset.kind === 'thumbnail' && epoch === viewEpoch) {
        url = (await imageHistory.getURL(userID, asset.id)) ?? ''
      }
      assets.push({ ...asset, url })
    }
    result.push({ ...entry.job, assets, pending_delivery: !entry.cached })
  }
  assertCurrentUser(userID)
  return result
}
export async function createImageJob(
  input: ImageInput,
  key: string
): Promise<{ id: string }> {
  const userID = currentUser()
  const now = Math.floor(Date.now() / 1000)
  const pendingID = `pending:${key}`
  const entry: HistoryEntry = {
    user_id: userID,
    id: pendingID,
    expires_at: now + 86400,
    remote: false,
    cached: false,
    job: {
      id: pendingID,
      request_key: key,
      status: 'queued',
      created_at: now,
      expires_at: now + 86400,
      input,
      assets: [],
    },
  }
  await imageHistory.saveJob(entry)
  try {
    assertCurrentUser(userID)
    const response = await api.post(`${base}/jobs`, input, {
      headers: { 'Idempotency-Key': key },
    })
    requireServerSuccess(response.data)
    const result: { id: string } = response.data.data
    entry.id = result.id
    entry.remote = true
    entry.job = { ...entry.job, id: result.id }
    await imageHistory.saveJob(entry, pendingID)
    assertCurrentUser(userID)
    return result
  } catch (error) {
    if (!entry.remote) {
      entry.job = {
        ...entry.job,
        status: 'unknown',
        error: 'Image result could not be confirmed',
      }
      await imageHistory.saveJob(entry)
    }
    throw error
  }
}
export async function uploadReference(file: File): Promise<string> {
  const userID = currentUser()
  const form = new FormData()
  form.append('image', file)
  const response = await api.post(`${base}/references`, form)
  assertCurrentUser(userID)
  requireServerSuccess(response.data)
  return response.data.data.id
}
export async function deleteImageJob(id: string): Promise<void> {
  await deleteImageJobs([id])
}

export async function deleteImageJobs(ids: string[]): Promise<void> {
  await deleteLocalImages(ids, [])
}

export async function deleteImageAssets(originalIDs: string[]): Promise<void> {
  await deleteLocalImages([], originalIDs)
}

async function deleteLocalImages(
  jobIDs: string[],
  originalIDs: string[]
): Promise<void> {
  const userID = currentUser()
  const entries = await imageHistory.list(userID)
  assertCurrentUser(userID)
  let deleted: string[]
  try {
    deleted = jobIDs.length
      ? await imageHistory.deleteJobs(userID, jobIDs)
      : await imageHistory.deleteAssets(userID, originalIDs)
  } catch {
    throw new Error(t('Failed to delete local images. Please try again.'))
  }
  assertCurrentUser(userID)
  const remote = new Set(
    entries.filter((entry) => entry.remote).map((entry) => entry.id)
  )
  for (const id of deleted) {
    if (!remote.has(id)) continue
    // Partial image deletion is local only. Remove the temporary server job
    // only after its final image is deleted, without waiting for the network.
    void api
      .delete(`${base}/jobs/${encodeURIComponent(id)}`)
      .catch(() => undefined)
  }
}

export async function getImageURL(
  id: string,
  download = false
): Promise<string> {
  const userID = currentUser()
  const epoch = viewEpoch
  const entries = await imageHistory.list(userID)
  const entry = entries.find((item) =>
    item.job.assets.some((asset) => asset.id === id)
  )
  if (!entry) throw new Error(t('Image unavailable'))
  await cacheImageAsset(userID, entry, id, download)
  assertCurrentUser(userID)
  if (epoch !== viewEpoch) {
    throw new DOMException('Image view closed', 'AbortError')
  }
  const url = await imageHistory.getURL(userID, id)
  if (!url) throw new Error(t('Image unavailable'))
  assertCurrentUser(userID)
  return url
}
export function imageJobsRefetchInterval(jobs?: ImageJob[]): number | false {
  return jobs?.some((job) => isImageJobActive(job) || job.pending_delivery)
    ? 3000
    : false
}

export function isImageJobActive(job: ImageJob): boolean {
  return ['queued', 'running', 'saving'].includes(job.status)
}

export async function cloneImageReference(id: string): Promise<string> {
  const userID = currentUser()
  const entry = (await imageHistory.list(userID)).find((item) =>
    item.job.assets.some(
      (asset) => asset.id === id && asset.kind === 'original'
    )
  )
  if (!entry) throw new Error(t('Image unavailable'))
  const asset = await cacheImageAsset(userID, entry, id)
  assertCurrentUser(userID)
  if (asset.blob.size > 20 * 1024 * 1024) {
    throw new Error(t('Reference images must be 20 MB or smaller'))
  }
  const extension =
    asset.blob.type === 'image/jpeg'
      ? 'jpg'
      : asset.blob.type.split('/')[1] || 'png'
  return uploadReference(
    new File([asset.blob], `reference.${extension}`, { type: asset.blob.type })
  )
}

function deliveryExpired(entry: HistoryEntry): boolean {
  return entry.expires_at > 0 && entry.expires_at <= Date.now() / 1000
}

async function finishExpiredDelivery(
  userID: number,
  entry: HistoryEntry
): Promise<void> {
  const assets: ImageAsset[] = []
  for (const asset of entry.job.assets) {
    const saved = await imageHistory.getAsset(userID, asset.id)
    assets.push({ ...asset, unavailable: !saved })
  }
  assertCurrentUser(userID)
  const pending = isImageJobActive(entry.job) || entry.job.status === 'unknown'
  entry.cached = true
  entry.job = {
    ...entry.job,
    status: pending ? 'unknown' : entry.job.status,
    delivery_expired:
      pending ||
      !assets.some((asset) => asset.kind === 'original') ||
      assets.some((asset) => asset.kind === 'original' && asset.unavailable),
    assets,
  }
  await imageHistory.saveJob(entry)
  imageHistory.clearStorageFailure(userID, entry.id)
}

async function cacheImageAsset(
  userID: number,
  entry: HistoryEntry,
  id: string,
  download = false
) {
  const saved = await imageHistory.getAsset(userID, id)
  if (saved) {
    if (imageHistory.isAssetVolatile(userID, id)) {
      await imageHistory.saveAsset(saved)
    }
    return saved
  }
  assertCurrentUser(userID)
  if (deliveryExpired(entry)) throw new Error(t('Image unavailable'))
  // Always fetch the owned authenticated endpoint, never a provider-supplied URL.
  const response = await api.get<Blob>(
    `${base}/assets/${encodeURIComponent(id)}/content`,
    {
      responseType: 'blob',
      params: { download: download ? '1' : '0' },
    }
  )
  assertCurrentUser(userID)
  const blob = response.data
  if (
    blob.size === 0 ||
    blob.size > 40 * 1024 * 1024 ||
    !['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)
  ) {
    throw new Error(t('Failed to load image'))
  }
  const asset = {
    user_id: userID,
    id,
    job_id: entry.id,
    expires_at: entry.expires_at,
    blob,
  }
  await imageHistory.saveAsset(asset)
  return asset
}
