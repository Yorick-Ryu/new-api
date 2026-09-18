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
import {
  Activity,
  CircleDollarSign,
  PackageCheck,
  Percent,
  UserPlus,
  Users,
  Wallet,
  CalendarClock,
  WalletCards,
  BadgeDollarSign,
  type LucideIcon,
} from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { IconBadgeTone } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'

import { StatTitle } from '../ui/stat-title'
import { formatBusinessMoney, type BusinessDashboardData } from './types'

const metricsGridClassName = 'grid grid-cols-2 border-b lg:grid-cols-4'
const metricCardClassName =
  'bg-card min-w-0 border-r border-b px-4 py-2 sm:px-5 sm:py-4'

function BusinessMetricValueSkeleton() {
  return (
    <dd className='mt-1 flex flex-col gap-1 sm:mt-2 sm:gap-1.5'>
      <Skeleton className='h-5 w-20 sm:h-7 sm:w-24' />
      <Skeleton className='h-3.5 w-28' />
    </dd>
  )
}

export function BusinessMetricsSkeleton() {
  return (
    <dl className={metricsGridClassName} aria-hidden='true'>
      {Array.from({ length: 12 }, (_, index) => (
        <div key={index} className={metricCardClassName}>
          <dt className='flex min-w-0 items-center gap-1.5 sm:gap-2'>
            <Skeleton className='size-4 shrink-0 rounded-sm sm:size-7 sm:rounded-md' />
            <Skeleton className='h-4 w-24 max-w-full' />
          </dt>
          <BusinessMetricValueSkeleton />
        </div>
      ))}
    </dl>
  )
}

type BusinessMetric = {
  label: string
  icon: LucideIcon
  iconTone: IconBadgeTone
  value: ReactNode
  valueKey?: string
  description: ReactNode
}

function PeriodComparison(props: { current: number; previous: number }) {
  const { t } = useTranslation()
  let change = t('Unchanged from previous period')
  if (props.current !== props.previous) {
    if (props.previous === 0) {
      change = t('Previous period was 0')
    } else {
      const percent = ((props.current - props.previous) / props.previous) * 100
      change = t('{{change}}% vs previous period', {
        change: `${percent > 0 ? '+' : ''}${percent.toFixed(1)}`,
      })
    }
  }
  return <span className='block tabular-nums'>{change}</span>
}

