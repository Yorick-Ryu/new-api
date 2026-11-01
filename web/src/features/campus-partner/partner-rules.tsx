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
import { BookOpen } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

import { Card, CardContent } from '@/components/ui/card'
import { IconBadge } from '@/components/ui/icon-badge'
import { TitledCard } from '@/components/ui/titled-card'

export function PartnerRules(): ReactElement {
  const { t } = useTranslation()
  const rules = [
    {
      title: t('Bind invitation'),
      description: t(
        'Binding cannot be changed. Only available before your first successful payment. You cannot invite yourself or invite each other.'
      ),
    },
    {
      title: t('Commission calculation'),
      description: t(
        'Qualifying top-ups and participating subscriptions count toward tier progress. Top-ups use progressive tier rates; subscriptions use their configured rates. Existing commissions stay unchanged.'
      ),
    },
    {
      title: t('Withdraw to Alipay'),
      description: `${t(
        'Commission unlocks after 168 hours. Apply from CNY 100; approved applications are paid at month end.'
      )} ${t(
        'Applications before the end of the 25th enter this month’s batch. Later applications enter next month. Balances carry forward.'
      )}`,
    },
    {
      title: t('My coupon'),
      description: t(
        '5% off one top-up. No expiry, personal use only, not valid for subscriptions. Refunds do not restore a used coupon.'
      ),
    },
  ]
  return (
    <section id='campus-rules' className='scroll-mt-4'>
      <TitledCard
        title={<h3>{t('Rules')}</h3>}
        icon={<BookOpen />}
        className='bg-muted/30'
        contentClassName='grid gap-3 md:grid-cols-2'
      >
        {rules.map((rule, index) => (
          <Card key={rule.title} size='sm' className='min-w-0'>
            <CardContent className='flex min-w-0 gap-3'>
              <IconBadge
                tone='primary'
                size='sm'
                className='font-mono text-xs font-semibold'
              >
                {String(index + 1).padStart(2, '0')}
              </IconBadge>
              <div className='min-w-0 space-y-1'>
                <h4 className='text-sm font-medium'>{rule.title}</h4>
                <p className='text-muted-foreground text-xs leading-6'>
                  {rule.description}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </TitledCard>
    </section>
  )
}
