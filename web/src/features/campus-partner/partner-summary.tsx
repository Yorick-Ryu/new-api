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
  ChartNoAxesColumn,
  CircleDollarSign,
  RotateCcw,
  Users,
  Wallet,
} from 'lucide-react'
import type { ReactElement } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { StatCard } from '@/features/dashboard/components/ui/stat-card'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { cash, type Overview } from './api'
import { CommissionComposition } from './commission-composition'

export function PartnerSummary(props: {
  data: Overview
  onWithdraw: () => void
}): ReactElement {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  return (
    <>
      <div className='grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4'>
        <Card size='sm' className='bg-primary/5 ring-primary/20'>
          <CardContent className='flex flex-1 flex-col gap-3'>
            <StatCard
              compact
              title={t('Available commission')}
              value={cash(props.data.available_cents, locale)}
              icon={Wallet}
              iconTone='primary'
            />
            <Progress
              className='[&_[data-slot=progress-track]]:h-2'
              value={Math.max(
                0,
                Math.min(100, props.data.available_cents / 100)
              )}
              aria-label={t('Available commission')}
            />
            <p className='text-muted-foreground text-xs leading-relaxed'>
              <Trans
                t={t}
                i18nKey='Withdrawal minimum: <amount>{{amount}}</amount>'
                values={{ amount: cash(10000, locale) }}
                components={{
                  amount: (
                    <span className='font-mono font-medium tabular-nums' />
                  ),
                }}
              />
              {props.data.available_cents < 10000 && (
                <>
                  {' · '}
                  <Trans
                    t={t}
                    i18nKey='<amount>{{amount}}</amount> remaining'
                    values={{
                      amount: cash(10000 - props.data.available_cents, locale),
                    }}
                    components={{
                      amount: (
                        <span className='font-mono font-medium tabular-nums' />
                      ),
                    }}
                  />
                </>
              )}
            </p>
            <Button
              disabled={props.data.available_cents < 10000}
              onClick={props.onWithdraw}
              className='w-full'
            >
              {t('Request withdrawal')}
            </Button>
          </CardContent>
        </Card>
        <Card size='sm'>
          <CardContent>
            <StatCard
              compact
              title={t('Lifetime commission')}
              value={cash(props.data.net_cents, locale)}
              icon={CircleDollarSign}
              iconTone='primary'
            />
            <CommissionComposition data={props.data} />
          </CardContent>
        </Card>
        <Card size='sm'>
          <CardContent>
            <StatCard
              compact
              title={t('Invited')}
              value={formatNumber(props.data.invited, locale)}
              description={`${t('New this month')}: ${formatNumber(props.data.this_month, locale)}`}
              icon={Users}
              iconTone='primary'
            />
          </CardContent>
        </Card>
        <Card size='sm'>
          <CardContent>
            <StatCard
              compact
              title={t('Friends cumulative top-ups')}
              value={cash(props.data.member.performance_cents, locale)}
              icon={ChartNoAxesColumn}
              iconTone='primary'
            />
          </CardContent>
        </Card>
      </div>
      {props.data.member.debt_cents > 0 && (
        <Alert>
          <RotateCcw />
          <AlertTitle>
            {t('Refund recovery due')}
            <span className='ml-2 font-mono tabular-nums'>
              {cash(props.data.member.debt_cents, locale)}
            </span>
          </AlertTitle>
          <AlertDescription>
            {t(
              'Refunded paid-out commissions are recovered from available funds, then future matured commissions. No separate transfer is required.'
            )}
          </AlertDescription>
        </Alert>
      )}
    </>
  )
}
