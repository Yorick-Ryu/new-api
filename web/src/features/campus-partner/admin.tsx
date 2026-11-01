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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { toIntlLocale } from '@/i18n/languages'
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import { campusGet, campusPost, cash, useCampusAction } from './api'
import { campusWithdrawalStateLabels } from './constants'
import { CampusFields } from './forms'
import { CampusRecords, type CampusRecord } from './records'

type Config = { enabled: boolean; plus_plan_id: number; ultra_plan_id: number }
type Preview = {
  refund_cents: number
  reversal_cents: number
  immediate_cents: number
  debt_cents: number
  performance_cents: number
  expected_refunded_cents: number
}
export function CampusAdmin() {
  const { t } = useTranslation()
  const config = useQuery({
    queryKey: ['campus', 'config'],
    queryFn: () => campusGet<Config>('admin/config'),
  })
  const [selected, setSelected] = useState<CampusRecord | null>(null)
  if (config.isPending) return <LoadingState />
  if (config.isError) {
    return <ErrorState onRetry={() => void config.refetch()} />
  }
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Campus Partner administration')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex w-full min-w-0 flex-col gap-4'>
          <div className='grid items-start gap-4 lg:grid-cols-2'>
            <CampusConfiguration
              key={JSON.stringify(config.data)}
              config={config.data}
            />
            <CampusRefundForm />
          </div>
          <CampusReconcileForm />
          <Tabs defaultValue='withdrawals'>
            <TabsList className='flex h-auto flex-wrap'>
              {[
                ['withdrawals', 'Withdrawals'],
                ['payments', 'Commission orders'],
                ['refunds', 'Refunds'],
                ['entries', 'Audit trail'],
                ['invitations', 'Invitations'],
              ].map(([key, label]) => (
                <TabsTrigger key={key} value={key}>
                  {t(label)}
                </TabsTrigger>
              ))}
            </TabsList>
            {[
              'withdrawals',
              'payments',
              'refunds',
              'entries',
              'invitations',
            ].map((kind) => (
              <TabsContent key={kind} value={kind}>
                <CampusRecords
                  kind={kind}
                  admin
                  onAction={kind === 'withdrawals' ? setSelected : undefined}
                />
              </TabsContent>
            ))}
          </Tabs>
        </div>
        <Dialog
          open={!!selected}
          onOpenChange={(open) => {
            if (!open) setSelected(null)
          }}
          title={t('Review withdrawal')}
          description={t(
            'Approve first, transfer manually at month end, then record the actual transfer. An unknown result must not release reserved funds.'
          )}
        >
          {selected && (
            <CampusWithdrawalReview
              key={selected.id}
              row={selected}
              close={() => setSelected(null)}
            />
          )}
        </Dialog>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
function CampusConfiguration(props: { config: Config }) {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(props.config.enabled)
  const save = useCampusAction(async (values: Record<string, string>) => {
    const response = await api.put('/api/campus/admin/config', {
      enabled,
      plus_plan_id: Number(values.plus),
      ultra_plan_id: Number(values.ultra),
    })
    return requireServerSuccess(response.data)
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Campaign settings')}</CardTitle>
        <CardDescription>
          {t(
            'Enrollment and new commission start only after activation. Pausing preserves balances, withdrawals and previously issued coupons.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        <div className='flex items-center gap-3'>
          <Switch
            id='campus-enabled'
            checked={enabled}
            onCheckedChange={setEnabled}
          />
          <Label htmlFor='campus-enabled'>
            {t('Enable enrollment and new commission')}
          </Label>
        </div>
        <CampusFields
          fields={[
            {
              name: 'plus',
              label: 'Plus subscription plan ID',
              value: String(props.config.plus_plan_id),
              type: 'number',
            },
            {
              name: 'ultra',
              label: 'Ultra subscription plan ID',
              value: String(props.config.ultra_plan_id),
              type: 'number',
            },
          ]}
          submit='Save campaign settings'
          pending={save.isPending}
          onSubmit={(values) =>
            save.mutate(values, {
              onSuccess: () => toast.success(t('Campaign settings saved')),
            })
          }
        />
      </CardContent>
    </Card>
  )
}
function CampusRefundForm() {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [pending, setPending] = useState<{
    values: Record<string, string>
    preview: Preview
  } | null>(null)
  const preview = useCampusAction((values: Record<string, string>) =>
    campusPost<Preview>('admin/refund', { ...values, preview: true }).then(
      (result) => setPending({ values, preview: result })
    )
  )
  const confirm = useCampusAction(() =>
    campusPost('admin/refund', {
      ...pending?.values,
      preview: false,
      expected_refunded_cents: pending?.preview.expected_refunded_cents,
    })
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Register an actual refund')}</CardTitle>
        <CardDescription>
          {t(
            'This adjusts campaign commission only. Confirm that the original payment refund and wallet or subscription adjustment have been handled separately.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CampusFields
          fields={[
            { name: 'trade_no', label: 'Original order number' },
            { name: 'reference', label: 'Unique refund reference' },
            { name: 'amount', label: 'Refund amount (CNY)' },
            { name: 'reason', label: 'Reason and reconciliation evidence' },
          ]}
          submit='Preview refund adjustment'
          pending={preview.isPending}
          onSubmit={(values) => preview.mutate(values)}
        />
        <ConfirmDialog
          open={!!pending}
          onOpenChange={(open) => {
            if (!open) setPending(null)
          }}
          title={t('Confirm refund adjustment')}
          desc={t(
            'Review the commission reversal before recording this refund.'
          )}
          destructive
          isLoading={confirm.isPending}
          handleConfirm={() =>
            confirm.mutate(undefined, { onSuccess: () => setPending(null) })
          }
        >
          {pending && (
            <dl className='grid grid-cols-2 gap-3 text-sm'>
              {[
                [t('Commission reversal'), pending.preview.reversal_cents],
                [t('Immediate deduction'), pending.preview.immediate_cents],
                [t('New recovery due'), pending.preview.debt_cents],
                [
                  t('Remaining campaign sales'),
                  pending.preview.performance_cents,
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className='text-muted-foreground'>{label}</dt>
                  <dd>{cash(Number(value), locale)}</dd>
                </div>
              ))}
            </dl>
          )}
        </ConfirmDialog>
      </CardContent>
    </Card>
  )
}
function CampusWithdrawalReview(props: {
  row: CampusRecord
  close: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [action, setAction] = useState('approve')
  const save = useCampusAction((values: Record<string, string>) =>
    campusPost(`admin/withdrawals/${props.row.id}`, {
      action,
      reason: values.reason,
      receipt: values.receipt || '',
      paid_at: values.paid_at
        ? Math.floor(new Date(`${values.paid_at}+08:00`).getTime() / 1000)
        : 0,
    })
  )
  return (
    <div className='space-y-5'>
      <p className='text-sm break-all'>
        {props.row.account} · {props.row.real_name}
        <br />
        {cash(props.row.amount_cents ?? 0, locale)} · {props.row.batch} ·{' '}
        {t(campusWithdrawalStateLabels[props.row.state || ''] || '')}
      </p>
      <div className='flex flex-wrap gap-2'>
        {[
          ['approve', 'Approve'],
          ['pause', 'Pause'],
          ['resume', 'Resume review'],
          ['reject', 'Reject'],
          ['unknown', 'Result unknown'],
          ['failed', 'Confirmed transfer failure'],
          ['defer', 'Defer batch'],
          ['paid', 'Record completed transfer'],
        ].map(([key, label]) => (
          <Button
            key={key}
            size='sm'
            variant={action === key ? 'default' : 'outline'}
            onClick={() => setAction(key)}
          >
            {t(label)}
          </Button>
        ))}
      </div>
      <CampusFields
        key={action}
        fields={[
          { name: 'reason', label: 'Reason and reconciliation evidence' },
          ...(action === 'paid'
            ? [
                { name: 'receipt', label: 'Transfer receipt' },
                {
                  name: 'paid_at',
                  label: 'Actual transfer time (Beijing)',
                  type: 'datetime-local',
                },
              ]
            : []),
        ]}
        submit='Confirm operation'
        pending={save.isPending}
        onSubmit={(values) => save.mutate(values, { onSuccess: props.close })}
      />
    </div>
  )
}

function CampusReconcileForm() {
  const { t } = useTranslation()
  const [result, setResult] = useState('paid')
  const action = useCampusAction((values: Record<string, string>) =>
    campusPost('admin/reconcile', { ...values, result })
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Reconcile a payment order')}</CardTitle>
        <CardDescription>
          {t(
            'Record only verified real collection or a provider-confirmed closed unpaid order. Unknown or delayed results must not release the coupon.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        <div className='flex flex-wrap gap-2'>
          <Button
            variant={result === 'paid' ? 'default' : 'outline'}
            onClick={() => setResult('paid')}
          >
            {t('Actual payment received')}
          </Button>
          <Button
            variant={result === 'closed' ? 'default' : 'outline'}
            onClick={() => setResult('closed')}
          >
            {t('Provider confirmed unpaid and closed')}
          </Button>
        </div>
        <CampusFields
          key={result}
          fields={[
            { name: 'trade_no', label: 'Original order number' },
            ...(result === 'paid'
              ? [{ name: 'reference', label: 'Provider transaction number' }]
              : []),
            { name: 'evidence', label: 'Reason and reconciliation evidence' },
          ]}
          submit='Confirm reconciliation'
          pending={action.isPending}
          onSubmit={(values) =>
            action.mutate(values, {
              onSuccess: () => toast.success(t('Reconciliation recorded')),
            })
          }
        />
      </CardContent>
    </Card>
  )
}
