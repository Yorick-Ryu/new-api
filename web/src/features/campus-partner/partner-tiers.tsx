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
import { Trans, useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { TitledCard } from '@/components/ui/titled-card'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import { cash, type Overview } from './api'
import { campusCardTypography, campusTierNameKeys } from './constants'

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
  const nextTier = props.data.tiers[tier.level]
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
    <section aria-label={t('Top-up commission levels')}>
      <TitledCard
        title={<h3>{t('Top-up commission levels')}</h3>}
        titleClassName={campusCardTypography.title}
        descriptionClassName={campusCardTypography.body}
        description={t(
          'Level up automatically with cumulative friend top-ups. New top-ups after an upgrade earn commission at the new rate.'
        )}
        icon={<TrendingUp />}
        iconTone='primary'
        action={
          <div className='text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs sm:justify-end sm:text-sm'>
            <span>{t('Friends cumulative top-ups')}</span>
            <span className='text-foreground font-mono text-base font-semibold tabular-nums sm:text-lg'>
              {cash(props.data.member.performance_cents, locale)}
            </span>
            <span>
              {tier.next_cents && nextTier ? (
                <Trans
                  t={t}
                  i18nKey='Top up <amount>{{amount}}</amount> more to reach <rate>{{rate}}%</rate>'
                  values={{
                    amount: cash(tier.remaining_cents, locale),
                    rate: formatNumber(nextTier.rate_bps / 100, locale),
                  }}
                  components={{
                    amount: (
                      <span className='text-primary font-mono text-base font-semibold tabular-nums sm:text-lg' />
                    ),
                    rate: (
                      <span className='text-primary font-mono text-base font-semibold tabular-nums sm:text-lg' />
                    ),
                  }}
                />
              ) : (
                t('Highest partner tier reached')
              )}
            </span>
          </div>
        }
        contentClassName='space-y-4'
      >
        {props.data.tiers.length > 0 ? (
          <div className='grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-3'>
            {props.data.tiers.map((rule, index) => {
              const active = tier.level === index + 1
              const next = props.data.tiers[index + 1]
              let value = 0
              if (index + 1 < tier.level) value = 100
              else if (active) value = progress
              return (
                <div
                  key={rule.floor_cents}
                  className='flex min-w-0 flex-col gap-3'
                >
                  <Progress
                    className='[&_[data-slot=progress-track]]:h-2'
                    value={value}
                    aria-label={t('Lv.{{level}}', { level: index + 1 })}
                  />
                  <Card
                    size='sm'
                    aria-current={active ? 'step' : undefined}
                    className={cn(
                      'min-w-0 flex-1',
                      active && 'bg-primary/5 ring-primary ring-2'
                    )}
                  >
                    <CardHeader className='flex flex-wrap items-center justify-between gap-2'>
                      <span className={campusCardTypography.subtitle}>
                        {t('Lv.{{level}}', { level: index + 1 })}
                      </span>
                      {active && <Badge>{t('Current')}</Badge>}
                      {index + 1 < tier.level && (
                        <Badge variant='secondary'>{t('Completed')}</Badge>
                      )}
                    </CardHeader>
                    <CardContent className='space-y-2'>
                      <p
                        className={cn(
                          campusCardTypography.metric,
                          active && 'text-primary'
                        )}
                      >
                        {formatNumber(rule.rate_bps / 100, locale)}%
                      </p>
                      <p
                        className={cn(
                          campusCardTypography.subtitle,
                          '[overflow-wrap:anywhere] break-words'
                        )}
                      >
                        {rule.name ||
                          t(campusTierNameKeys[index] || 'Lv.{{level}}', {
                            level: index + 1,
                          })}
                      </p>
                      <p className='text-muted-foreground font-mono text-xs leading-5 break-words tabular-nums'>
                        {tierAmount.format(rule.floor_cents / 100)}
                        {next
                          ? ` – ${tierAmount.format(next.floor_cents / 100)}`
                          : ` ${t('and above')}`}
                      </p>
                    </CardContent>
                  </Card>
                </div>
              )
            })}
          </div>
        ) : (
          <EmptyState title={t('No records yet')} />
        )}
        {props.data.plan_rates.length > 0 && (
          <div className='space-y-3'>
            <h4 className={campusCardTypography.subtitle}>
              {t('Subscription commission rates')}
            </h4>
            <div className='grid gap-3 sm:grid-cols-2'>
              {props.data.plan_rates.map((plan) => (
                <Card
                  key={plan.plan_id}
                  size='sm'
                  className='bg-primary/5 ring-primary/20'
                >
                  <CardContent className='flex min-w-0 flex-wrap items-center justify-between gap-3'>
                    <span className='min-w-0 text-sm font-semibold break-words'>
                      {props.data.plan_options.find(
                        (option) => option.id === plan.plan_id
                      )?.title || `#${plan.plan_id}`}
                    </span>
                    <span className='text-primary font-mono text-xl font-bold tabular-nums'>
                      {formatNumber(plan.rate_bps / 100, locale)}%
                    </span>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </TitledCard>
    </section>
  )
}
