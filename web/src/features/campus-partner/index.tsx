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
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Gift, GraduationCap, Users } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { toIntlLocale } from '@/i18n/languages'

import { campusPost, campusSite, cash, useCampus, useCampusAction } from './api'
import { CampusFields, InvitationField } from './forms'
import { CampusRecords } from './records'

export function CampusPartner() {
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
  const link = `https://beiapi.cn/sign-up?campus=${data.member.code}`
  const tiers = [
    t('Apprentice partner'),
    t('Growing partner'),
    t('Elite partner'),
    t('Senior partner'),
    t('Lead partner'),
  ]
  const stats = [
    [t('Available commission'), data.available_cents],
    [t('Settlement freeze'), data.frozen_cents],
    [t('Net lifetime commission'), data.net_cents],
    [t('Paid out'), data.paid_cents],
    [t('Payout processing'), data.processing_cents],
    [t('Refund recovery due'), data.member.debt_cents],
  ] as const
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Campus Partner')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Badge variant='outline'>
          {data.enabled ? t('Enrollment open') : t('Enrollment paused')}
        </Badge>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='flex w-full min-w-0 flex-col gap-4'>
          <section className='via-background relative overflow-hidden rounded-2xl border bg-gradient-to-br from-emerald-50 to-teal-50 p-5 sm:p-8 dark:from-emerald-950/30 dark:to-teal-950/20'>
            <div className='mb-4 flex items-center gap-2 text-emerald-700 dark:text-emerald-300'>
              <GraduationCap className='size-5' />
              <span className='text-sm font-medium'>
                {t('Share useful AI. Grow together.')}
              </span>
            </div>
            <div className='grid gap-6 sm:grid-cols-[1fr_auto] sm:items-end'>
              <div>
                <h1 className='max-w-xl text-2xl font-semibold tracking-tight sm:text-3xl'>
                  {t('Your recommendations deserve a reward.')}
                </h1>
                <p className='text-muted-foreground mt-3 max-w-xl text-sm leading-6'>
                  {t(
                    'Everyone can join. Earn 30%–50% on direct friends’ top-ups, 5% on Plus and 10% on Ultra. Your friends get one personal 5% off coupon.'
                  )}
                </p>
              </div>
              <div>
                <p className='text-muted-foreground text-xs'>
                  {t('Top-up commission up to')}
                </p>
                <p className='text-5xl font-semibold tracking-tight text-emerald-700 dark:text-emerald-300'>
                  50<span className='text-2xl'>%</span>
                </p>
              </div>
            </div>
          </section>
          <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3'>
            {stats.map(([label, amount]) => (
              <Card key={label}>
                <CardHeader className='pb-2'>
                  <CardDescription>{label}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className='text-2xl font-semibold break-all tabular-nums'>
                    {cash(amount, locale)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
          {data.member.debt_cents > 0 && (
            <p className='rounded-xl border p-4 text-sm'>
              {t(
                'Refunded paid-out commissions are recovered from available funds, then future matured commissions. No separate transfer is required.'
              )}
            </p>
          )}
          <div className='grid items-start gap-4 lg:grid-cols-2'>
            <Card>
              <CardHeader>
                <CardTitle>{t('Invite a friend')}</CardTitle>
                <CardDescription>
                  {t(
                    'A dedicated invitation, separate from the previous referral program.'
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className='space-y-4'>
                {data.member.joined_at > 0 ? (
                  <>
                    <div className='bg-muted flex min-w-0 items-center justify-between gap-2 rounded-lg p-3'>
                      <code className='text-base break-all'>
                        {data.member.code}
                      </code>
                      <CopyButton value={data.member.code} />
                    </div>
                    <div className='flex min-w-0 items-center gap-2'>
                      <p className='text-muted-foreground min-w-0 flex-1 text-xs break-all'>
                        {link}
                      </p>
                      <CopyButton
                        value={link}
                        tooltip={t('Copy invitation link')}
                      />
                    </div>
                  </>
                ) : (
                  <Button
                    disabled={!data.enabled || join.isPending}
                    onClick={() => join.mutate()}
                  >
                    {t('Get my invitation code')}
                    <ArrowUpRight className='size-4' />
                  </Button>
                )}
                <div className='flex flex-wrap gap-5 text-sm'>
                  <span className='flex items-center gap-2'>
                    <Users className='size-4' />
                    {t('Invited')}: {data.invited}
                  </span>
                  <span>
                    {t('New this month')}: {data.this_month}
                  </span>
                </div>
                {data.can_bind && <InvitationField />}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>
                  Lv.{data.tier.level} · {tiers[data.tier.level - 1]}
                </CardTitle>
                <CardDescription>
                  {t('Current top-up rate')}: {data.tier.rate_percent}%
                </CardDescription>
              </CardHeader>
              <CardContent className='space-y-4'>
                <div>
                  <p className='text-muted-foreground text-sm'>
                    {t('Campaign net paid sales')}
                  </p>
                  <p className='mt-1 text-2xl font-semibold break-all tabular-nums'>
                    {cash(data.member.performance_cents, locale)}
                  </p>
                </div>
                <Progress
                  value={
                    data.tier.next_cents
                      ? Math.min(
                          100,
                          ((data.member.performance_cents -
                            data.tier.floor_cents) /
                            (data.tier.next_cents - data.tier.floor_cents)) *
                            100
                        )
                      : 100
                  }
                />
                <p className='text-sm'>
                  {data.tier.next_cents
                    ? t('{{amount}} to the next tier', {
                        amount: cash(data.tier.remaining_cents, locale),
                      })
                    : t('Highest partner tier reached')}
                </p>
                <p className='text-muted-foreground text-xs leading-5'>
                  {t(
                    'Includes qualifying RMB top-ups and Plus/Ultra payments on BeiAPI after activation. Tier upgrades apply only to new sales; subscription commission rates remain fixed.'
                  )}
                </p>
                <div className='flex flex-wrap gap-2'>
                  {[30, 35, 40, 45, 50].map((rate, index) => (
                    <Badge
                      key={rate}
                      variant={
                        data.tier.level === index + 1 ? 'default' : 'outline'
                      }
                    >
                      Lv.{index + 1} · {rate}% ·{' '}
                      {cash(
                        [0, 200000, 1000000, 3000000, 8000000][index],
                        locale
                      )}
                      +
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>{t('Withdraw to Alipay')}</CardTitle>
              <CardDescription>
                {t(
                  'Commission unlocks after 168 hours. Apply from CNY 100; approved applications are paid manually at month end.'
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className='flex flex-wrap items-center gap-4'>
              <Button
                disabled={data.available_cents < 10000}
                onClick={() => setWithdraw(true)}
              >
                {t('Request withdrawal')}
              </Button>
              <p className='text-muted-foreground flex-1 text-xs leading-5'>
                {t(
                  'Applications before the end of the 25th enter this month’s batch. Later applications enter next month. Balances carry forward; weekends do not change payout dates.'
                )}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <Gift className='size-4' />
                {t('My coupon')}
              </CardTitle>
            </CardHeader>
            <CardContent className='flex flex-wrap items-center gap-3'>
              <span className='text-sm'>
                {data.member.coupon_state
                  ? t(`Campus coupon ${data.member.coupon_state}`)
                  : t('No campus coupon yet')}
              </span>
              <p className='text-muted-foreground min-w-0 flex-1 text-xs'>
                {t(
                  '5% off one top-up. No expiry, personal use only, not valid for subscriptions. Refunds do not restore a used coupon.'
                )}
              </p>
              <Link to='/wallet'>
                <Button variant='outline'>{t('Go to wallet')}</Button>
              </Link>
            </CardContent>
          </Card>
          <Tabs defaultValue='payments'>
            <TabsList className='flex h-auto flex-wrap'>
              <TabsTrigger value='payments'>
                {t('Commission orders')}
              </TabsTrigger>
              <TabsTrigger value='invitations'>{t('Invitations')}</TabsTrigger>
              <TabsTrigger value='entries'>
                {t('Commission ledger')}
              </TabsTrigger>
              <TabsTrigger value='withdrawals'>{t('Withdrawals')}</TabsTrigger>
            </TabsList>
            {['payments', 'invitations', 'entries', 'withdrawals'].map(
              (kind) => (
                <TabsContent key={kind} value={kind}>
                  <CampusRecords kind={kind} />
                </TabsContent>
              )
            )}
          </Tabs>
        </div>
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
