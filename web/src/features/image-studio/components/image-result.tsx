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
import {
  CircleAlert,
  CircleHelp,
  Download,
  ImageOff,
  LoaderCircle,
  ImagePlus,
  Info,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
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
  const thumbnailButtons = useRef<Array<HTMLButtonElement | null>>([])
  const [selectedSlotID, setSelectedSlotID] = useState<string | null>(null)
  const job = props.job
  const provider = resolveModelProvider(job.input.model)
  const originals = job.assets.filter((asset) => asset.kind === 'original')
  const active = isImageJobActive(job)
  const statusIcons: Record<string, typeof CircleAlert> = {
    failed: CircleAlert,
    unknown: CircleHelp,
    expired: ImageOff,
    partial: CircleAlert,
  }
  const StatusIcon = statusIcons[job.status]
  // Hidden/deleted local images must not reappear as empty group slots.
  const slots =
    job.items?.filter(
      (item) =>
        !item.asset_id || originals.some((asset) => asset.id === item.asset_id)
    ) ??
    originals.map((asset) => ({
      id: asset.id,
      asset_id: asset.id,
      status: 'success',
      error: undefined,
    }))
  const selectedSlot =
    slots.find((item) => item.id === selectedSlotID) ?? slots[0]
  const current = selectedSlot
    ? originals.find((asset) => asset.id === selectedSlot.asset_id)
    : originals[0]
  const selectedStatus = selectedSlot?.status ?? job.status
  const ResultState = selectedStatus === 'failed' ? ErrorState : EmptyState
  const selectedPending = ['queued', 'running', 'saving'].includes(
    selectedStatus
  )
  const completed = slots.filter((item) => item.status === 'success').length
  useEffect(() => {
    if (!open || slots.length < 2) return
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      if (
        (event.target as HTMLElement).closest(
          'input,textarea,[contenteditable="true"],[role="alertdialog"]'
        )
      ) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const count = Math.min(slots.length, 4)
      const index = slots.findIndex((item) => item.id === selectedSlot?.id)
      const next = (index + (event.key === 'ArrowUp' ? -1 : 1) + count) % count
      setSelectedSlotID(slots[next].id)
      thumbnailButtons.current[next]?.focus()
    }
    document.addEventListener('keydown', keydown, true)
    return () => document.removeEventListener('keydown', keydown, true)
  }, [open, slots, selectedSlot?.id])
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
    partial: t('Partially completed'),
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
    setSelectedSlotID(null)
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
          className='bg-muted/40 relative h-auto w-full overflow-hidden rounded-none border-0 p-0'
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
                <span className='text-muted-foreground flex items-center justify-center gap-2 text-sm whitespace-normal'>
                  {StatusIcon && (
                    <StatusIcon
                      className={cn(
                        'size-4 shrink-0',
                        job.status === 'failed' && 'text-destructive'
                      )}
                      aria-hidden='true'
                    />
                  )}
                  {status}
                </span>
              )}
            </div>
          )}
          <Badge
            variant='secondary'
            className='absolute end-2 bottom-2 max-w-[calc(100%-1rem)] min-w-[5rem] justify-center gap-1 truncate font-mono tabular-nums'
          >
            {job.items ? (
              <>
                {active && (
                  <LoaderCircle
                    className='size-3 motion-safe:animate-spin'
                    aria-hidden='true'
                  />
                )}
                {!active && StatusIcon && (
                  <StatusIcon className='size-3' aria-label={status} />
                )}
                <span>{t('Completed')}</span>
                <span className='inline-block w-[3ch] text-center font-mono tabular-nums'>
                  {formatNumber(completed, locale)}/
                  {formatNumber(slots.length, locale)}
                </span>
              </>
            ) : (
              t('{{amount}} images', {
                amount: formatNumber(originals.length || job.input.n, locale),
              })
            )}
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
          <div className='text-foreground flex min-w-0 flex-wrap justify-between gap-x-2 gap-y-1 text-xs'>
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
          <div className='flex min-w-0 items-stretch gap-3 self-start'>
            <div
              className='bg-muted/40 flex aspect-square min-w-0 flex-1 items-center justify-center overflow-hidden rounded-lg [&_img]:h-full [&_img]:max-h-full'
              aria-label={t('Image Preview')}
              role='region'
            >
              {current && <ImageAssetView key={current.id} asset={current} />}
              {!current && selectedPending && (
                <div
                  role='status'
                  className='image-studio-pending relative aspect-square w-full overflow-hidden'
                >
                  <span className='sr-only'>
                    {statusLabels[selectedStatus] ?? selectedStatus}
                  </span>
                </div>
              )}
              {!current && !selectedPending && (
                <ResultState
                  icon={statusIcons[selectedStatus]}
                  className={cn(
                    'min-h-0 p-3',
                    '[&_[data-slot=empty-header]]:flex-row [&_[data-slot=empty-header]]:flex-wrap [&_[data-slot=empty-header]]:justify-center',
                    '[&_[data-slot=empty-icon]]:mb-0 [&_[data-slot=empty-icon]]:size-4 [&_[data-slot=empty-icon]]:bg-transparent [&_[data-slot=empty-icon]_svg]:size-4',
                    '[&_[data-slot=empty-description]]:basis-full [&_[data-slot=empty-content]:empty]:hidden'
                  )}
                  title={statusLabels[selectedStatus] ?? selectedStatus}
                  description={
                    selectedSlot?.error || job.error
                      ? t(selectedSlot?.error || job.error || '')
                      : undefined
                  }
                />
              )}
            </div>
            {slots.length > 1 && (
              <div className='relative w-[18%] max-w-20 shrink-0'>
                <div className='absolute inset-0 grid grid-rows-4 gap-2'>
                  {slots.slice(0, 4).map((item, index) => {
                    const asset = originals.find(
                      (image) => image.id === item.asset_id
                    )
                    const pending = ['queued', 'running', 'saving'].includes(
                      item.status
                    )
                    const Icon = statusIcons[item.status] ?? ImageOff
                    return (
                      <Button
                        key={item.id}
                        ref={(element) => {
                          thumbnailButtons.current[index] = element
                        }}
                        variant='ghost'
                        aria-label={t('View image {{number}}', {
                          number: formatNumber(index + 1, locale),
                        })}
                        aria-pressed={selectedSlot?.id === item.id}
                        className={cn(
                          'bg-muted relative h-full min-h-0 w-full overflow-hidden rounded-md border-0 p-0 [&_img]:h-full',
                          selectedSlot?.id === item.id &&
                            'after:ring-primary after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:ring-2 after:ring-inset'
                        )}
                        onClick={() => setSelectedSlotID(item.id)}
                      >
                        {asset ? (
                          <ImageAssetView key={asset.id} asset={asset} cover />
                        ) : (
                          <span
                            role={pending ? 'status' : undefined}
                            aria-label={t('Image {{number}}: {{status}}', {
                              number: formatNumber(index + 1, locale),
                              status: statusLabels[item.status] ?? item.status,
                            })}
                            className={cn(
                              'flex size-full items-center justify-center',
                              pending && 'image-studio-pending'
                            )}
                          >
                            {!pending && (
                              <Icon
                                className={cn(
                                  'size-5',
                                  item.status === 'failed' && 'text-destructive'
                                )}
                                aria-hidden='true'
                              />
                            )}
                          </span>
                        )}
                      </Button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
          <div className='flex min-w-0 flex-col gap-4'>
            <p className='max-h-40 overflow-y-auto text-sm break-words whitespace-pre-wrap'>
              {job.input.prompt}
            </p>
            <dl className='grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm'>
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
                  download.isPending || !current || !!current.unavailable
                }
                onClick={() => current && download.mutate([current.id])}
              >
                <Download />
                {t('Download image')}
              </Button>
              {slots.length > 1 && (
                <Button
                  variant='outline'
                  size='sm'
                  disabled={download.isPending || !downloadable.length}
                  onClick={() =>
                    download.mutate(downloadable.map((asset) => asset.id))
                  }
                >
                  <Download />
                  {t('Download all')}
                </Button>
              )}
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
                disabled={
                  props.busy ||
                  active ||
                  reference.isPending ||
                  (slots.length > 1 && (!current || !props.onDeleteAssets))
                }
                onClick={() => {
                  if (slots.length > 1 && current) {
                    props.onDeleteAssets?.([current.id])
                  } else props.onDelete(job)
                }}
              >
                <Trash2 />
                {t('Delete image')}
              </Button>
              {slots.length > 1 && (
                <Button
                  variant='destructive'
                  size='sm'
                  disabled={props.busy || active || reference.isPending}
                  onClick={() => props.onDelete(job)}
                >
                  <Trash2 />
                  {t('Delete all')}
                </Button>
              )}
              {current && (
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
