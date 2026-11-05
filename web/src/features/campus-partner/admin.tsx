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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { SettingsSwitchField } from '@/features/system-settings/components/settings-form-layout'
import {
  DetailRow,
  DetailSection,
} from '@/features/usage-logs/components/dialogs/log-detail-layout'
import { toIntlLocale } from '@/i18n/languages'
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import { CampusAdminInvitations } from './admin-invitations'
import {
  campusGet,
  campusPost,
  cash,
  useCampusAction,
  type CampaignConfig,
} from './api'
import { CampusTierSettings, CampusPlanSettings } from './commission-settings'
import {
  campusAmountTypography,
  campusDetailAmountTypography,
  campusDetailDialogProps,
} from './constants'
import { CampusFields } from './forms'
import { CampusRecords, type CampusRecord } from './records'
import { WithdrawalSummary } from './withdrawal-details'

type Config = Pick<CampaignConfig, 'enabled'>
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
    queryFn: () => campusGet<CampaignConfig>('admin/config'),
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
        <Tabs defaultValue='invitations' className='w-full min-w-0 gap-4'>
          <TabsList className='max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto'>
            {[
              ['settings', 'Campaign settings'],
              ['invitations', 'Invitations'],
              ['payments', 'Commission ledger'],
              ['withdrawals', 'Withdrawals'],
              ['refunds', 'Refunds'],
            ].map(([key, label]) => (
              <TabsTrigger key={key} value={key}>
                {t(label)}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value='settings' keepMounted>
            <div className='flex w-full min-w-0 flex-col gap-4'>
              <Card>
                <CardContent>
                  <CampusConfiguration config={config.data} />
                </CardContent>
              </Card>
              <CampusTierSettings
                key={`tiers-${config.data.tier_revision}`}
                config={config.data}
              />
              <CampusPlanSettings
                key={`plans-${config.data.plan_revision}`}
                config={config.data}
              />
              <CampusRefundForm />
            </div>
          </TabsContent>
          {['withdrawals', 'payments', 'refunds', 'invitations'].map((kind) => (
            <TabsContent key={kind} value={kind}>
              {kind === 'invitations' ? (
                <CampusAdminInvitations />
              ) : (
                <CampusRecords
                  kind={kind}
                  admin
                  onAction={kind === 'withdrawals' ? setSelected : undefined}
                />
              )}
            </TabsContent>
          ))}
        </Tabs>
        <Dialog
          {...campusDetailDialogProps}
          open={!!selected}
          onOpenChange={(open) => {
            if (!open) setSelected(null)
          }}
          title={t('Manage')}
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
  const [pending, setPending] = useState<boolean | null>(null)
  const save = useCampusAction(async (config: Config) => {
    const response = await api.put('/api/campus/admin/config', config)
    return requireServerSuccess(response.data)
  })
  return (
    <>
      <SettingsSwitchField
        className='gap-3 py-0'
        controlId='campus-enabled'
        label={t('Enable campaign')}
        description={t(
          'Campaign status changes take effect after confirmation.'
        )}
        checked={props.config.enabled}
        onCheckedChange={setPending}
        disabled={save.isPending}
      />
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !save.isPending) setPending(null)
        }}
        title={pending ? t('Enable campaign?') : t('Disable campaign?')}
        desc={t('Campaign status changes take effect after confirmation.')}
        isLoading={save.isPending}
        handleConfirm={() => {
          if (pending === null || save.isPending) return
          save.mutate(
            { enabled: pending },
            {
              onSuccess: () => {
                toast.success(
                  pending ? t('Campaign enabled') : t('Campaign disabled')
                )
                setPending(null)
              },
            }
          )
        }}
      />
    </>
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
        <CardTitle>{t('Refund registration')}</CardTitle>
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
            {
              name: 'amount',
              label: 'Refund amount (CNY)',
              className: campusAmountTypography,
            },
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
            <DetailSection label={t('Refund Details')}>
              {[
                [t('Commission reversal'), pending.preview.reversal_cents],
                [t('Immediate deduction'), pending.preview.immediate_cents],
                [t('New recovery due'), pending.preview.debt_cents],
                [
                  t('Remaining campaign sales'),
                  pending.preview.performance_cents,
                ],
              ].map(([label, value]) => (
                <DetailRow
                  key={label}
                  label={label}
                  value={
                    <span className={campusDetailAmountTypography}>
                      {cash(Number(value), locale)}
                    </span>
                  }
                />
              ))}
            </DetailSection>
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
  const { t } = useTranslation()
  const actionsByState: Record<string, string[]> = {
    pending: ['approve', 'pause', 'reject', 'defer'],
    approved: ['paid', 'pause', 'reject', 'unknown', 'failed', 'defer'],
    paused: ['resume', 'reject', 'defer'],
    unknown: ['paid', 'failed'],
  }
  const reasonPlaceholders: Record<string, string> = {
    approve: 'Enter approval reason (optional)',
    pause: 'Enter pause reason (optional)',
    resume: 'Enter resume reason (optional)',
    reject: 'Enter rejection reason (optional)',
    unknown: 'Enter verification notes (optional)',
    failed: 'Enter transfer failure reason (optional)',
    defer: 'Enter deferral reason (optional)',
    paid: 'Enter transfer notes (optional)',
  }
  const availableActions = actionsByState[props.row.state || ''] || []
  const [action, setAction] = useState(availableActions[0] || '')
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
      <WithdrawalSummary row={props.row} admin />
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
        ]
          .filter(([key]) => availableActions.includes(key))
          .map(([key, label]) => (
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
      {availableActions.includes(action) && (
        <CampusFields
          key={action}
          fields={[
            ...(action === 'paid'
              ? [
                  { name: 'receipt', label: 'Transfer receipt' },
                  {
                    name: 'paid_at',
                    label: 'Actual transfer time (Beijing)',
                    type: 'datetime-local',
                    value: new Date(Date.now() + 8 * 60 * 60 * 1000)
                      .toISOString()
                      .slice(0, 16),
                  },
                ]
              : []),
            {
              name: 'reason',
              label: 'Reason',
              placeholder: reasonPlaceholders[action],
              optional: true,
            },
          ]}
          submit='Confirm operation'
          pending={save.isPending}
          onSubmit={(values) => {
            if (!availableActions.includes(action)) return
            save.mutate(values, { onSuccess: props.close })
          }}
        />
      )}
    </div>
  )
}
