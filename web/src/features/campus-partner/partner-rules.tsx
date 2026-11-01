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
import { cn } from '@/lib/utils'

export function PartnerRules(): ReactElement {
  const { t } = useTranslation()
  const rules = [
    {
      title: t('Invitation relationship'),
      description: t(
        'Friends bind to you when they register through your exclusive link or enter your invitation code. A successful binding cannot be changed. Self-invitations, reciprocal invitations and invitation loops are not allowed.'
      ),
    },
    {
      title: t('Tiered top-up commissions'),
      description: t(
        'Qualifying top-up payments count toward your cumulative friend top-ups and earn commission progressively using the level ranges above. Upgrades apply to new payments; commissions from other completed orders are not recalculated.'
      ),
    },
    {
      title: t('Cross-level commission calculation'),
      description: t(
        'When one top-up crosses a level boundary, the amounts below and above the boundary use their respective rates, then the commissions are added together. The highest rate does not apply to the entire payment. View the breakdown in the commission ledger.'
      ),
    },
    {
      title: t('Subscription commission rates'),
      description: t(
        'Only participating subscriptions earn commission, at the rate configured for each plan above, independently of your top-up level. Their qualifying payments also count toward cumulative level progress.'
      ),
    },
    {
      title: t('Settlement and withdrawals'),
      description: `${t(
        'Commission unlocks after 168 hours. Apply from CNY 100; approved applications are paid at month end.'
      )} ${t(
        'Applications before the end of the 25th enter this month’s batch. Later applications enter next month. Balances carry forward.'
      )}`,
    },
    {
      title: t('Friend benefits'),
      description: t(
        'A successful invitation binding automatically grants one personal 5% off top-up coupon. Each coupon can be used only once. It never expires and is not limited to the first top-up. It cannot be used for subscriptions or combined with other coupons. Refunds after successful payment do not restore it.'
      ),
    },
    {
      title: t('Add an invitation code later'),
      description: t(
        'If you registered without an invitation, you may bind once before your first successful top-up or subscription payment and receive the same coupon. A successful payment closes this option permanently, even if refunded. Binding cannot be changed, and self-invitations or reciprocal invitations are prohibited.'
      ),
      wide: true,
    },
    {
      title: t('Refunds and commission recovery'),
      description: t(
        'Refunds reverse the original order commission proportionally and reduce cumulative level progress, which may lower your level. Other completed orders are not recalculated. Paid-out commission is recovered from available funds first, then future matured commissions; no separate transfer is required.'
      ),
      wide: true,
    },
  ]
  return (
    <section id='campus-rules' className='scroll-mt-4'>
      <TitledCard
        title={<h3>{t('Rules')}</h3>}
        icon={<BookOpen />}
        className='bg-muted/30'
        contentClassName='grid gap-3 md:grid-cols-2 xl:grid-cols-6'
      >
        {rules.map((rule, index) => (
          <Card
            key={rule.title}
            size='sm'
            className={cn(
              'min-w-0',
              rule.wide ? 'xl:col-span-3' : 'xl:col-span-2'
            )}
          >
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
                <p className='text-muted-foreground text-xs leading-6 sm:text-sm'>
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
