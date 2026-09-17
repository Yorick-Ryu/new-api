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
import type { ICommonChartSpec, ITooltipLineActual } from '@visactor/vchart'
import type { TFunction } from 'i18next'

import { getDashboardChartColors } from '@/features/dashboard/lib/charts'

import { formatBusinessMoney, type BusinessDashboardData } from './types'

type TrendMetric = {
  key: string
  label: string
  group: string
  money?: boolean
  planId?: number
  planField?: 'activations' | 'renewals'
}

type TrendDatum = {
  date: string
  metric: string
  group: string
  value: number
  money: boolean
}

export function buildBusinessTrend(
  data: Pick<BusinessDashboardData, 'daily' | 'plans'>,
  chartType: 'bar' | 'area',
  t: TFunction
) {
  const metrics: TrendMetric[] = [
    { key: 'new_users', label: t('New registrations'), group: 'users' },
    ...data.plans.flatMap((plan): TrendMetric[] => {
      const title = plan.title || t('Plan #{{id}}', { id: plan.plan_id })
      return [
        {
          key: `plan_${plan.plan_id}_activations`,
          label: t('New {{plan}}', { plan: title }),
          group: 'subscriptions',
          planId: plan.plan_id,
          planField: 'activations',
        },
        {
          key: `plan_${plan.plan_id}_renewals`,
          label: t('Renewed {{plan}}', { plan: title }),
          group: 'subscriptions',
          planId: plan.plan_id,
          planField: 'renewals',
        },
      ]
    }),
    {
      key: 'wallet_revenue',
      label: t('Wallet recharge'),
      group: 'revenue',
      money: true,
    },
    {
      key: 'subscription_revenue',
      label: t('Plan subscription'),
      group: 'revenue',
      money: true,
    },
  ]
  const labels = new Map(metrics.map((metric) => [metric.key, metric.label]))
  const values: TrendDatum[] = data.daily.flatMap((day) => {
    const plans = new Map(day.plans.map((plan) => [plan.plan_id, plan]))
    return metrics.map((metric) => {
      let value = 0
      if (metric.planId !== undefined && metric.planField) {
        value = plans.get(metric.planId)?.[metric.planField] ?? 0
      } else {
        value = Number(day[metric.key as keyof typeof day]) || 0
      }
      return {
        date: day.date,
        metric: metric.key,
        group: metric.group,
        value,
        money: !!metric.money,
      }
    })
  })
  const formatValue = (datum?: Record<string, unknown>): string => {
    const value = Number(datum?.value) || 0
    return datum?.money
      ? formatBusinessMoney([{ provider: 'epay', amount: value }])
      : value.toLocaleString()
  }
  const content = [
    {
      key: (datum?: Record<string, unknown>) =>
        labels.get(String(datum?.metric)) ?? '',
      value: formatValue,
      shapeType: 'square',
    },
  ]
  const groups = ['users', 'subscriptions', 'revenue']
  const spec = {
    type: 'common',
    data: groups.map((id) => ({
      id,
      values: values.filter((datum) => datum.group === id),
    })),
    color: {
      type: 'ordinal',
      domain: metrics.map((metric) => metric.key),
      range: getDashboardChartColors(metrics.length),
    },
    series: groups.map((id) => {
      const common = {
        id,
        dataId: id,
        yField: 'value',
        seriesField: 'metric',
        animation: true,
      }
      if (chartType === 'area') {
        return {
          ...common,
          type: 'area' as const,
          xField: 'date',
          stack: false,
          area: {
            style: { fillOpacity: 0.08, curveType: 'monotone' as const },
          },
          line: { style: { lineWidth: 2, curveType: 'monotone' as const } },
          point: { visible: data.daily.length === 1 },
        }
      }
      return {
        ...common,
        type: 'bar' as const,
        xField: ['date', 'group'],
        stack: true,
        barMaxWidth: 24,
        barGapInGroup: 2,
        bar: { state: { hover: { stroke: '#000', lineWidth: 1 } } },
      }
    }),
    axes: [
      {
        orient: 'bottom',
        type: 'band',
        label: {
          formatMethod: (value: string | string[]) => String(value).slice(5),
        },
      },
      {
        orient: 'left',
        type: 'linear',
        seriesId: ['users', 'subscriptions'],
        min: 0,
        label: {
          formatMethod: (value: string | string[]) =>
            Number.isInteger(Number(value)) ? String(value) : '',
        },
      },
      {
        orient: 'right',
        type: 'linear',
        seriesId: ['revenue'],
        min: 0,
        grid: { visible: false },
        label: {
          formatMethod: (value: string | string[]) =>
            `¥${Number(value).toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 })}`,
        },
      },
    ],
    // Common charts need the date-band crosshair that bar/area charts enable by default.
    crosshair: {
      xField: {
        visible: true,
        bindingAxesIndex: [0],
        line: { visible: true, type: 'rect' },
      },
    },
    legends: {
      visible: true,
      selectMode: 'single',
      item: {
        label: {
          formatMethod: (value: string | number) =>
            labels.get(String(value)) ?? String(value),
        },
      },
    },
    tooltip: {
      mark: {
        title: {
          value: (datum?: Record<string, unknown>) => String(datum?.date ?? ''),
        },
        content,
      },
      dimension: {
        content,
        updateContent: (
          items: ITooltipLineActual[] | undefined
        ): ITooltipLineActual[] => {
          // Only cash components share a unit. Never add users, orders and CNY together.
          const rows = [...(items ?? [])].sort(
            (a, b) => Number(b.datum?.value ?? 0) - Number(a.datum?.value ?? 0)
          )
          const revenue = rows.filter((item) => item.datum?.money)
          if (!revenue.length) return rows
          return [
            {
              key: t('Total revenue'),
              value: formatValue({
                money: true,
                value: revenue.reduce(
                  (sum, item) => sum + Number(item.datum?.value ?? 0),
                  0
                ),
              }),
              hasShape: false,
            },
            ...rows,
          ]
        },
      },
    },
    background: 'transparent',
  } satisfies ICommonChartSpec
  return { spec, hasActivity: values.some((datum) => datum.value > 0) }
}
