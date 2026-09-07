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
import dayjs from 'dayjs'
import { useId, useMemo, useState, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  formatLatency,
  formatUptimePct,
} from '@/features/performance-metrics/lib/format'
import { cn } from '@/lib/utils'

import {
  fillStatusTimeline,
  getServiceHealth,
  HEALTH_CLASSES,
} from '../lib/status'
import type { ServiceStatusHours, StatusModel } from '../types'

type StatusTimelineProps = {
  model: StatusModel
  start: number
  end: number
  step: number
  hours: ServiceStatusHours
}

export function StatusTimeline(props: StatusTimelineProps) {
  const { t } = useTranslation()
  const tooltipId = useId()
  const triggerId = useId()
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null)
  const points = useMemo(
    () =>
      fillStatusTimeline(
        props.model.series,
        props.start,
        props.end,
        props.step
      ),
    [props.model.series, props.start, props.end, props.step]
  )
  const [selected, setSelected] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const index = Math.min(selected ?? points.length - 1, points.length - 1)
  const point = points[index]
  if (!point) return null

  const interval = `${dayjs.unix(point.ts).format('MM/DD HH:mm')} – ${dayjs.unix(Math.min(point.ts + props.step, props.end)).format('MM/DD HH:mm')}`

  function selectInterval(event: PointerEvent<HTMLButtonElement>) {
    if (pinned) return
    const bounds = event.currentTarget.getBoundingClientRect()
    if (bounds.width === 0) return
    setSelected(
      Math.max(
        0,
        Math.min(
          points.length - 1,
          Math.floor(
            ((event.clientX - bounds.left) / bounds.width) * points.length
          )
        )
      )
    )
    setOpen(true)
  }

  return (
    <div>
      <Tooltip
        open={open}
        triggerId={triggerId}
        onOpenChange={(next, details) => {
          if (details.reason === 'trigger-press') {
            details.cancel()
            return
          }
          if (!pinned) setOpen(next)
        }}
      >
        <TooltipTrigger
          id={triggerId}
          render={
            <button
              type='button'
              className='flex min-h-6 w-full items-center rounded-sm outline-offset-4 pointer-coarse:min-h-11'
              aria-describedby={open ? tooltipId : undefined}
              aria-label={t(
                'Request history for {{model}}. Use arrow keys to select an interval.',
                { model: props.model.model_name }
              )}
              onPointerMove={selectInterval}
              onPointerDown={selectInterval}
              onClick={() => {
                setPinned(!pinned)
                setOpen(!pinned)
              }}
              onBlur={() => {
                setPinned(false)
                setOpen(false)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setPinned(false)
                  setOpen(false)
                }
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault()
                  setSelected(
                    Math.max(
                      0,
                      Math.min(
                        points.length - 1,
                        index + (event.key === 'ArrowLeft' ? -1 : 1)
                      )
                    )
                  )
                  setOpen(true)
                }
              }}
            />
          }
        >
          <span className='flex h-5 w-full gap-[2px]' aria-hidden='true'>
            {points.map((item) => (
              <span
                key={item.ts}
                ref={item.ts === point.ts ? setAnchor : undefined}
                className={cn(
                  'min-w-0 flex-1 rounded-[2px]',
                  HEALTH_CLASSES[getServiceHealth(item.success_rate)]
                )}
              />
            ))}
          </span>
        </TooltipTrigger>
        <TooltipContent
          id={tooltipId}
          role='tooltip'
          anchor={anchor}
          className='block max-w-[220px] space-y-0.5 px-2 py-1.5 text-[11px] leading-4'
          side='top'
        >
          <p className='font-mono'>{interval}</p>
          {point.success_rate === null && (
            <p>{t('No requests in this interval')}</p>
          )}
          {point.success_rate !== null && (
            <>
              <p>
                {t('Success rate')}: {formatUptimePct(point.success_rate)}
              </p>
              <p>
                {t('Cache rate')}:{' '}
                {formatUptimePct(point.cache_hit_rate ?? Number.NaN)}
              </p>
              {point.avg_ttft_ms !== null && (
                <p>
                  {t('TTFT')}: {formatLatency(point.avg_ttft_ms)}
                </p>
              )}
              {point.avg_latency_ms !== null && (
                <p>
                  {t('Average duration')}: {formatLatency(point.avg_latency_ms)}
                </p>
              )}
            </>
          )}
        </TooltipContent>
      </Tooltip>
      <div className='mt-0.5 flex justify-between text-[11px] text-neutral-500 tabular-nums dark:text-neutral-400'>
        <time
          dateTime={dayjs.unix(props.start).toISOString()}
          title={dayjs.unix(props.start).format('MM/DD HH:mm')}
        >
          {props.hours === 24
            ? t('{{count}}h ago', { count: 24 })
            : t('{{count}}d ago', { count: props.hours / 24 })}
        </time>
        <time
          dateTime={dayjs.unix(props.end).toISOString()}
          title={dayjs.unix(props.end).format('MM/DD HH:mm')}
        >
          {t('Now')}
        </time>
      </div>
    </div>
  )
}
