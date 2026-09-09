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
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Crown } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  getPublicPlans,
  getSelfSubscriptionFull,
} from '@/features/subscriptions/api'
import {
  formatPrimaryQuotaLabel,
  formatQuotaWindowPeriod,
} from '@/features/subscriptions/lib/format'
import { SubscriptionExpiry } from '@/features/wallet/components/subscription-expiry'
import { SubscriptionQuotaUsage } from '@/features/wallet/components/subscription-quota-usage'
import { useAuthStore } from '@/stores/auth-store'

export function AccountCreditsCard() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const subscriptionListRef = useRef<HTMLUListElement>(null)
  const [firstSubscriptionHeight, setFirstSubscriptionHeight] = useState<
    number | undefined
  >()
  const subscriptionsQuery = useQuery({
    queryKey: ['dashboard', 'overview', 'subscriptions', user?.id],
    queryFn: async () => {
      const result = await getSelfSubscriptionFull()
      if (!result.success || !result.data) {
        throw new Error('Failed to load subscription quota')
      }
      return result.data
    },
    enabled: Boolean(user),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
  const plansQuery = useQuery({
    queryKey: ['subscriptions', 'public-plans', user?.id],
    queryFn: async () => {
      const result = await getPublicPlans()
      if (!result.success) throw new Error('Failed to load subscription plans')
      return result.data ?? []
    },
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  })
  const now = Date.now() / 1000
  const activeSubscriptions = (subscriptionsQuery.data?.subscriptions ?? [])
    .filter(
      ({ subscription }) =>
        subscription.status === 'active' &&
        subscription.start_time <= now &&
        subscription.end_time > now
    )
    .sort((a, b) => a.subscription.end_time - b.subscription.end_time)
  const planMap = new Map(
    (plansQuery.data ?? []).map(({ plan }) => [plan.id, plan])
  )
  const firstSubscriptionId = activeSubscriptions[0]?.subscription.id

  useLayoutEffect(() => {
    const firstCard = subscriptionListRef.current?.firstElementChild
    if (!firstCard) {
      setFirstSubscriptionHeight(undefined)
      return
    }
    const updateHeight = () => {
      setFirstSubscriptionHeight(firstCard.getBoundingClientRect().height)
    }
    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(firstCard)
    return () => observer.disconnect()
  }, [firstSubscriptionId, subscriptionsQuery.isSuccess])

  return (
    <section
      aria-label={t('Subscription Plans')}
      className='min-w-0 border-t bg-[linear-gradient(135deg,color-mix(in_oklch,var(--overview-accent-2)_12%,var(--background))_0%,color-mix(in_oklch,oklch(0.82_0.04_155)_8%,var(--background))_48%,color-mix(in_oklch,var(--overview-accent-1)_7%,var(--background))_100%)] p-3 sm:p-5 xl:border-t-0 xl:border-l'
    >
      <div className='min-w-0'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div className='flex flex-wrap items-center gap-2'>
            <h3 className='flex items-center gap-2 text-sm font-semibold'>
              <Crown
                className='text-muted-foreground size-4'
                aria-hidden='true'
              />
              {t('Subscription Plans')}
            </h3>
            {subscriptionsQuery.isSuccess && activeSubscriptions.length > 0 && (
              <span className='bg-success/10 text-success rounded-full px-2 py-0.5 text-[11px] font-medium'>
                {activeSubscriptions.length} {t('active')}
              </span>
            )}
          </div>
          <Button
            variant='outline'
            size='sm'
            role='link'
            nativeButton={false}
            className='ml-auto'
            render={<Link to='/subscription-plans' />}
          >
            {t('View subscriptions')}
            <ArrowUpRight data-icon='inline-end' />
          </Button>
        </div>

        {subscriptionsQuery.isPending && (
          <div role='status' className='mt-3 space-y-3'>
            <span className='text-muted-foreground text-xs'>
              {t('Loading')}
            </span>
            <Skeleton className='h-3 w-2/3' />
            <Skeleton className='h-2 w-full' />
            <Skeleton className='h-3 w-1/2' />
          </div>
        )}
        {subscriptionsQuery.isError && (
          <div
            role='alert'
            className='mt-3 flex flex-wrap items-center gap-2 text-xs'
          >
            <span>{t('Failed to load subscription quota')}</span>
            <Button
              variant='outline'
              size='sm'
              disabled={subscriptionsQuery.isFetching}
              onClick={() => void subscriptionsQuery.refetch()}
            >
              {t('Retry')}
            </Button>
          </div>
        )}
        {subscriptionsQuery.isSuccess && activeSubscriptions.length === 0 && (
          <p className='text-muted-foreground mt-3 text-xs'>
            {t('No active subscriptions')}
          </p>
        )}
        {subscriptionsQuery.isSuccess && activeSubscriptions.length > 0 && (
          <ul
            ref={subscriptionListRef}
            aria-label={t('My Subscriptions')}
            tabIndex={0}
            style={{ maxHeight: firstSubscriptionHeight }}
            className='focus-visible:ring-ring mt-3 max-h-64 space-y-3 overflow-y-auto overscroll-contain rounded-xl pr-1 outline-none focus-visible:ring-2'
          >
            {activeSubscriptions.map((record) => {
              const subscription = record.subscription
              const plan = planMap.get(subscription.plan_id)
              const title =
                plan?.title || `${t('Subscription')} #${subscription.id}`
              return (
                <li
                  key={subscription.id}
                  className='bg-background/60 min-w-0 rounded-xl border p-3 text-xs'
                >
                  <div className='flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1'>
                    <h4 className='min-w-0 font-semibold wrap-anywhere'>
                      {title}
                    </h4>
                    <SubscriptionExpiry
                      endTime={subscription.end_time}
                      isActive
                    />
                  </div>
                  <SubscriptionQuotaUsage
                    label={
                      plan ? formatPrimaryQuotaLabel(plan, t) : t('Main quota')
                    }
                    amountUsed={subscription.amount_used}
                    amountTotal={subscription.amount_total}
                    nextResetTime={subscription.next_reset_time}
                    isActive
                  />
                  {(record.quota_windows ?? []).map((window) => (
                    <SubscriptionQuotaUsage
                      key={window.window_key}
                      label={
                        window.name ||
                        t('{{period}} quota', {
                          period: formatQuotaWindowPeriod(window, t),
                        })
                      }
                      amountUsed={window.amount_used}
                      amountTotal={window.amount_total}
                      nextResetTime={window.next_reset_time}
                      isActive
                    />
                  ))}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
