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
import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PublicLayout } from '@/components/layout'
import { Footer } from '@/components/layout/components/footer'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDuration } from '@/features/subscriptions/lib'
import { useStatus } from '@/hooks/use-status'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota } from '@/lib/format'
import { getModuleAccessFromStatus } from '@/lib/nav-modules'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { getPlansCatalog } from './api'

const Wallet = lazy(() =>
  import('@/features/wallet').then((module) => ({ default: module.Wallet }))
)

export function PublicCatalog() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const query = useQuery({
    queryKey: ['plans-page-catalog'],
    queryFn: async () => requireServerSuccess(await getPlansCatalog()).data,
  })
  if (query.isPending) {
    return (
      <div aria-label={t('Loading...')} className='grid gap-4 md:grid-cols-2'>
        <Skeleton className='h-60' />
        <Skeleton className='h-60' />
      </div>
    )
  }
  if (query.isError) {
    return (
      <ErrorState
        title={t('Failed to load plans. Please try again.')}
        onRetry={() => void query.refetch()}
      />
    )
  }
  return (
    <div className='space-y-8'>
      <section aria-labelledby='plans-balance-title' className='space-y-4'>
        <h2 id='plans-balance-title' className='text-xl font-semibold'>
          {t('Balance top-up')}
        </h2>
        <p className='text-muted-foreground'>
          {t(
            'Choose a top-up amount. Sign in for your live account quote and available payment methods.'
          )}
        </p>
        <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
          {query.data.topup_amounts.map((amount) => (
            <Card key={amount}>
              <CardHeader>
                <CardTitle>
                  {t('Top-up option {{amount}}', {
                    amount: formatNumber(amount, locale),
                  })}
                </CardTitle>
                <CardDescription>
                  {t('Final payable amount follows your live account quote.')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  className='w-full'
                  render={
                    <Link to='/sign-in' search={{ redirect: '/plans' }} />
                  }
                >
                  {t('Sign in to top up')}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
      <section
        aria-labelledby='plans-subscriptions-title'
        className='space-y-4'
      >
        <h2 id='plans-subscriptions-title' className='text-xl font-semibold'>
          {t('Subscription Plans')}
        </h2>
        {query.data.subscriptions.length === 0 && (
          <EmptyState title={t('No plans available')} />
        )}
        <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3'>
          {query.data.subscriptions.map((plan) => (
            <Card key={plan.id}>
              <CardHeader>
                <CardTitle>{plan.title}</CardTitle>
                <CardDescription>{plan.subtitle}</CardDescription>
              </CardHeader>
              <CardContent className='flex flex-1 flex-col gap-4'>
                <p className='text-primary text-3xl font-semibold'>
                  ¥{formatNumber(plan.price_amount, locale)}
                </p>
                <div className='text-muted-foreground space-y-2 text-sm'>
                  <p>
                    {t('Validity Period')}: {formatDuration(plan, t)}
                  </p>
                  <p>
                    {t('Total Quota')}:{' '}
                    {plan.total_amount > 0
                      ? formatQuota(plan.total_amount)
                      : t('Unlimited')}
                  </p>
                  {plan.allow_renewal && <p>{t('Renewal supported')}</p>}
                  {plan.max_purchase_per_user > 0 && (
                    <p>
                      {t('Purchase Limit')}:{' '}
                      {formatNumber(plan.max_purchase_per_user, locale)}
                    </p>
                  )}
                </div>
                <Button
                  className='mt-auto w-full'
                  render={
                    <Link to='/sign-in' search={{ redirect: '/plans' }} />
                  }
                >
                  {t('Sign in to subscribe')}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  )
}

export function Plans() {
  const { t } = useTranslation()
  const { auth } = useAuthStore()
  const { status } = useStatus()
  const access = getModuleAccessFromStatus(status, 'plans')
  if (!access.enabled || (access.requireAuth && !auth.user)) return null
  return (
    <PublicLayout showMainContainer={false}>
      <main className='mx-auto w-full max-w-7xl space-y-8 px-4 pt-28 pb-8 sm:px-6'>
        <header className='space-y-3'>
          <h1 className='text-3xl font-bold tracking-tight'>
            {t('Top-up Plans')}
          </h1>
          <p className='text-muted-foreground'>
            {t(
              'Choose balance top-ups or subscriptions for your research workflow.'
            )}
          </p>
        </header>
        {auth.user ? (
          <Suspense fallback={<LoadingState />}>
            <Wallet view='plans' />
          </Suspense>
        ) : (
          <PublicCatalog />
        )}
      </main>
      <Footer
        compact
        attributionVariant='based-on'
        description={t('AI tools and access services · For researchers')}
      />
    </PublicLayout>
  )
}
