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
import { TrendingUp } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { TitledCard } from '@/components/ui/titled-card'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import { cash, type Overview } from './api'

export function PartnerTiers(props: { data: Overview }): ReactElement {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const tierAmount = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  const tier = props.data.tier
  const progress =
    tier.next_cents > tier.floor_cents
      ? Math.max(
          0,
          Math.min(
            100,
            ((props.data.member.performance_cents - tier.floor_cents) /
              (tier.next_cents - tier.floor_cents)) *
              100
          )
        )
      : 100
  return (
    <section aria-label={t('Top-up commission tiers')}>
      <TitledCard
        title={<h3>{t('Top-up commission tiers')}</h3>}
        description={`${t('Current top-up rate')}: ${formatNumber(tier.rate_percent, locale)}%`}
        icon={<TrendingUp />}
        iconTone='primary'
        action={
          <div className='space-y-1 sm:text-right'>
            <p className='text-muted-foreground text-xs'>
              {t('Campaign net paid sales')}
            </p>
            <p className='font-mono text-2xl font-semibold tabular-nums'>
              {cash(props.data.member.performance_cents, locale)}
            </p>
          </div>
        }
        contentClassName='space-y-4'
      >
        <div className='space-y-2'>
          <p className='text-muted-foreground text-sm'>
            {tier.next_cents
              ? t('{{amount}} to the next tier', {
                  amount: cash(tier.remaining_cents, locale),
                })
              : t('Highest partner tier reached')}
          </p>
          <div className='flex gap-1.5'>
            {props.data.tiers.map((rule, index) => {
              let value = 0
              if (index + 1 < tier.level) value = 100
              else if (index + 1 === tier.level) value = progress
              return (
                <Progress
                  key={rule.floor_cents}
                  value={value}
                  className='min-w-0 flex-1'
                  aria-label={t('Tier {{level}}', { level: index + 1 })}
                />
              )
            })}
          </div>
        </div>
        {props.data.tiers.length > 0 ? (
          <div className='grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3'>
            {props.data.tiers.map((rule, index) => {
              const active = tier.level === index + 1
              const next = props.data.tiers[index + 1]
              return (
                <Card
                  key={rule.floor_cents}
                  size='sm'
                  aria-current={active ? 'step' : undefined}
                  className={cn(
                    'min-w-0',
                    active && 'bg-primary/5 ring-primary ring-2'
                  )}
                >
                  <CardHeader className='flex flex-wrap items-center justify-between gap-2'>
                    <span className='text-sm font-medium'>
                      {t('Tier {{level}}', { level: index + 1 })}
                    </span>
                    {active && <Badge>{t('Current')}</Badge>}
                    {index + 1 < tier.level && (
                      <Badge variant='secondary'>{t('Completed')}</Badge>
                    )}
                  </CardHeader>
                  <CardContent className='space-y-2'>
                    <p
                      className={cn(
                        'font-mono text-2xl font-semibold tabular-nums',
                        active && 'text-primary'
                      )}
                    >
                      {formatNumber(rule.rate_bps / 100, locale)}%
                    </p>
                    <p className='text-muted-foreground font-mono text-xs leading-5 break-words tabular-nums'>
                      {tierAmount.format(rule.floor_cents / 100)}
                      {next
                        ? ` – <${tierAmount.format(next.floor_cents / 100)}`
                        : '+'}
                    </p>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        ) : (
          <EmptyState title={t('No records yet')} />
        )}
        {props.data.plan_rates.length > 0 && (
          <>
            <Separator />
            <div className='space-y-3'>
              <h4 className='text-sm font-medium'>
                {t('Subscription commissions')}
              </h4>
              <div className='grid gap-3 sm:grid-cols-2'>
                {props.data.plan_rates.map((plan) => (
                  <Card
                    key={plan.plan_id}
                    size='sm'
                    className='bg-primary/5 ring-primary/20'
                  >
                    <CardContent className='flex min-w-0 flex-wrap items-center justify-between gap-3'>
                      <span className='min-w-0 text-sm font-medium break-words'>
                        {props.data.plan_options.find(
                          (option) => option.id === plan.plan_id
                        )?.title || `#${plan.plan_id}`}
                      </span>
                      <span className='text-primary font-mono text-xl font-semibold tabular-nums'>
                        {formatNumber(plan.rate_bps / 100, locale)}%
                      </span>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </>
        )}
      </TitledCard>
    </section>
  )
}
