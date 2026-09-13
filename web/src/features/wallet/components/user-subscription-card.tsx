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

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { formatPrimaryQuotaLabel } from '@/features/subscriptions/lib'
import type {
  SubscriptionPlan,
  UserSubscription,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'
import { cn } from '@/lib/utils'

import { SubscriptionExpiry } from './subscription-expiry'
import { SubscriptionQuotaUsage } from './subscription-quota-usage'

interface UserSubscriptionCardProps {
  record: UserSubscriptionRecord
  plan?: SubscriptionPlan
  onRenew: (plan: SubscriptionPlan, subscription: UserSubscription) => void
}

export function UserSubscriptionCard(props: UserSubscriptionCardProps) {
  const { t } = useTranslation()
  const subscription = props.record.subscription
  const title = props.plan?.title || t('Subscription')
  const isCancelled = subscription.status === 'cancelled'
  const isActive =
    subscription.status === 'active' &&
    subscription.end_time > Date.now() / 1000
  let statusLabel = t('Expired')
  if (isActive) statusLabel = t('Active')
  else if (isCancelled) statusLabel = t('Cancelled')
  const canRenew =
    props.plan?.allow_renewal === true &&
    (subscription.status === 'active' || subscription.status === 'expired')
  const windows = props.record.quota_windows || []

  return (
    <article
      aria-label={`${title} #${subscription.id}`}
      className='bg-background border-border/70 @container rounded-xl border p-4 text-[12px]'
    >
      <header className='flex flex-wrap items-center justify-between gap-x-5 gap-y-3'>
        <div className='min-w-0 flex-1 basis-[180px]'>
          <div className='flex min-w-0 items-center gap-2'>
            <h3 className='min-w-0 text-[13px] leading-5 font-semibold wrap-anywhere'>
              {title}
            </h3>
            <StatusBadge
              label={statusLabel}
              variant={isActive ? 'success' : 'neutral'}
              type='badge'
              copyable={false}
              className={cn(
                'h-auto shrink-0 px-2 py-0.5 text-[11px]',
                isActive ? 'bg-success/10' : 'bg-muted'
              )}
            />
          </div>
          <p className='text-muted-foreground mt-0.5 text-[11px] leading-4'>
            {t('Subscription')} #{subscription.id}
          </p>
        </div>
        <div className='ml-auto flex min-w-0 items-center gap-3'>
          <SubscriptionExpiry
            endTime={subscription.end_time}
            isActive={isActive}
            isCancelled={isCancelled}
          />
          {canRenew && (
            <Button
              size='sm'
              className='h-7 shrink-0 rounded-md px-3 text-[12px]'
              onClick={() => {
                if (props.plan) props.onRenew(props.plan, subscription)
              }}
            >
              {t('Renew')}
            </Button>
          )}
        </div>
      </header>
      <div
        className={cn(
          'bg-muted/35 mt-3 grid grid-cols-1 gap-x-6 gap-y-4 rounded-lg p-3 [&>[data-slot=subscription-quota-usage]]:mt-0',
          windows.length > 0 && '@xl:grid-cols-2'
        )}
      >
        <SubscriptionQuotaUsage
          label={
            props.plan
              ? formatPrimaryQuotaLabel(props.plan, t)
              : t('Main quota')
          }
          amountUsed={Number(subscription.amount_used || 0)}
          amountTotal={Number(subscription.amount_total || 0)}
          nextResetTime={subscription.next_reset_time}
          isActive={isActive}
        />
        {windows.map((window) => (
          <SubscriptionQuotaUsage
            key={window.window_key}
            label={window.name}
            amountUsed={Number(window.amount_used || 0)}
            amountTotal={Number(window.amount_total || 0)}
            nextResetTime={window.next_reset_time}
            isActive={isActive}
          />
        ))}
      </div>
    </article>
  )
}
