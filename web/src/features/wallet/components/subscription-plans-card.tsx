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
import { Crown, RefreshCw, Sparkles, Check } from 'lucide-react'
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  StatusBadge,
  dotColorMap,
  textColorMap,
} from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { TitledCard } from '@/components/ui/titled-card'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  getPublicPlans,
  getSelfSubscriptionFull,
  updateBillingPreference,
  updatePreferredSubscription,
} from '@/features/subscriptions/api'
import { SubscriptionPurchaseDialog } from '@/features/subscriptions/components/dialogs/subscription-purchase-dialog'
import { ModelMultiplierSummary } from '@/features/subscriptions/components/model-multiplier-summary'
import {
  formatDuration,
  formatPrimaryQuotaLabel,
  parseQuotaWindows,
} from '@/features/subscriptions/lib'
import type {
  PlanRecord,
  UserSubscriptionRecord,
  UserSubscription,
} from '@/features/subscriptions/types'
import { formatQuota } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import type { PaymentMethod, TopupInfo } from '../types'
import { SubscriptionExpiry } from './subscription-expiry'
import { SubscriptionQuotaUsage } from './subscription-quota-usage'

interface SubscriptionPlansCardProps {
  topupInfo: TopupInfo | null
  onAvailabilityChange?: (available: boolean) => void
  userQuota?: number
  onPurchaseSuccess?: () => void | Promise<void>
}

function getEpayMethods(payMethods: PaymentMethod[] = []): PaymentMethod[] {
  return payMethods.filter(
    (m) => m?.type && m.type !== 'stripe' && m.type !== 'creem'
  )
}

function getBillingPreferenceLabel(
  preference: string,
  t: (key: string) => string
): string {
  switch (preference) {
    case 'subscription_first':
      return t('Subscription First')
    case 'wallet_first':
      return t('Wallet First')
    case 'subscription_only':
      return t('Subscription Only')
    case 'wallet_only':
      return t('Wallet Only')
    default:
      return preference
  }
}

