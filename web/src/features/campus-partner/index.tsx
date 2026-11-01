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
import { BookOpen, GraduationCap } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { campusPost, campusSite, useCampus, useCampusAction } from './api'
import { CampusFields } from './forms'
import { PartnerInvitation } from './partner-invitation'
import { PartnerRules } from './partner-rules'
import { PartnerSummary } from './partner-summary'
import { PartnerTiers } from './partner-tiers'
import { CampusRecords } from './records'

export function CampusPartner(): ReactElement {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const overview = useCampus()
  const [withdraw, setWithdraw] = useState(false)
  const [requestID, setRequestID] = useState(() => crypto.randomUUID())
  const join = useCampusAction(() => campusPost('self/join'))
  const apply = useCampusAction((values: Record<string, string>) =>
    campusPost<{ batch: string }>('self/withdraw', {
      ...values,
      request_id: requestID,
    })
  )
  if (!campusSite()) return <ErrorState title={t('Page not found')} />
  if (overview.isPending) return <LoadingState />
  if (overview.isError || !overview.data) {
    return <ErrorState onRetry={() => void overview.refetch()} />
  }
  const data = overview.data
  const maximumRate =
    Math.max(0, ...data.tiers.map((tier) => tier.rate_bps)) / 100
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Campus Partner')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Badge variant='secondary'>
          {t('Tier {{level}}', { level: data.tier.level })} ·{' '}
          {formatNumber(data.tier.rate_percent, locale)}%
        </Badge>
        <Badge variant='outline'>
          {data.enabled ? t('Enrollment open') : t('Enrollment paused')}
        </Badge>
        <Button
          variant='outline'
          size='sm'
          role='link'
          render={<a href='#campus-rules' />}
        >
          <BookOpen />
          {t('Rules')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <section
          aria-label={t('Campus Partner')}
          className='flex w-full min-w-0 flex-col gap-4'
        >
          <section
            aria-labelledby='campus-intro-title'
            className='via-background relative overflow-hidden rounded-2xl border bg-gradient-to-br from-emerald-50 to-teal-50 p-5 sm:p-8 dark:from-emerald-950/30 dark:to-teal-950/20'
          >
            <div className='mb-4 flex items-center gap-2 text-emerald-700 dark:text-emerald-300'>
              <GraduationCap className='size-5' />
              <span className='text-sm font-medium'>
                {t('Share useful AI. Grow together.')}
              </span>
            </div>
            <div className='grid gap-6 sm:grid-cols-[1fr_auto] sm:items-end'>
              <div>
                <h1
                  id='campus-intro-title'
                  className='max-w-xl text-2xl font-semibold tracking-tight sm:text-3xl'
                >
                  {t('Your recommendations deserve a reward.')}
                </h1>
                <p className='text-muted-foreground mt-3 max-w-xl text-sm leading-6'>
                  {t(
                    'Recommend friends and earn commissions on qualifying top-ups and subscriptions under the current rules. Friends receive one personal 5% off top-up coupon.'
                  )}
                </p>
              </div>
              <div>
                <p className='text-muted-foreground text-xs'>
                  {t('Top-up commission up to')}
                </p>
                <p className='text-5xl font-semibold tracking-tight text-emerald-700 dark:text-emerald-300'>
                  {formatNumber(maximumRate, locale)}
                  <span className='text-2xl'>%</span>
                </p>
              </div>
            </div>
          </section>
          <PartnerInvitation
            data={data}
            pending={join.isPending}
            onJoin={() => join.mutate()}
          />
          <PartnerSummary data={data} onWithdraw={() => setWithdraw(true)} />
          <PartnerTiers data={data} />
          <Card className='py-0'>
            <Tabs defaultValue='payments'>
              <div className='border-b p-3 sm:px-5'>
                <TabsList className='flex h-auto flex-wrap'>
                  <TabsTrigger value='payments'>
                    {t('Commission orders')}
                  </TabsTrigger>
                  <TabsTrigger value='invitations'>
                    {t('Invitations')}
                  </TabsTrigger>
                  <TabsTrigger value='entries'>
                    {t('Commission ledger')}
                  </TabsTrigger>
                  <TabsTrigger value='withdrawals'>
                    {t('Withdrawals')}
                  </TabsTrigger>
                </TabsList>
              </div>
              <CardContent className='p-3 sm:p-5'>
                {['payments', 'invitations', 'entries', 'withdrawals'].map(
                  (kind) => (
                    <TabsContent key={kind} value={kind}>
                      <CampusRecords kind={kind} />
                    </TabsContent>
                  )
                )}
              </CardContent>
            </Tabs>
          </Card>
          <PartnerRules />
        </section>
        <Dialog
          open={withdraw}
          onOpenChange={setWithdraw}
          title={t('Request withdrawal')}
          description={t(
            'Approved applications are paid manually at month end. Submission is not a completed transfer.'
          )}
        >
          <p className='mb-4 text-sm'>
            {t('Expected payout')}: {data.expected_batch} ·{' '}
            {t('Subject to approval')}
          </p>
          <CampusFields
            key={requestID}
            fields={[
              {
                name: 'amount',
                label: 'Amount (CNY)',
                value: (data.available_cents / 100).toFixed(2),
              },
              { name: 'account', label: 'Alipay account' },
              { name: 'name', label: 'Real name' },
            ]}
            submit='Submit for review'
            pending={apply.isPending}
            onSubmit={(values) =>
              apply.mutate(values, {
                onSuccess: (result) => {
                  setWithdraw(false)
                  setRequestID(crypto.randomUUID())
                  toast.success(
                    t(
                      'Application submitted. Awaiting review. Expected payout: {{date}}',
                      { date: (result as { batch: string }).batch }
                    )
                  )
                },
              })
            }
          />
        </Dialog>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
