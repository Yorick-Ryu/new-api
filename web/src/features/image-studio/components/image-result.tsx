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
import { Download, ImagePlus, Info, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { toIntlLocale } from '@/i18n/languages'
import { formatQuotaWithCurrency } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { getLobeIcon } from '@/lib/lobe-icon'
import { resolveModelProvider } from '@/lib/model-provider'
import { cn } from '@/lib/utils'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { isImageJobActive, type ImageJob } from '../api'
import { downloadImages } from '../lib/download-images'
import { ImageAssetView } from './image-asset-view'
import { ImageViewer } from './image-viewer'

type ImageResultProps = {
  job: ImageJob
  canEdit: boolean
  busy?: boolean
  selected?: boolean
  onSelect?: () => void
  onReuse: (job: ImageJob) => void
  onReference: (job: ImageJob, assetId: string) => void | Promise<unknown>
  onDelete: (job: ImageJob) => void
  onDeleteAssets?: (ids: string[]) => void
}

export function ImageResult(props: ImageResultProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  useSystemConfigStore((state) => state.config.currency)
  const [open, setOpen] = useState(false)
  const [initialSlide, setInitialSlide] = useState<number | null>(null)
  const [slide, setSlide] = useState(0)
  const job = props.job
  const provider = resolveModelProvider(job.input.model)
  const originals = job.assets.filter((asset) => asset.kind === 'original')
  const active = isImageJobActive(job)
  const overview = initialSlide === null && originals.length > 1
  const current = originals[Math.min(slide, originals.length - 1)]
  const downloadable = originals.filter((asset) => !asset.unavailable)
  const download = useMutation({ mutationFn: downloadImages })
  const reference = useMutation({
    mutationFn: async () => {
      if (current) await props.onReference(job, current.id)
    },
    onSuccess: () => setOpen(false),
  })
  const statusLabels: Record<string, string> = {
    queued: t('Queued'),
    running: t('Generating…'),
    saving: t('Saving image…'),
    success: t('Completed'),
    failed: t('Failed'),
    unknown: t('Result unconfirmed'),
    expired: t('Image unavailable'),
  }
  const status = statusLabels[job.status] ?? job.status
  const qualityLabels: Record<string, string> = {
    low: t('Low'),
    medium: t('Medium'),
    high: t('High'),
    hd: t('HD'),
    standard: t('Standard'),
  }
  const created = new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(job.created_at * 1000))
  const openDetails = () => {
    setInitialSlide(null)
    setSlide(0)
    setOpen(true)
  }
  return (
    <>
      <Card
        size='sm'
        role='article'
        aria-label={job.input.prompt}
        data-card-hover='false'
        className={cn(
          'relative min-w-0 gap-0 overflow-hidden py-0 data-[size=sm]:gap-0 data-[size=sm]:py-0',
          props.selected && 'ring-primary ring-2'
        )}
        onClickCapture={
          props.selected === undefined
            ? undefined
            : (event) => {
                if (
                  (event.target as HTMLElement).closest('[data-record-actions]')
                ) {
                  return
                }
                event.preventDefault()
                event.stopPropagation()
                if (!active && !props.busy) props.onSelect?.()
              }
        }
      >
        <Button
          variant='ghost'
          className='bg-muted/40 relative h-auto w-full overflow-hidden rounded-none p-0'
          aria-label={t('Preview generated image')}
          onClick={openDetails}
        >
          {originals[0] ? (
            <ImageAssetView asset={originals[0]} cover />
          ) : (
            <div
              role={active ? 'status' : undefined}
              className={cn(
                'relative flex aspect-square w-full items-center justify-center p-3',
                active && 'image-studio-pending'
              )}
            >
              {active ? (
                <span className='sr-only'>{status}</span>
              ) : (
                <span className='text-muted-foreground text-sm whitespace-normal'>
                  {status}
                </span>
              )}
            </div>
          )}
          <Badge
            variant='secondary'
            className='absolute end-2 bottom-2 max-w-[calc(100%-1rem)] truncate font-mono tabular-nums'
          >
            {t('{{amount}} images', {
              amount: formatNumber(originals.length || job.input.n, locale),
            })}
          </Badge>
        </Button>
        {props.selected !== undefined && !active && (
          <Checkbox
            className='bg-background absolute start-2 top-2'
            checked={props.selected}
            disabled={props.busy}
            aria-label={t('Select generation: {{prompt}}', {
              prompt: job.input.prompt,
            })}
            onCheckedChange={() => props.onSelect?.()}
          />
        )}
        <CardContent className='flex min-w-0 flex-col gap-2 p-3'>
          <p className='truncate text-xs' title={job.input.prompt}>
            {job.input.prompt}
          </p>
          <div className='text-muted-foreground flex min-w-0 flex-wrap justify-between gap-x-2 gap-y-1 text-xs'>
            <span
              className='flex min-w-0 items-center gap-1'
              title={job.input.model}
            >
              {provider && (
                <span className='flex shrink-0' aria-hidden='true'>
                  {getLobeIcon(provider.icon, 14)}
                </span>
              )}
              <span className='truncate'>{job.input.model}</span>
            </span>
            <time dateTime={new Date(job.created_at * 1000).toISOString()}>
              {created}
            </time>
          </div>
          <span className='sr-only'>{status}</span>
          <div
            data-record-actions
            className='grid grid-cols-1 gap-2 sm:grid-cols-2'
          >
            <Button
              variant='outline'
              size='sm'
              className='min-w-0'
              onClick={openDetails}
            >
              <Info />
              <span className='truncate'>{t('Details')}</span>
            </Button>
            <Button
              variant='outline'
              size='sm'
              className='min-w-0'
              disabled={download.isPending || !downloadable.length}
              onClick={() =>
                download.mutate(downloadable.map((asset) => asset.id))
              }
            >
              <Download />
              <span className='truncate'>{t('Download')}</span>
            </Button>
          </div>
        </CardContent>
      </Card>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('Image details')}
        contentClassName='sm:max-w-4xl'
      >
        <div className='grid min-w-0 gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]'>
          <div className='min-w-0'>
            {!originals.length &&
              (active ? (
                <div
                  role='status'
                  className='image-studio-pending relative aspect-square w-full overflow-hidden'
                >
                  <span className='sr-only'>{status}</span>
                </div>
              ) : (
                <EmptyState
                  className='min-h-0 py-6 md:p-6'
                  title={status}
                  description={job.error ? t(job.error) : undefined}
                />
              ))}
            {overview && (
              <div className='grid grid-cols-2 gap-3'>
                {originals.map((asset, index) => (
                  <Button
                    key={asset.id}
                    variant='ghost'
                    className='bg-muted relative h-auto overflow-hidden p-0'
                    aria-label={t('View image {{number}}', {
                      number: formatNumber(index + 1, locale),
                    })}
                    onClick={() => {
                      setInitialSlide(index)
                      setSlide(index)
                    }}
                  >
                    <ImageAssetView asset={asset} cover />
                    <Badge
                      variant='secondary'
                      className='absolute end-2 bottom-2 font-mono tabular-nums'
                    >
                      {formatNumber(index + 1, locale)}/
                      {formatNumber(originals.length, locale)}
                    </Badge>
                  </Button>
                ))}
              </div>
            )}
            {!overview && originals.length > 0 && (
              <ImageViewer
                key={originals.map((asset) => asset.id).join(',')}
                assets={originals}
                initialIndex={Math.min(initialSlide ?? 0, originals.length - 1)}
                onSelect={setSlide}
              />
            )}
          </div>
          <div className='flex min-w-0 flex-col gap-4'>
            <p className='max-h-40 overflow-y-auto text-sm break-words whitespace-pre-wrap'>
              {job.input.prompt}
            </p>
            <dl className='grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm'>
              <dt className='text-muted-foreground'>{t('Model')}</dt>
              <dd className='flex min-w-0 items-center gap-1.5'>
                {provider && (
                  <span className='flex shrink-0' aria-hidden='true'>
                    {getLobeIcon(provider.icon, 16)}
                  </span>
                )}
                <span className='min-w-0 break-words'>{job.input.model}</span>
              </dd>
              <dt className='text-muted-foreground'>{t('Image size')}</dt>
              <dd>{job.input.size?.replace('x', '×') || t('Auto')}</dd>
              <dt className='text-muted-foreground'>{t('Quality')}</dt>
              <dd>{qualityLabels[job.input.quality] ?? t('Auto')}</dd>
              <dt className='text-muted-foreground'>{t('Number of images')}</dt>
              <dd className='font-mono tabular-nums'>
                {formatNumber(job.input.n, locale)}
              </dd>
              <dt className='text-muted-foreground'>{t('Generation cost')}</dt>
              <dd className='font-mono break-words tabular-nums'>
                {job.quota === undefined
                  ? t('Result unconfirmed')
                  : formatQuotaWithCurrency(job.quota, { locale })}
              </dd>
              <dt className='text-muted-foreground'>{t('Created time')}</dt>
              <dd>{created}</dd>
            </dl>
            <div className='flex flex-wrap gap-2'>
              <Button
                variant='outline'
                size='sm'
                disabled={
                  download.isPending ||
                  (overview
                    ? !downloadable.length
                    : !current || !!current.unavailable)
                }
                onClick={() =>
                  download.mutate(
                    overview
                      ? downloadable.map((asset) => asset.id)
                      : [current.id]
                  )
                }
              >
                <Download />
                {overview ? t('Download all') : t('Download image')}
              </Button>
              <Button
                variant='outline'
                size='sm'
                disabled={props.busy || reference.isPending}
                onClick={() => {
                  props.onReuse(job)
                  setOpen(false)
                }}
              >
                <RotateCcw />
                {t('Reuse parameters')}
              </Button>
              <Button
                variant='destructive'
                size='sm'
                disabled={props.busy || active || reference.isPending}
                onClick={() => {
                  if (!overview && originals.length > 1) {
                    props.onDeleteAssets?.([current.id])
                  } else props.onDelete(job)
                }}
              >
                <Trash2 />
                {overview ? t('Delete all') : t('Delete image')}
              </Button>
              {!overview && current && (
                <Button
                  variant='outline'
                  size='sm'
                  disabled={
                    !props.canEdit ||
                    props.busy ||
                    reference.isPending ||
                    current.unavailable
                  }
                  onClick={() => reference.mutate()}
                >
                  <ImagePlus />
                  {t('Use as reference')}
                </Button>
              )}
            </div>
          </div>
        </div>
      </Dialog>
    </>
  )
}