export function SubscriptionPlansCard({
  topupInfo,
  onAvailabilityChange,
  userQuota,
  onPurchaseSuccess,
}: SubscriptionPlansCardProps) {
  const { t } = useTranslation()

  const [plans, setPlans] = useState<PlanRecord[]>([])
  const [activeSubscriptions, setActiveSubscriptions] = useState<
    UserSubscriptionRecord[]
  >([])
  const [allSubscriptions, setAllSubscriptions] = useState<
    UserSubscriptionRecord[]
  >([])
  const [billingPreference, setBillingPreference] =
    useState('subscription_first')
  const [preferredSubscriptionId, setPreferredSubscriptionId] = useState(0)
  const [savingPreference, setSavingPreference] = useState<
    'billing' | 'subscription' | null
  >(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<PlanRecord | null>(null)

  const [renewalSubscription, setRenewalSubscription] =
    useState<UserSubscription>()

  const enableStripe = !!topupInfo?.enable_stripe_topup
  const enableCreem = !!topupInfo?.enable_creem_topup
  const enableWaffoPancake = !!topupInfo?.enable_waffo_pancake_topup
  const enableOnlineTopUp = !!topupInfo?.enable_online_topup
  const epayMethods = useMemo(
    () => getEpayMethods(topupInfo?.pay_methods),
    [topupInfo?.pay_methods]
  )

  const fetchPlans = useCallback(async () => {
    try {
      const res = requireServerSuccess(await getPublicPlans())
      if (res.success) {
        setPlans(res.data || [])
      }
    } catch (error) {
      handleServerError(error)
      setPlans([])
    }
  }, [])

  const fetchSelfSubscription = useCallback(async () => {
    try {
      const res = requireServerSuccess(await getSelfSubscriptionFull())
      if (res.success && res.data) {
        setBillingPreference(
          res.data.billing_preference || 'subscription_first'
        )
        setPreferredSubscriptionId(res.data.preferred_subscription_id || 0)
        setActiveSubscriptions(res.data.subscriptions || [])
        setAllSubscriptions(res.data.all_subscriptions || [])
      }
    } catch (error) {
      handleServerError(error)
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      await Promise.all([fetchPlans(), fetchSelfSubscription()])
      setLoading(false)
    }
    init()
  }, [fetchPlans, fetchSelfSubscription])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await Promise.all([fetchPlans(), fetchSelfSubscription()])
    } finally {
      setRefreshing(false)
    }
  }

  const handlePreferenceChange = async (pref: string) => {
    setSavingPreference('billing')
    const previous = billingPreference
    setBillingPreference(pref)
    try {
      const res = await updateBillingPreference(pref)
      if (res.success) {
        toast.success(t('Updated successfully'))
        const normalized = res.data?.billing_preference || pref
        setBillingPreference(normalized)
      } else {
        handleServerError(res, t('Update failed'))
        setBillingPreference(previous)
      }
    } catch (error) {
      handleServerError(error, t('Request failed'))
      setBillingPreference(previous)
    } finally {
      setSavingPreference(null)
    }
  }

  const handlePreferredSubscriptionChange = async (subscriptionId: number) => {
    setSavingPreference('subscription')
    try {
      const res = requireServerSuccess(
        await updatePreferredSubscription(subscriptionId)
      )
      setPreferredSubscriptionId(
        res.data?.preferred_subscription_id ?? subscriptionId
      )
      toast.success(t('Updated successfully'))
    } catch (error) {
      handleServerError(error, t('Update failed'))
    } finally {
      setSavingPreference(null)
    }
  }

  const hasActive = activeSubscriptions.length > 0
  const hasAny = allSubscriptions.length > 0
  const isAvailable = loading || plans.length > 0 || hasAny
  const disablePref = !hasActive
  const isSubPref =
    billingPreference === 'subscription_first' ||
    billingPreference === 'subscription_only'

  const planPurchaseCountMap = useMemo(() => {
    const map = new Map<number, number>()
    for (const sub of allSubscriptions) {
      const planId = sub?.subscription?.plan_id
      if (!planId) continue
      map.set(planId, (map.get(planId) || 0) + 1)
    }
    return map
  }, [allSubscriptions])

  const renewalByPlan = useMemo(() => {
    const map = new Map<number, UserSubscription>()
    for (const record of allSubscriptions) {
      const sub = record.subscription
      if (sub.status !== 'active' && sub.status !== 'expired') continue
      const previous = map.get(sub.plan_id)
      const active = sub.status === 'active' && sub.end_time > Date.now() / 1000
      const previousActive =
        previous?.status === 'active' && previous.end_time > Date.now() / 1000
      if (
        !previous ||
        (active && !previousActive) ||
        (active === !!previousActive &&
          (sub.end_time > previous.end_time ||
            (sub.end_time === previous.end_time && sub.id > previous.id)))
      ) {
        map.set(sub.plan_id, sub)
      }
    }
    return map
  }, [allSubscriptions])

  useEffect(() => {
    onAvailabilityChange?.(isAvailable)
  }, [isAvailable, onAvailabilityChange])

  const planMap = useMemo(() => {
    const map = new Map<number, PlanRecord['plan']>()
    for (const p of plans) {
      if (p?.plan?.id) {
        map.set(p.plan.id, p.plan)
      }
    }
    return map
  }, [plans])

  if (loading) {
    return (
      <Card data-card-hover='false' className='gap-0 overflow-hidden py-0'>
        <CardHeader className='border-b p-3 !pb-3 sm:p-5 sm:!pb-5'>
          <Skeleton className='h-6 w-32' />
        </CardHeader>
        <CardContent className='space-y-4 p-3 sm:p-5'>
          <Skeleton className='h-20 w-full' />
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3'>
            {['first', 'second', 'third'].map((key) => (
              <Skeleton key={key} className='h-48 w-full' />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (plans.length === 0 && !hasAny) {
    return null
  }

  return (
    <>
      <TitledCard
        title={t('Subscription Plans')}
        description={t('Subscribe to a plan for model access')}
        icon={<Crown className='h-4 w-4' />}
        iconTone='warning'
        disableHoverEffect
        contentClassName='space-y-4 sm:space-y-5'
      >
        {/* My subscriptions & billing preference */}
        <section aria-label={t('My Subscriptions')} className='min-w-0'>
          <div className='flex flex-wrap items-center justify-between gap-2.5 sm:gap-3'>
            <div className='flex min-w-0 flex-wrap items-center gap-2'>
              <span className='text-sm font-medium'>
                {t('My Subscriptions')}
              </span>
              <span className='flex items-center gap-1.5 text-xs font-medium'>
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    hasActive ? dotColorMap.success : dotColorMap.neutral
                  )}
                  aria-hidden='true'
                />
                {hasActive ? (
                  <span className={cn(textColorMap.success)}>
                    {activeSubscriptions.length} {t('active')}
                  </span>
                ) : (
                  <span className='text-muted-foreground'>
                    {t('No Active')}
                  </span>
                )}
                {allSubscriptions.length > activeSubscriptions.length && (
                  <>
                    <span className='text-muted-foreground/30'>·</span>
                    <span className='text-muted-foreground'>
                      {allSubscriptions.length - activeSubscriptions.length}{' '}
                      {t('expired')}
                    </span>
                  </>
                )}
              </span>
            </div>
            <div className='flex w-full items-center gap-2 sm:w-auto'>
              <Select
                items={[
                  {
                    value: 'subscription_first',
                    label: (
                      <>
                        {getBillingPreferenceLabel('subscription_first', t)}
                        {disablePref ? ` (${t('No Active')})` : ''}
                      </>
                    ),
                  },
                  {
                    value: 'wallet_first',
                    label: getBillingPreferenceLabel('wallet_first', t),
                  },
                  {
                    value: 'subscription_only',
                    label: (
                      <>
                        {getBillingPreferenceLabel('subscription_only', t)}
                        {disablePref ? ` (${t('No Active')})` : ''}
                      </>
                    ),
                  },
                  {
                    value: 'wallet_only',
                    label: getBillingPreferenceLabel('wallet_only', t),
                  },
                ]}
                disabled={savingPreference !== null || refreshing}
                value={billingPreference}
                onValueChange={(v) => v !== null && handlePreferenceChange(v)}
              >
                <SelectTrigger
                  className={cn(
                    'h-8 flex-1 text-xs sm:w-[140px] sm:flex-none',
                    savingPreference === 'subscription' &&
                      'disabled:opacity-100'
                  )}
                >
                  <SelectValue>
                    {getBillingPreferenceLabel(billingPreference, t)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    <SelectItem
                      value='subscription_first'
                      disabled={disablePref}
                    >
                      {getBillingPreferenceLabel('subscription_first', t)}
                      {disablePref ? ` (${t('No Active')})` : ''}
                    </SelectItem>
                    <SelectItem value='wallet_first'>
                      {getBillingPreferenceLabel('wallet_first', t)}
                    </SelectItem>
                    <SelectItem
                      value='subscription_only'
                      disabled={disablePref}
                    >
                      {getBillingPreferenceLabel('subscription_only', t)}
                      {disablePref ? ` (${t('No Active')})` : ''}
                    </SelectItem>
                    <SelectItem value='wallet_only'>
                      {getBillingPreferenceLabel('wallet_only', t)}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Button
                variant='ghost'
                size='icon'
                className='h-8 w-8'
                aria-label={t('Refresh subscriptions')}
                onClick={handleRefresh}
                disabled={refreshing || savingPreference !== null}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
                />
              </Button>
            </div>
          </div>

          {disablePref && isSubPref && (
            <p className='text-muted-foreground mt-2 text-xs'>
              {billingPreference === 'subscription_only'
                ? t(
                    'Preference saved as {{pref}}, but no active subscription. Requests will be rejected.',
                    { pref: t('Subscription Only') }
                  )
                : t(
                    'Preference saved as {{pref}}, but no active subscription. Wallet will be used automatically.',
                    { pref: t('Subscription First') }
                  )}
            </p>
          )}

          {hasAny && (
            <p className='text-muted-foreground mt-3 text-xs'>
              {t(
                'Use the preferred subscription first. If unavailable or its quota is insufficient, try other subscriptions by earliest expiry.'
              )}
            </p>
          )}

          {hasAny && (
            <div className='mt-3 max-h-[32rem] divide-y overflow-y-auto rounded-xl border'>
              {allSubscriptions.map((sub) => {
                const subscription = sub.subscription
                const totalAmount = Number(subscription?.amount_total || 0)
                const usedAmount = Number(subscription?.amount_used || 0)
                const subscriptionPlan = planMap.get(subscription?.plan_id)
                const planTitle = subscriptionPlan?.title || ''
                const primaryQuotaLabel = subscriptionPlan
                  ? formatPrimaryQuotaLabel(subscriptionPlan, t)
                  : t('Main quota')
                const now = Date.now() / 1000
                const isExpired = (subscription?.end_time || 0) <= now
                const isCancelled = subscription?.status === 'cancelled'
                const isActive = subscription?.status === 'active' && !isExpired
                const isPreferred =
                  isActive && subscription.id === preferredSubscriptionId
                let statusBadge = (
                  <StatusBadge
                    label={t('Expired')}
                    variant='neutral'
                    type='badge'
                    className='bg-muted h-auto shrink-0 px-2 py-0.5 text-[11px]'
                    copyable={false}
                  />
                )
                if (isActive) {
                  statusBadge = (
                    <StatusBadge
                      label={t('Active')}
                      variant='success'
                      type='badge'
                      className='bg-success/10 h-auto shrink-0 px-2 py-0.5 text-[11px]'
                      copyable={false}
                    />
                  )
                } else if (isCancelled) {
                  statusBadge = (
                    <StatusBadge
                      label={t('Cancelled')}
                      variant='neutral'
                      type='badge'
                      className='bg-muted h-auto shrink-0 px-2 py-0.5 text-[11px]'
                      copyable={false}
                    />
                  )
                }

                return (
                  <article
                    key={subscription?.id}
                    aria-label={`${planTitle || t('Subscription')} #${subscription.id}`}
                    className='bg-background @container p-3 text-xs sm:p-4'
                  >
                    <header className='flex flex-wrap items-center justify-between gap-x-3 gap-y-1'>
                      <div className='flex min-w-0 flex-wrap items-center gap-2'>
                        <span className='text-[13px] font-semibold wrap-anywhere'>
                          {planTitle
                            ? planTitle
                            : `${t('Subscription')} #${subscription?.id}`}
                        </span>
                        {planTitle && (
                          <span className='text-muted-foreground text-[12px] font-normal'>
                            · {t('Subscription')} #{subscription.id}
                          </span>
                        )}
                        {statusBadge}
                      </div>
                      <div className='ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-2'>
                        <SubscriptionExpiry
                          className='text-[12px]'
                          endTime={subscription.end_time}
                          isActive={isActive}
                          isCancelled={isCancelled}
                        />
                        <div className='flex shrink-0 items-center gap-2'>
                          {isActive && (
                            <Button
                              variant='outline'
                              size='sm'
                              className={cn(
                                'shrink-0',
                                isPreferred &&
                                  'border-primary/40 bg-primary/5 text-primary'
                              )}
                              aria-pressed={isPreferred}
                              disabled={savingPreference !== null || refreshing}
                              onClick={() =>
                                handlePreferredSubscriptionChange(
                                  isPreferred ? 0 : subscription.id
                                )
                              }
                            >
                              {isPreferred && (
                                <Check
                                  className='size-3.5'
                                  aria-hidden='true'
                                />
                              )}
                              {isPreferred
                                ? t('Set as preferred')
                                : t('Use first')}
                            </Button>
                          )}
                          {subscriptionPlan &&
                            subscriptionPlan.allow_renewal === true &&
                            (subscription.status === 'active' ||
                              subscription.status === 'expired') && (
                              <Button
                                size='sm'
                                className='shrink-0'
                                onClick={() => {
                                  setSelectedPlan({ plan: subscriptionPlan })
                                  setRenewalSubscription(subscription)
                                  setPurchaseOpen(true)
                                }}
                              >
                                {t('Renew')}
                              </Button>
                            )}
                        </div>
                      </div>
                    </header>
                    <div
                      className={cn(
                        'mt-3 grid grid-cols-1 gap-x-6 gap-y-3 [&>[data-slot=subscription-quota-usage]]:mt-0',
                        (sub.quota_windows?.length || 0) > 0 &&
                          '@xl:grid-cols-2'
                      )}
                    >
                      <SubscriptionQuotaUsage
                        variant='remaining'
                        label={primaryQuotaLabel}
                        amountUsed={usedAmount}
                        amountTotal={totalAmount}
                        nextResetTime={subscription?.next_reset_time}
                        isActive={isActive}
                      />
                      {(sub.quota_windows || []).map((window) => (
                        <SubscriptionQuotaUsage
                          variant='remaining'
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
              })}
            </div>
          )}

          {!hasAny && (
            <p className='text-muted-foreground mt-2 text-xs'>
              {t('Subscribe to a plan for model access')}
            </p>
          )}
        </section>

        {/* Available plans grid */}
        {plans.length > 0 ? (
          <div className='grid grid-cols-1 gap-3 2xl:grid-cols-2 2xl:gap-4'>
            {plans.map((p, index) => {
              const plan = p?.plan
              if (!plan) return null
              const totalAmount = Number(plan.total_amount || 0)
              const price = Number(plan.price_amount || 0).toFixed(2)
              const isPopular = index === 0 && plans.length > 1
              const limit = Number(plan.max_purchase_per_user || 0)
              const count = planPurchaseCountMap.get(plan.id) || 0
              const renewal =
                plan.allow_renewal === true
                  ? renewalByPlan.get(plan.id)
                  : undefined
              const reached = !renewal && limit > 0 && count >= limit
              const quotaWindows = parseQuotaWindows(plan)

              const benefits = [
                `${t('Validity Period')}: ${formatDuration(plan, t)}`,
                totalAmount > 0
                  ? `${formatPrimaryQuotaLabel(plan, t)}: ${formatQuota(totalAmount)}`
                  : `${formatPrimaryQuotaLabel(plan, t)}: ${t('Unlimited')}`,
                ...quotaWindows.map(
                  (window) =>
                    `${window.name}: ${formatQuota(window.amount_total)}`
                ),
                limit > 0 ? `${t('Purchase Limit')}: ${limit}` : null,
                plan.upgrade_group
                  ? `${t('Upgrade Group')}: ${plan.upgrade_group}`
                  : null,
              ].filter(Boolean) as string[]

              return (
                <Card
                  key={plan.id}
                  data-card-hover='false'
                  className={cn(
                    'py-0',
                    isPopular && 'border-primary/70 shadow-sm'
                  )}
                >
                  <CardContent className='flex h-full flex-col p-3.5 sm:p-4'>
                    <div className='mb-2 flex items-start justify-between gap-3'>
                      <div className='min-w-0'>
                        <h4 className='truncate font-semibold'>
                          {plan.title || t('Subscription Plans')}
                        </h4>
                        {plan.subtitle && (
                          <p className='text-muted-foreground truncate text-xs'>
                            {plan.subtitle}
                          </p>
                        )}
                      </div>
                      {isPopular && (
                        <StatusBadge
                          variant='info'
                          copyable={false}
                          className='shrink-0'
                        >
                          <Sparkles className='h-3 w-3' />
                          {t('Recommended')}
                        </StatusBadge>
                      )}
                    </div>

                    <div className='py-2'>
                      <span className='text-primary text-2xl font-bold'>
                        ¥{price}
                      </span>
                    </div>

                    <div className='flex-1 space-y-1.5 pb-3'>
                      {benefits.map((label) => (
                        <div
                          key={label}
                          className='text-muted-foreground flex items-center gap-2 text-xs'
                        >
                          <Check className='text-primary h-3 w-3 shrink-0' />
                          <span>{label}</span>
                        </div>
                      ))}
                    </div>

                    <div className='mb-3'>
                      <ModelMultiplierSummary value={plan.model_multipliers} />
                    </div>

                    {reached ? (
                      <Tooltip>
                        <TooltipTrigger render={<div />}>
                          <Button variant='outline' className='w-full' disabled>
                            {t('Limit Reached')}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t('Purchase limit reached')} ({count}/{limit})
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Button
                        variant={renewal ? 'default' : 'outline'}
                        className='w-full'
                        onClick={() => {
                          setSelectedPlan(p)
                          setRenewalSubscription(renewal)
                          setPurchaseOpen(true)
                        }}
                      >
                        {renewal ? t('Renew Subscription') : t('Subscribe Now')}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        ) : (
          <p className='text-muted-foreground py-4 text-center text-sm'>
            {t('No plans available')}
          </p>
        )}
      </TitledCard>

      <SubscriptionPurchaseDialog
        open={purchaseOpen}
        onOpenChange={(open) => {
          setPurchaseOpen(open)
          if (!open) {
            fetchSelfSubscription()
          }
        }}
        plan={selectedPlan}
        renewalSubscription={renewalSubscription}
        enableStripe={enableStripe}
        enableCreem={enableCreem}
        enableWaffoPancake={enableWaffoPancake}
        enableOnlineTopUp={enableOnlineTopUp}
        epayMethods={epayMethods}
        userQuota={userQuota}
        onPurchaseSuccess={onPurchaseSuccess}
        purchaseLimit={
          selectedPlan?.plan?.max_purchase_per_user
            ? Number(selectedPlan.plan.max_purchase_per_user)
            : undefined
        }
        purchaseCount={
          selectedPlan?.plan?.id
            ? planPurchaseCountMap.get(selectedPlan.plan.id)
            : undefined
        }
      />
    </>
  )
}
