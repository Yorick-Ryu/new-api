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
import { useTranslation } from 'react-i18next'

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import { cash, type Overview } from './api'

export function CommissionComposition(props: { data: Overview }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const parts = [
    {
      label: 'Available commission',
      amount: props.data.available_cents,
      color: 'bg-emerald-500',
    },
    {
      label: 'Settling',
      amount: props.data.frozen_cents,
      color: 'bg-amber-500',
    },
    {
      label: 'Withdrawing',
      amount: props.data.processing_cents,
      color: 'bg-blue-500',
    },
    {
      label: 'Paid out',
      amount: props.data.paid_cents,
      color: 'bg-violet-500',
    },
  ]
  const total = parts.reduce((sum, part) => sum + Math.max(0, part.amount), 0)
  return (
    <div
      className='mt-3 space-y-3'
      role='group'
      aria-label={t('Commission ledger')}
    >
      <div className='bg-muted flex h-2 w-full overflow-hidden rounded-full'>
        {parts
          .filter((part) => part.amount > 0)
          .map((part) => {
            const percent = (part.amount / total) * 100
            const description = `${t(part.label)} · ${cash(part.amount, locale)} · ${formatNumber(Math.round(percent * 10) / 10, locale)}%`
            return (
              <Tooltip key={part.label}>
                <TooltipTrigger
                  delay={0}
                  tabIndex={0}
                  aria-label={description}
                  className={cn(
                    'h-full shrink-0 cursor-help focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground',
                    part.color
                  )}
                  style={{ width: `${percent}%` }}
                />
                <TooltipContent>{description}</TooltipContent>
              </Tooltip>
            )
          })}
      </div>
      <dl className='grid grid-cols-2 gap-x-3 gap-y-2'>
        {parts.map((part) => (
          <div key={part.label} className='min-w-0 space-y-1'>
            <dt className='text-muted-foreground flex items-center gap-1.5 text-xs'>
              <span
                aria-hidden='true'
                className={cn('size-2 shrink-0 rounded-sm', part.color)}
              />
              {t(part.label)}
            </dt>
            <dd className='text-foreground font-mono text-sm font-semibold break-all tabular-nums'>
              {cash(part.amount, locale)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
