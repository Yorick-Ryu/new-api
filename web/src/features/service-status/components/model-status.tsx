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
import { Box } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  formatLatency,
  formatThroughput,
  formatUptimePct,
} from '@/features/performance-metrics/lib/format'
import { getLobeIcon } from '@/lib/lobe-icon'

import type { ServiceStatusHours, StatusModel } from '../types'
import { StatusTimeline } from './status-timeline'

const BRAND_ICONS: Record<string, string> = {
  'gpt-': 'OpenAI',
  'codex-': 'OpenAI',
  'claude-': 'Claude.Color',
  'grok-': 'Grok',
  'deepseek-': 'DeepSeek.Color',
  'glm-': 'Zhipu.Color',
  'minimax-': 'Minimax.Color',
  'longcat-': 'LongCat.Color',
}

export function ModelStatus(props: {
  model: StatusModel
  start: number
  end: number
  step: number
  hours: ServiceStatusHours
}) {
  const { t } = useTranslation()
  const model = props.model
  let icon = model.icon
  if (!icon) {
    const name = model.model_name.toLowerCase()
    icon = Object.entries(BRAND_ICONS).find(([prefix]) =>
      name.startsWith(prefix)
    )?.[1]
  }
  const latencyOnly =
    model.success_rate !== null &&
    model.avg_ttft_ms === null &&
    model.avg_tps === null
  return (
    <article className='min-w-0' aria-label={model.model_name}>
      <h4 className='mb-1 flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight'>
        <span className='shrink-0' aria-hidden='true'>
          {icon ? getLobeIcon(icon, 16) : <Box className='size-4' />}
        </span>
        <span className='min-w-0 break-all'>{model.model_name}</span>
      </h4>
      <StatusTimeline
        model={model}
        start={props.start}
        end={props.end}
        step={props.step}
        hours={props.hours}
      />
      <dl className='text-foreground mt-1 flex flex-wrap justify-between gap-x-3 gap-y-1.5 text-[11px] tabular-nums [&_dd]:font-medium'>
        {latencyOnly ? (
          <div className='flex items-baseline gap-1.5 whitespace-nowrap'>
            <dt className='text-neutral-500 dark:text-neutral-400'>
              {t('Average duration')}
            </dt>
            <dd>{formatLatency(model.avg_latency_ms ?? Number.NaN)}</dd>
          </div>
        ) : (
          <>
            <div className='flex items-baseline gap-1.5 whitespace-nowrap'>
              <dt className='text-neutral-500 dark:text-neutral-400'>
                {t('TTFT')}
              </dt>
              <dd>
                {model.avg_ttft_ms === null
                  ? '—'
                  : `${(model.avg_ttft_ms / 1000).toFixed(2)}s`}
              </dd>
            </div>
            <div className='flex items-baseline gap-1.5 whitespace-nowrap'>
              <dt className='text-neutral-500 dark:text-neutral-400'>
                {t('Throughput (short)')}
              </dt>
              <dd>
                {formatThroughput(model.avg_tps ?? Number.NaN).replace(
                  't/s',
                  'tok/s'
                )}
              </dd>
            </div>
          </>
        )}
        <div className='flex items-baseline gap-1.5 whitespace-nowrap'>
          <dt className='text-neutral-500 dark:text-neutral-400'>
            {t('Cache rate')}
          </dt>
          <dd>{formatUptimePct(model.cache_hit_rate ?? Number.NaN)}</dd>
        </div>
        <div className='flex items-baseline gap-1.5 whitespace-nowrap'>
          <dt className='text-neutral-500 dark:text-neutral-400'>
            {t('Success rate')}
          </dt>
          <dd>
            {model.success_rate === null
              ? '—'
              : formatUptimePct(model.success_rate)}
          </dd>
        </div>
      </dl>
    </article>
  )
}
