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
import { ListChecks, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { isImageJobActive, type ImageAsset, type ImageJob } from '../api'

type ImageGalleryProps = {
  jobs: ImageJob[]
  selectedJobID?: string
  busy: boolean
  onSelectJob: (id: string) => void
  onDeleteAssets: (ids: string[]) => void
  onClearAll: () => void
}

export function ImageGallery(props: ImageGalleryProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [selecting, setSelecting] = useState(false)
  const [checkedIDs, setCheckedIDs] = useState<string[]>([])
  const items = props.jobs.flatMap<{
    id: string
    job: ImageJob
    asset?: ImageAsset
  }>((job) => {
    const originals = job.assets.filter((asset) => asset.kind === 'original')
    if (!originals.length) return [{ id: job.id, job, asset: undefined }]
    return originals.map((asset) => ({ id: asset.id, job, asset }))
  })
  const selectableIDs = items
    .filter((item) => item.asset && !isImageJobActive(item.job))
    .map((item) => item.id)
  const selectedIDs = checkedIDs.filter((id) => selectableIDs.includes(id))
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
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <Button
          variant='outline'
          size='sm'
          disabled={props.busy || (!selecting && !selectableIDs.length)}
          onClick={() => {
            setSelecting(!selecting)
            setCheckedIDs([])
          }}
        >
          <ListChecks className='size-4' />
          {selecting ? t('Done') : t('Select images')}
        </Button>
        {selecting && (
          <>
            <Button
              variant='ghost'
              size='sm'
              disabled={props.busy || !selectableIDs.length}
              onClick={() => setCheckedIDs(selectableIDs)}
            >
              {t('Select all images')}
            </Button>
            <span className='text-muted-foreground text-xs' aria-live='polite'>
              {t('{{amount}} images selected', {
                amount: formatNumber(selectedIDs.length, locale),
              })}
            </span>
            <Button
              variant='destructive'
              size='sm'
              disabled={props.busy || !selectedIDs.length}
              onClick={() => props.onDeleteAssets(selectedIDs)}
            >
              <Trash2 className='size-4' />
              {t('Delete selected images')}
            </Button>
          </>
        )}
        <Button
          variant='ghost'
          size='sm'
          className='ml-auto'
          disabled={
            props.busy || !props.jobs.some((job) => !isImageJobActive(job))
          }
          onClick={props.onClearAll}
        >
          <Trash2 className='size-4' />
          {t('Clear all')}
        </Button>
      </div>
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5'>
        {items.map((item, index) => {
          const thumbnail = item.job.assets.find(
            (asset) =>
              asset.kind === 'thumbnail' &&
              asset.id === item.asset?.id.replace(/-original$/, '-thumbnail')
          )
          const canSelect = !!item.asset && !isImageJobActive(item.job)
          const checked = selectedIDs.includes(item.id)
          return (
            <div key={item.id} className='relative min-w-0'>
              <Button
                variant='outline'
                aria-pressed={
                  selecting ? checked : props.selectedJobID === item.job.id
                }
                disabled={props.busy}
                onClick={() => {
                  if (selecting && canSelect) {
                    setCheckedIDs((ids) =>
                      checked
                        ? ids.filter((id) => id !== item.id)
                        : [...ids, item.id]
                    )
                  } else {
                    props.onSelectJob(item.job.id)
                  }
                }}
                className='aria-pressed:ring-primary h-auto w-full min-w-0 flex-col items-stretch overflow-hidden p-0 text-start aria-pressed:ring-2'
              >
                {thumbnail?.url ? (
                  <img
                    src={thumbnail.url}
                    alt={item.job.input.prompt}
                    loading='lazy'
                    className='bg-muted aspect-square w-full object-cover'
                  />
                ) : (
                  <div className='bg-muted/50 text-muted-foreground flex aspect-square items-center justify-center text-xs'>
                    {item.asset?.unavailable
                      ? t('Image unavailable')
                      : (statusLabels[item.job.status] ?? item.job.status)}
                  </div>
                )}
                <div className='w-full min-w-0 space-y-1 p-3'>
                  <p className='truncate text-xs font-normal'>
                    {item.job.input.prompt}
                  </p>
                  <p className='text-muted-foreground truncate text-[11px]'>
                    {item.job.input.model}
                  </p>
                </div>
              </Button>
              {selecting && canSelect && (
                <Checkbox
                  className='bg-background absolute top-3 left-3 size-5'
                  checked={checked}
                  disabled={props.busy}
                  aria-label={t('Select image {{number}}: {{prompt}}', {
                    number: formatNumber(index + 1, locale),
                    prompt: item.job.input.prompt,
                  })}
                  onCheckedChange={(value) =>
                    setCheckedIDs((ids) =>
                      value
                        ? [...ids.filter((id) => id !== item.id), item.id]
                        : ids.filter((id) => id !== item.id)
                    )
                  }
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
