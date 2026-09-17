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
import { VChart } from '@visactor/react-vchart'
import { AreaChart, BarChart3 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { useTheme } from '@/context/theme-provider'
import { CONSUMPTION_DISTRIBUTION_CHART_OPTIONS } from '@/features/dashboard/constants'
import { cn } from '@/lib/utils'
import { VCHART_OPTION } from '@/lib/vchart'

import { PanelTitle } from '../ui/panel-title'
import { buildBusinessTrend } from './business-trend'
import type { BusinessDashboardData } from './types'

export function BusinessDetails(props: {
  data: Pick<BusinessDashboardData, 'daily' | 'plans'>
  loading?: boolean
}) {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const [chartType, setChartType] = useState<'bar' | 'area'>('bar')
  const chart = useMemo(
    () => buildBusinessTrend(props.data, chartType, t),
    [props.data, chartType, t]
  )
  return (
    <div className='p-4 sm:p-5'>
      <div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
        <PanelTitle title={t('Trend')} icon={BarChart3} iconTone='info' />
        <div className='bg-muted/60 inline-flex h-7 overflow-x-auto rounded-lg border p-0.5 sm:h-8'>
          {CONSUMPTION_DISTRIBUTION_CHART_OPTIONS.map((option) => {
            const Icon = option.value === 'bar' ? BarChart3 : AreaChart
            return (
              <button
                key={option.value}
                type='button'
                aria-pressed={chartType === option.value}
                onClick={() => setChartType(option.value)}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  chartType === option.value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className='size-3.5' aria-hidden='true' />
                {t(option.labelKey)}
              </button>
            )
          })}
        </div>
      </div>
      {props.loading && <Skeleton className='h-[300px] w-full sm:h-96' />}
      {!props.loading && chart.hasActivity && (
        <div
          role='img'
          aria-label={t('Business trends')}
          className='h-[300px] min-w-0 sm:h-96'
        >
          <VChart
            key={`${chartType}-${resolvedTheme}`}
            spec={{ ...chart.spec, theme: resolvedTheme }}
            option={VCHART_OPTION}
          />
        </div>
      )}
      {!props.loading && !chart.hasActivity && (
        <div className='text-muted-foreground flex h-64 items-center justify-center text-sm'>
          {t('No business activity in this period')}
        </div>
      )}
    </div>
  )
}
