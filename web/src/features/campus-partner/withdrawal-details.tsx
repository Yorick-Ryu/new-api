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
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import { payoutWindow, beijingDate, cash } from './api'
import {
  campusAmountTypography,
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
  const fields = [
    [t('Withdrawal number'), `#${row.id}`],
    [t('Withdrawal time'), beijingDate(row.created_at || 0, locale, true)],
    [t('Amount'), cash(row.amount_cents || 0, locale)],
    [
      t('Status'),
      t(campusWithdrawalStateLabels[row.state || ''] || row.state || '—'),
    ],
    [t('Expected payout'), payoutWindow(row.batch)],
    [t('Alipay account'), row.account || '—'],
    [t('Real name'), row.real_name || '—'],
  ]
  if (props.admin) {
    fields.unshift([
      t('User'),
      `${row.username || row.display_name || '—'} (#${row.user_id})`,
    ])
    if (row.partner_tier) {
      fields.splice(
        1,
        0,
        [
          t('Partner level'),
          `Lv.${row.partner_tier.level} · ${row.partner_tier_name || t(campusTierNameKeys[row.partner_tier.level - 1] || 'Partner level')}`,
        ],
        [
          t('Top-up commission rate'),
          `${formatNumber(row.partner_tier.rate_percent, locale)}%`,
        ],
        [
          t('Friends cumulative top-ups'),
          cash(row.performance_cents || 0, locale),
        ],
        [t('Total commission'), cash(row.total_commission_cents || 0, locale)]
      )
    }
  }
  if (row.reason) fields.push([t('Reason'), t(row.reason)])
  if (row.paid_at) {
    fields.push([
      t('Actual transfer time'),
      beijingDate(row.paid_at, locale, true),
    ])
  }
  if (row.receipt) fields.push([t('Transfer receipt'), row.receipt])
  if (props.admin && row.actor_id) {
    fields.push([t('Processed by'), `#${row.actor_id}`])
  }
  return (
    <dl className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
      {fields.map(([label, value]) => (
        <div key={label} className='min-w-0 space-y-1'>
          <dt className='text-muted-foreground text-sm'>{label}</dt>
          <dd
            className={cn(
              'break-all tabular-nums',
              [
                t('Amount'),
                t('Friends cumulative top-ups'),
                t('Total commission'),
              ].includes(label) && campusAmountTypography
            )}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