export function BusinessMetrics(props: {
  data: BusinessDashboardData
  loading?: boolean
}) {
  const { t } = useTranslation()
  const reduceMotion = useReducedMotion()
  const data = props.data
  const health = data.subscription_health
  const averageRevenue =
    data.sales.revenue_paying_users > 0
      ? data.sales.revenue / data.sales.revenue_paying_users
      : null
  const previousAverageRevenue =
    data.previous_sales.revenue_paying_users > 0
      ? data.previous_sales.revenue / data.previous_sales.revenue_paying_users
      : null
  const metrics: BusinessMetric[] = [
    {
      label: t('New registrations'),
      icon: UserPlus,
      iconTone: 'info',
      value: data.new_users.toLocaleString(),
      description: (
        <PeriodComparison
          current={data.new_users}
          previous={data.previous_sales.new_users}
        />
      ),
    },
    {
      label: t('First-time paying users'),
      icon: Users,
      iconTone: 'info',
      value: data.sales.first_paying_users.toLocaleString(),
      description: (
        <PeriodComparison
          current={data.sales.first_paying_users}
          previous={data.previous_sales.first_paying_users}
        />
      ),
    },
    {
      label: t('Active users'),
      icon: Activity,
      iconTone: 'info',
      value: data.activity ? data.activity.users.toLocaleString() : '—',
      description: data.activity ? (
        <PeriodComparison
          current={data.activity.users}
          previous={data.activity.previous_users}
        />
      ) : (
        t('Usage data unavailable')
      ),
    },
    {
      label: t('New user top-up rate'),
      icon: Percent,
      iconTone: 'chart-2',
      value: data.new_users ? `${data.new_user_topup_rate.toFixed(1)}%` : '—',
      description: t('{{paid}} of {{total}} new users topped up', {
        paid: data.new_user_topup_users,
        total: data.new_users,
      }),
    },
    {
      label: t('Total revenue'),
      icon: CircleDollarSign,
      iconTone: 'success',
      value: formatBusinessMoney([
        { provider: 'epay', amount: data.sales.revenue },
      ]),
      description: (
        <>
          <PeriodComparison
            current={data.sales.revenue}
            previous={data.previous_sales.revenue}
          />
          {data.sales.unverified_orders > 0 && (
            <span className='block'>
              {t('{{count}} other-channel orders excluded', {
                count: data.sales.unverified_orders,
              })}
            </span>
          )}
        </>
      ),
    },
    {
      label: t('Wallet top-up amount'),
      icon: Wallet,
      iconTone: 'success',
      value: formatBusinessMoney(data.topup_amounts),
      description: t('{{orders}} orders · {{users}} top-up users', {
        orders: data.topup_orders,
        users: data.topup_users,
      }),
    },
    {
      label: t('New user top-up amount'),
      icon: CircleDollarSign,
      iconTone: 'success',
      value: formatBusinessMoney(data.new_user_topup_amounts),
      description: t('Average top-up {{amount}}', {
        amount:
          data.new_user_topup_users > 0
            ? formatBusinessMoney(
                data.new_user_topup_amounts.map((item) => ({
                  ...item,
                  amount: item.amount / data.new_user_topup_users,
                }))
              )
            : '—',
      }),
    },
    {
      label: t('Average revenue per paying user'),
      icon: BadgeDollarSign,
      iconTone: 'success',
      value:
        averageRevenue === null
          ? '—'
          : formatBusinessMoney([{ provider: 'epay', amount: averageRevenue }]),
      description:
        averageRevenue !== null && previousAverageRevenue !== null ? (
          <PeriodComparison
            current={averageRevenue}
            previous={previousAverageRevenue}
          />
        ) : null,
    },
    {
      label: t('Current active subscriptions'),
      icon: CalendarClock,
      iconTone: 'chart-4',
      value: health.active.toLocaleString(),
      description: t('{{count}} expiring in the next 7 days', {
        count: health.expiring,
      }),
    },
    {
      label: t('Subscription revenue'),
      icon: WalletCards,
      iconTone: 'success',
      value: formatBusinessMoney([
        { provider: 'epay', amount: data.sales.subscription_revenue },
      ]),
      description: (
        <PeriodComparison
          current={data.sales.subscription_revenue}
          previous={data.previous_sales.subscription_revenue}
        />
      ),
    },
  ]
  const planMetrics = data.plans.map(
    (plan): BusinessMetric & { key: string } => {
      const difference = plan.activations + plan.renewals - plan.previous_orders
      return {
        key: `plan-${plan.plan_id}`,
        label: plan.title || t('Plan #{{id}}', { id: plan.plan_id }),
        icon: PackageCheck,
        iconTone: 'chart-4',
        valueKey: `${plan.activations}-${plan.renewals}`,
        value: (
          <span className='flex flex-nowrap gap-4 overflow-x-auto'>
            <span className='inline-flex shrink-0 items-baseline gap-1.5 whitespace-nowrap'>
              <span className='text-muted-foreground [font-family:var(--font-body)] text-[11px] font-normal tracking-normal sm:text-xs'>
                {t('New subscriptions')}
              </span>
              <span>{plan.activations.toLocaleString()}</span>
            </span>
            <span className='inline-flex shrink-0 items-baseline gap-1.5 whitespace-nowrap'>
              <span className='text-muted-foreground [font-family:var(--font-body)] text-[11px] font-normal tracking-normal sm:text-xs'>
                {t('Subscription renewals')}
              </span>
              <span>{plan.renewals.toLocaleString()}</span>
            </span>
          </span>
        ),
        description: (
          <span className='block tabular-nums'>
            {t('{{change}} vs previous period', {
              change: `${difference > 0 ? '+' : ''}${difference.toLocaleString()}`,
            })}
          </span>
        ),
      }
    }
  )
  return (
    <dl className={metricsGridClassName}>
      {[
        ...metrics.map((metric) => ({ ...metric, key: metric.label })),
        ...planMetrics,
      ].map((metric) => (
        <div key={metric.key} className={metricCardClassName}>
          <dt className='min-w-0'>
            <StatTitle
              title={metric.label}
              icon={metric.icon}
              iconTone={metric.iconTone}
            />
          </dt>
          {props.loading ? (
            <BusinessMetricValueSkeleton />
          ) : (
            <>
              <motion.dd
                key={metric.valueKey ?? String(metric.value)}
                initial={reduceMotion ? false : { opacity: 0.45, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: reduceMotion ? 0 : 0.25,
                  ease: 'easeOut',
                }}
                className='text-foreground mt-1 font-mono text-base leading-tight font-bold tracking-tight break-words tabular-nums sm:mt-2 sm:text-2xl sm:leading-normal'
              >
                {metric.value}
              </motion.dd>
              {metric.description && (
                <dd className='text-muted-foreground/60 mt-1 text-[11px] leading-relaxed sm:text-xs'>
                  {metric.description}
                </dd>
              )}
            </>
          )}
        </div>
      ))}
    </dl>
  )
}
