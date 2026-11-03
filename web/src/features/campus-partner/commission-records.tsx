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

import { beijingDate, cash } from './api'
import type { CampusRecord } from './records'

export function CommissionDetails(props: {
  row: CampusRecord | null
  admin?: boolean
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const row = props.row
  if (!row) return null
  const fields = [
    [t('Time'), beijingDate(row.settled_at || 0, locale, true)],
    [
      t(props.admin ? 'Invitee' : 'Friend'),
      props.admin
        ? `${row.username || row.display_name || ''} #${row.user_id}`
        : row.masked_name || '***',
    ],
    [t('Order number'), row.trade_no || '—'],
    [
      t('Top-up type'),
      t(
        row.product === 'subscription'
          ? 'Subscription purchase'
          : 'Balance top-up'
      ),
    ],
    [t('Actual payment (CNY)'), cash(row.paid_cents || 0, locale)],
    [
      t('Commission'),
      cash((row.commission_cents || 0) - (row.reversed_cents || 0), locale),
    ],
    [t('Settlement freeze'), cash(row.frozen_cents || 0, locale)],
  ]
  if (props.admin) {
    fields.unshift([
      t('Inviter'),
      row.inviter_id
        ? `${row.inviter_username || row.inviter_display_name || ''} #${row.inviter_id}`
        : '—',
    ])
  }
  let formula = t('Calculation unavailable')
  try {
    const segments: unknown = JSON.parse(row.segments || 'null')
    if (
      Array.isArray(segments) &&
      segments.length > 0 &&
      segments.every(
        (segment) =>
          typeof segment === 'object' &&
          segment !== null &&
          Number.isSafeInteger(segment.base_cents) &&
          segment.base_cents >= 0 &&
          Number.isFinite(segment.rate_percent) &&
          segment.rate_percent >= 0
      )
    ) {
      formula = segments
        .map(
          (segment) =>
            `${cash(segment.base_cents, locale)} × ${formatNumber(segment.rate_percent, locale)}%`
        )
        .join(' + ')
      formula += ` = ${cash(row.commission_cents || 0, locale)}`
    }
  } catch {
    /* Historical records may not contain a calculation snapshot. */
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={t('Commission details')}
    >
      <dl className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
        {fields.map(([label, value]) => (
          <div key={label} className='min-w-0 space-y-1'>
            <dt className='text-muted-foreground text-sm'>{label}</dt>
            <dd className='break-all tabular-nums'>{value}</dd>
          </div>
        ))}
      </dl>
      <div className='mt-6 space-y-2 rounded-lg border p-4'>
        <p className='font-medium'>{t('Commission calculation')}</p>
        <p className='break-words tabular-nums'>{formula}</p>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Commission uses the actual payment and the rates saved at settlement. Segment results are added before rounding to cents.'
          )}
        </p>
        {(row.refunded_cents || 0) > 0 && (
          <>
            <p>
              {t('Refund amount')}: {cash(row.refunded_cents || 0, locale)}
            </p>
            <p>
              {t('Commission reversed')}:{' '}
              {cash(row.reversed_cents || 0, locale)}
            </p>
            <p className='tabular-nums'>
              {cash(row.commission_cents || 0, locale)} −{' '}
              {cash(row.reversed_cents || 0, locale)} ={' '}
              {cash(
                (row.commission_cents || 0) - (row.reversed_cents || 0),
                locale
              )}
            </p>
          </>
        )}
      </div>
    </Dialog>
  )
}
