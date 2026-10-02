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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Images } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout/components/section-page-layout'
import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { getServerErrorMessage } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import {
  cloneImageReference,
  getImageURL,
  deleteImageAssets,
  deleteImageJobs,
  getImageJobs,
  getImageOptions,
  imageJobsRefetchInterval,
  isImageJobActive,
  releaseImageURLs,
  type ImageInput,
  type ImageJob,
} from './api'
import { ImageForm } from './components/image-form'
import { ImageGallery } from './components/image-gallery'

export function ImageStudio() {
  const userID = useAuthStore((state) => state.auth.user?.id)
  return <ImageStudioWorkspace key={userID ?? 'signed-out'} />
}

function ImageStudioWorkspace() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const userID = useAuthStore((state) => state.auth.user?.id)
  const client = useQueryClient()
  const queryKey = ['image-studio-jobs', userID]
  const options = useQuery({
    queryKey: ['image-studio-options', userID],
    queryFn: getImageOptions,
    meta: { errorRedirect: false },
  })
  const jobs = useQuery({
    queryKey,
    queryFn: getImageJobs,
    meta: { errorRedirect: false },
    refetchInterval: (query) => imageJobsRefetchInterval(query.state.data),
  })
  const previousJobs = useRef(new Map<string, ImageJob['status']>())
  const notifiedJobs = useRef(new Set<string>())
  useEffect(() => {
    if (!jobs.data) return
    for (const job of jobs.data) {
      const previous = previousJobs.current.get(job.id)
      if (
        previous &&
        previous !== job.status &&
        (job.status === 'failed' || job.status === 'unknown') &&
        !notifiedJobs.current.has(job.id)
      ) {
        notifiedJobs.current.add(job.id)
        toast.error(t(job.error || 'Image generation failed; check usage logs'))
      }
    }
    previousJobs.current = new Map(jobs.data.map((job) => [job.id, job.status]))
  }, [jobs.data, t])
  useEffect(
    () => () => {
      void client.cancelQueries({ queryKey: ['image-studio-jobs', userID] })
      void client.cancelQueries({ queryKey: ['image-studio-asset', userID] })
      client.removeQueries({ queryKey: ['image-studio-jobs', userID] })
      client.removeQueries({ queryKey: ['image-studio-asset', userID] })
      releaseImageURLs()
    },
    [client, userID]
  )
  const [reuse, setReuse] = useState<{
    input: ImageInput
    version: number
  } | null>(null)
  const [referenceState, setReferenceState] = useState({
    count: 0,
    enabled: false,
  })
  const [reference, setReference] = useState<{
    id: string
    name: string
    url: string
  } | null>(null)
  const [deleting, setDeleting] = useState<{
    ids: string[]
    kind: 'images' | 'job' | 'records' | 'all'
  } | null>(null)
  const remove = useMutation({
    mutationFn: async (target: NonNullable<typeof deleting>) => {
      await client.cancelQueries({ queryKey })
      if (target.kind === 'images') await deleteImageAssets(target.ids)
      else await deleteImageJobs(target.ids)
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey })
      client.removeQueries({
        queryKey: ['image-studio-asset', userID],
        type: 'inactive',
      })
      setDeleting(null)
    },
  })
  const copyReference = useMutation({
    mutationFn: async (value: { job: ImageJob; assetID: string }) => {
      if (referenceState.count >= 4) {
        throw new Error(t('You can add up to 4 reference images.'))
      }
      if (!referenceState.enabled) {
        throw new Error(t('Image editing is not supported by this model'))
      }
      const url = await getImageURL(value.assetID)
      const id = await cloneImageReference(value.assetID)
      return { id, url }
    },
    onSuccess: (reference) =>
      setReference({ ...reference, name: t('Generated image') }),
  })
  let deleteTitle = t('Delete image generation?')
  let deleteDescription = t(
    'The images and this history entry will be removed. Billing records are kept.'
  )
  if (deleting?.kind === 'images') {
    deleteTitle = t('Delete selected images?')
    deleteDescription = t(
      'The selected {{amount}} images will be removed from this browser. This cannot be undone. Billing records are kept.',
      { amount: formatNumber(deleting.ids.length, locale) }
    )
  } else if (deleting?.kind === 'records') {
    deleteTitle = t('Delete selected records?')
    deleteDescription = t(
      'The selected records and their images will be removed from this browser. This cannot be undone. Billing records are kept.'
    )
  } else if (deleting?.kind === 'all') {
    deleteTitle = t('Clear all image history?')
    deleteDescription = t(
      'All saved images and finished generation history in this browser will be removed. Generations in progress and billing records are kept. This cannot be undone.'
    )
  }

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>
          {t('Image generation')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='space-y-6'>
            {options.isPending && <LoadingState />}
            {options.isError && (
              <ErrorState
                description={t(getServerErrorMessage(options.error))}
                onRetry={() => void options.refetch()}
              />
            )}
            {options.data && (
              <>
                {!options.data.available && (
                  <Alert variant='destructive'>
                    <AlertDescription>
                      {t(
                        'Image generation is not available yet. Please try again later.'
                      )}
                    </AlertDescription>
                  </Alert>
                )}
                {options.data.models.length === 0 && (
                  <Alert>
                    <AlertDescription>
                      {t('No image models are available for your account.')}
                    </AlertDescription>
                  </Alert>
                )}
                <ImageForm
                  options={options.data}
                  reuse={reuse}
                  reference={reference}
                  referencePending={copyReference.isPending}
                  onReferenceStateChange={setReferenceState}
                  onCreated={(id) => {
                    previousJobs.current.set(id, 'queued')
                    void client.invalidateQueries({ queryKey })
                  }}
                />
              </>
            )}
            <section aria-label={t('Generated images')} className='space-y-4'>
              <h2 className='text-base font-semibold'>
                {t('Generated images')}
              </h2>
              <p className='text-muted-foreground text-sm'>
                {t(
                  'Images and history are saved in this browser until you delete them. Clearing browser data also removes them.'
                )}
              </p>
              {jobs.isPending && <LoadingState />}
              {jobs.isError && (
                <ErrorState onRetry={() => void jobs.refetch()} />
              )}
              {jobs.data?.some((job) => job.storage_error) && (
                <Alert variant='destructive'>
                  <AlertDescription>
                    {t(
                      'Could not save some images in this browser. Download them before closing this page.'
                    )}
                  </AlertDescription>
                </Alert>
              )}
              <ImageGallery
                jobs={jobs.data ?? []}
                busy={remove.isPending}
                canEdit={() =>
                  referenceState.enabled &&
                  referenceState.count < 4 &&
                  !copyReference.isPending
                }
                onReuse={(job) => {
                  setReference(null)
                  setReuse({
                    input: {
                      ...job.input,
                      reference_id: undefined,
                      reference_ids: undefined,
                    },
                    version: Date.now(),
                  })
                }}
                onReference={(job, assetID) =>
                  copyReference.mutateAsync({ job, assetID })
                }
                onDelete={(job) => {
                  remove.reset()
                  setDeleting({ kind: 'job', ids: [job.id] })
                }}
                onDeleteJobs={(ids) => {
                  remove.reset()
                  setDeleting({ kind: 'records', ids })
                }}
                onDeleteAssets={(ids) => {
                  remove.reset()
                  setDeleting({ kind: 'images', ids })
                }}
                onClearAll={() => {
                  remove.reset()
                  setDeleting({
                    kind: 'all',
                    ids: (jobs.data ?? [])
                      .filter((job) => !isImageJobActive(job))
                      .map((job) => job.id),
                  })
                }}
              />
              {jobs.data?.length === 0 && (
                <EmptyState
                  icon={Images}
                  title={t('No images yet')}
                  description={t('Your recent generations will appear here.')}
                />
              )}
            </section>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={deleteTitle}
        desc={deleteDescription}
        destructive
        confirmText={deleting?.kind === 'all' ? t('Clear all') : t('Delete')}
        isLoading={remove.isPending}
        handleConfirm={() => {
          if (deleting) remove.mutate(deleting)
        }}
      >
        {remove.isError && (
          <Alert variant='destructive'>
            <AlertDescription>
              {t(getServerErrorMessage(remove.error))}
            </AlertDescription>
          </Alert>
        )}
      </ConfirmDialog>
    </>
  )
}
