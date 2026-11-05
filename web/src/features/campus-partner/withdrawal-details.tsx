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

import { Dialog } from '@/components/dialog'
import {
  DetailRow,
  DetailSection,
} from '@/features/usage-logs/components/dialogs/log-detail-layout'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { payoutWindow, beijingDate, cash } from './api'
import {
  campusDetailAmountTypography,
  campusDetailDialogProps,
  campusTierNameKeys,
  campusWithdrawalStateLabels,
} from './constants'
import type { CampusRecord } from './records'

export function WithdrawalDetails(props: {
  row: CampusRecord | null
  admin?: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  if (!props.row) return null
  return (
    <Dialog
      {...campusDetailDialogProps}
      open
      title={t('Withdrawal request')}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <WithdrawalSummary row={props.row} admin={props.admin} />
    </Dialog>
  )
}

export function WithdrawalSummary(props: {
  row: CampusRecord
  admin?: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const row = props.row
  if (!row) return null
  return (
    <div className='flex min-w-0 flex-col gap-3'>
      <div className='flex min-w-0 flex-col gap-1'>
        {props.admin && (
          <DetailRow
            label={t('User')}
            value={`${row.username || row.display_name || '—'} (#${row.user_id})`}
          />
        )}
        <DetailRow label={t('Withdrawal number')} value={`#${row.id}`} mono />
        <DetailRow
          label={t('Withdrawal time')}
          value={beijingDate(row.created_at || 0, locale, true)}
          mono
        />
        <DetailRow
          label={t('Amount')}
          value={
            <span className={campusDetailAmountTypography}>
              {cash(row.amount_cents || 0, locale)}
            </span>
          }
        />
        <DetailRow
          label={t('Status')}
          value={t(
            campusWithdrawalStateLabels[row.state || ''] || row.state || '—'
          )}
        />
        <DetailRow
          label={t('Expected payout')}
          value={payoutWindow(row.batch)}
          mono
        />
      </div>
      {props.admin && row.partner_tier && (
        <DetailSection label={t('Campus Partner')}>
          <DetailRow
            label={t('Partner level')}
            value={`Lv.${row.partner_tier.level} · ${row.partner_tier_name || t(campusTierNameKeys[row.partner_tier.level - 1] || 'Partner level')}`}
          />
          <DetailRow
            label={t('Top-up commission rate')}
            value={`${formatNumber(row.partner_tier.rate_percent, locale)}%`}
            mono
          />
          <DetailRow
            label={t('Friends cumulative top-ups')}
            value={
              <span className={campusDetailAmountTypography}>
                {cash(row.performance_cents || 0, locale)}
              </span>
            }
          />
          <DetailRow
            label={t('Total commission')}
            value={
              <span className={campusDetailAmountTypography}>
                {cash(row.total_commission_cents || 0, locale)}
              </span>
            }
          />
        </DetailSection>
      )}
      <DetailSection label={t('Account')}>
        <DetailRow
          label={t('Alipay account')}
          value={row.account || '—'}
          mono
        />
        <DetailRow label={t('Real name')} value={row.real_name || '—'} />
      </DetailSection>
      {!!(
        row.reason ||
        row.paid_at ||
        row.receipt ||
        (props.admin && row.actor_id)
      ) && (
        <DetailSection label={t('Details')}>
          {row.reason && (
            <DetailRow label={t('Reason')} value={t(row.reason)} />
          )}
          {!!row.paid_at && (
            <DetailRow
              label={t('Actual transfer time')}
              value={beijingDate(row.paid_at, locale, true)}
              mono
            />
          )}
          {row.receipt && (
            <DetailRow label={t('Transfer receipt')} value={row.receipt} mono />
          )}
          {props.admin && !!row.actor_id && (
            <DetailRow
              label={t('Processed by')}
              value={`#${row.actor_id}`}
              mono
            />
          )}
        </DetailSection>
      )}
    </div>
  )
}
