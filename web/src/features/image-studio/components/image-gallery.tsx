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
import { useMutation } from '@tanstack/react-query'
import { Download, ListChecks, Trash2 } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { isImageJobActive, type ImageJob } from '../api'
import { downloadImages } from '../lib/download-images'
import { ImageResult } from './image-result'

type ImageGalleryProps = {
  jobs: ImageJob[]
  busy: boolean
  canEdit: (job: ImageJob) => boolean
  onReuse: (job: ImageJob) => void
  onReference: (job: ImageJob, assetID: string) => void | Promise<unknown>
  onDelete: (job: ImageJob) => void
  onDeleteJobs: (ids: string[]) => void
  onDeleteAssets: (ids: string[]) => void
  onClearAll: () => void
}
export function ImageGallery(props: ImageGalleryProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [selecting, setSelecting] = useState(false)
  const [checkedIDs, setCheckedIDs] = useState<string[]>([])
  const selectable = props.jobs.filter((job) => !isImageJobActive(job))
  const selected = selectable.filter((job) => checkedIDs.includes(job.id))
  const downloadIDs = selected.flatMap((job) =>
    job.assets
      .filter((asset) => asset.kind === 'original' && !asset.unavailable)
      .map((asset) => asset.id)
  )
  const download = useMutation({ mutationFn: downloadImages })
  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <Button
          variant='outline'
          size='sm'
          disabled={props.busy || (!selecting && !selectable.length)}
          onClick={() => {
            setSelecting(!selecting)
            setCheckedIDs([])
          }}
        >
          <ListChecks />
          {selecting ? t('Done') : t('Select records')}
        </Button>
        {selecting && (
          <>
            <Button
              variant='ghost'
              size='sm'
              disabled={props.busy || !selectable.length}
              onClick={() => setCheckedIDs(selectable.map((job) => job.id))}
            >
              {t('Select all')}
            </Button>
            <span className='text-muted-foreground text-xs' aria-live='polite'>
              {t('{{amount}} records selected', {
                amount: formatNumber(selected.length, locale),
              })}
            </span>
            <Button
              variant='outline'
              size='sm'
              disabled={props.busy || download.isPending || !downloadIDs.length}
              onClick={() => download.mutate(downloadIDs)}
            >
              <Download />
              {t('Download selected')}
            </Button>
            <Button
              variant='destructive'
              size='sm'
              disabled={props.busy || !selected.length}
              onClick={() => props.onDeleteJobs(selected.map((job) => job.id))}
            >
              <Trash2 />
              {t('Delete selected')}
            </Button>
          </>
        )}
        <Button
          variant='destructive'
          size='sm'
          className='ms-auto'
          disabled={props.busy || !selectable.length}
          onClick={props.onClearAll}
        >
          <Trash2 />
          {t('Clear all')}
        </Button>
      </div>
      <div className='grid auto-rows-[1px] grid-cols-2 items-start gap-x-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'>
        {props.jobs.map((job) => (
          <ImageGalleryItem key={job.id}>
            <ImageResult
              job={job}
              busy={props.busy}
              canEdit={props.canEdit(job)}
              onReuse={props.onReuse}
              onReference={props.onReference}
              onDelete={props.onDelete}
              onDeleteAssets={props.onDeleteAssets}
              selected={
                selecting
                  ? selected.some((item) => item.id === job.id)
                  : undefined
              }
              onSelect={() =>
                setCheckedIDs((ids) =>
                  ids.includes(job.id)
                    ? ids.filter((id) => id !== job.id)
                    : [...ids, job.id]
                )
              }
            />
          </ImageGalleryItem>
        ))}
      </div>
    </div>
  )
}

function ImageGalleryItem({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [rows, setRows] = useState(1)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () =>
      setRows(Math.max(1, Math.ceil(element.getBoundingClientRect().height)))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return (
    <div
      ref={ref}
      className='min-w-0 pb-3'
      style={{ gridRowEnd: `span ${rows}` }}
    >
      {children}
    </div>
  )
}
