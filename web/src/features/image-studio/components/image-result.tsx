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
import { useMutation, useQueries } from '@tanstack/react-query'
import { Download, ImagePlus, Images, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { useAuthStore } from '@/stores/auth-store'

import { getImageURL, isImageJobActive, type ImageJob } from '../api'

type ImageResultProps = {
  job?: ImageJob
  canEdit: boolean
  onReuse: (job: ImageJob) => void
  onReference: (job: ImageJob, assetId: string) => void
  onDelete: (job: ImageJob) => void
}

export function ImageResult(props: ImageResultProps) {
  const { t } = useTranslation()
  const userID = useAuthStore((state) => state.auth.user?.id)
  const [preview, setPreview] = useState('')
  const [failedImages, setFailedImages] = useState<string[]>([])
  const download = useMutation({
    mutationFn: async (id: string) => {
      const url = await getImageURL(id, true)
      const link = document.createElement('a')
      link.href = url
      link.download = 'image'
      link.rel = 'noopener'
      link.click()
    },
  })
  const job = props.job
  const originals =
    job?.assets.filter((asset) => asset.kind === 'original') ?? []
  const imageURLs = useQueries({
    queries: originals.map((asset) => ({
      queryKey: ['image-studio-asset', userID, asset.id],
      queryFn: () => getImageURL(asset.id),
      initialData: asset.url || undefined,
      staleTime: 5 * 60 * 1000,
      retry: false,
      enabled: !asset.unavailable,
    })),
  })
  const dimensions = /^(\d+)x(\d+)$/.exec(job?.input.size ?? '')
  const aspectRatio = dimensions
    ? `${dimensions[1]} / ${dimensions[2]}`
    : '1 / 1'
  const statusLabels: Record<string, string> = {
    queued: t('Queued'),
    running: t('Generating…'),
    saving: t('Saving image…'),
    success: t('Completed'),
    failed: t('Failed'),
    unknown: t('Result unconfirmed'),
    expired: t('Image unavailable'),
  }

  return (
    <Card className='min-w-0' data-card-hover='false'>
      <CardHeader className='flex-row items-center justify-between'>
        <CardTitle>{t('Generated images')}</CardTitle>
        {job && (
          <Badge variant='secondary'>
            {statusLabels[job.status] ?? job.status}
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        {!job && (
          <EmptyState
            icon={Images}
            title={t('Your next image starts here')}
            description={t(
              'Write a prompt, choose a model, and generate your first image.'
            )}
          />
        )}
        {job && isImageJobActive(job) && (
          <div
            role='status'
            aria-live='polite'
            className='space-y-4 motion-reduce:[&_.animate-spin]:animate-none'
          >
            <div className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
              {Array.from({ length: job.input.n }, (_, index) => (
                <div
                  key={index}
                  className='relative overflow-hidden rounded-lg'
                  style={{ aspectRatio }}
                >
                  <Skeleton className='absolute inset-0 motion-reduce:animate-none' />
                  <div className='absolute inset-0 flex flex-col items-center justify-center gap-3 p-3'>
                    <LoadingState
                      inline
                      size='sm'
                      message={statusLabels[job.status]}
                    />
                    <Badge variant='secondary' className='max-w-full truncate'>
                      {job.input.model}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
            <p className='text-muted-foreground text-sm'>
              {t('You can leave this page and return to view the result.')}
            </p>
          </div>
        )}
        {job && !isImageJobActive(job) && originals.length === 0 && (
          <EmptyState
            icon={Images}
            title={statusLabels[job.status]}
            description={
              job.error
                ? t(job.error)
                : t('Generate again using the saved prompt and parameters.')
            }
          />
        )}
        {originals.length > 0 && (
          <div className='grid grid-cols-1 gap-4 xl:grid-cols-2'>
            {originals.map((asset, index) => (
              <div
                key={asset.id}
                className='motion-safe:animate-in motion-safe:fade-in-0 min-w-0 space-y-3 motion-safe:duration-300'
              >
                <Button
                  variant='ghost'
                  className='bg-muted/40 h-auto w-full overflow-hidden p-0'
                  aria-label={t('Preview generated image')}
                  disabled={!imageURLs[index]?.data}
                  onClick={() => setPreview(imageURLs[index]?.data ?? '')}
                >
                  {!asset.unavailable && imageURLs[index]?.isPending && (
                    <Skeleton className='aspect-square w-full motion-reduce:animate-none' />
                  )}
                  {asset.unavailable && (
                    <span className='p-8 text-sm whitespace-normal'>
                      {t(
                        'This image was not saved in this browser and is no longer available. You can generate it again using the saved prompt.'
                      )}
                    </span>
                  )}
                  {(failedImages.includes(asset.id) ||
                    imageURLs[index]?.isError) && (
                    <span className='p-12'>{t('Failed to load image')}</span>
                  )}
                  {imageURLs[index]?.data &&
                    !failedImages.includes(asset.id) && (
                      <img
                        src={imageURLs[index].data}
                        alt={t('Generated image')}
                        className='max-h-[520px] w-full object-contain'
                        onError={() =>
                          setFailedImages((current) => [...current, asset.id])
                        }
                      />
                    )}
                </Button>
                <div className='flex flex-wrap gap-2'>
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={download.isPending || !!asset.unavailable}
                    onClick={() => download.mutate(asset.id)}
                  >
                    <Download className='size-4' />
                    {t('Download')}
                  </Button>
                  {props.canEdit && job && (
                    <Button
                      variant='outline'
                      size='sm'
                      disabled={!!asset.unavailable}
                      onClick={() => props.onReference(job, asset.id)}
                    >
                      <ImagePlus className='size-4' />
                      {t('Use as reference')}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {job && (
          <div className='mt-6 space-y-3 border-t pt-4'>
            <p className='text-muted-foreground text-xs'>{job.input.model}</p>
            {job.quota !== undefined && (
              <p className='text-muted-foreground text-xs'>
                {t('Actual cost')}: {formatQuotaWithCurrency(job.quota)}
              </p>
            )}
            <p className='max-h-40 overflow-y-auto text-sm break-words whitespace-pre-wrap'>
              {job.input.prompt}
            </p>
            <div className='flex flex-wrap gap-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => props.onReuse(job)}
              >
                <RotateCcw className='size-4' />
                {t('Reuse parameters')}
              </Button>
              <Button
                variant='ghost'
                size='sm'
                disabled={isImageJobActive(job)}
                onClick={() => props.onDelete(job)}
              >
                <Trash2 className='size-4' />
                {t('Delete')}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreview('')
        }}
        title={t('Image Preview')}
        description={t('Generated image')}
        contentClassName='sm:max-w-4xl'
        contentHeight='auto'
      >
        {preview && (
          <img
            src={preview}
            alt={t('Generated image')}
            className='max-h-[75vh] w-full object-contain'
          />
        )}
      </Dialog>
    </Card>
  )
}
