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
import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { campusPost, campusSite, useCampus, useCampusAction } from './api'
import { campusTierNameKeys } from './constants'
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
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Campus Partner')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Badge variant='outline' className='border-primary/30 text-primary'>
          {t('Lv.{{level}}', { level: data.tier.level })} ·{' '}
          {data.tiers[data.tier.level - 1]?.name ||
            t(campusTierNameKeys[data.tier.level - 1] || 'Lv.{{level}}', {
              level: data.tier.level,
            })}{' '}
          · {t('Current commission rate')}{' '}
          {formatNumber(data.tier.rate_percent, locale)}%
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
          <PartnerInvitation
            data={data}
            pending={join.isPending}
            onJoin={() => join.mutate()}
          />
          <PartnerSummary data={data} onWithdraw={() => setWithdraw(true)} />
          <PartnerTiers data={data} />
          <Card className='py-0'>
            <Tabs defaultValue='invitations'>
              <div className='border-b p-3 sm:px-5'>
                <TabsList className='flex h-auto flex-wrap'>
                  <TabsTrigger value='invitations'>
                    {t('Invitations')}{' '}
                    <span className='tabular-nums'>
                      {formatNumber(data.invited, locale)}
                    </span>
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
                <TabsContent value='invitations'>
                  <CampusRecords kind='invitations' />
                </TabsContent>
                <TabsContent value='entries' className='space-y-4'>
                  <CampusRecords kind='payments' />
                  <Accordion>
                    <AccordionItem value='balance-changes'>
                      <AccordionTrigger>
                        {t('Balance changes')}
                      </AccordionTrigger>
                      <AccordionContent>
                        <CampusRecords kind='entries' />
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </TabsContent>
                <TabsContent value='withdrawals'>
                  <CampusRecords kind='withdrawals' />
                </TabsContent>
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
            'We will review your request as soon as possible and pay after approval. Expected payout: {{date}}',
            { date: data.expected_batch }
          )}
        >
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
