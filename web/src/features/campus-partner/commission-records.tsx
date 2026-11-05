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

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import {
  DetailRow,
  DetailSection,
} from '@/features/usage-logs/components/dialogs/log-detail-layout'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { beijingDate, cash } from './api'
import {
  campusDetailAmountTypography,
  campusDetailDialogProps,
} from './constants'
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
      {...campusDetailDialogProps}
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={t('Commission details')}
    >
      <div className='flex min-w-0 flex-col gap-1'>
        {props.admin && (
          <DetailRow
            label={t('Inviter')}
            value={
              row.inviter_id
                ? `${row.inviter_username || row.inviter_display_name || ''} #${row.inviter_id}`
                : '—'
            }
          />
        )}
        <DetailRow
          label={t('Time')}
          value={beijingDate(row.settled_at || 0, locale, true)}
          mono
        />
        <DetailRow
          label={t(props.admin ? 'Invitee' : 'Friend')}
          value={
            props.admin
              ? `${row.username || row.display_name || ''} #${row.user_id}`
              : row.masked_name || '***'
          }
        />
        <DetailRow
          label={t('Order number')}
          value={
            <span className='inline-flex w-full min-w-0 items-start gap-1'>
              <span className='min-w-0 flex-1 break-all'>
                {row.trade_no || '—'}
              </span>
              {row.trade_no && (
                <CopyButton
                  value={row.trade_no}
                  aria-label={`${t('Copy')} ${t('Order number')}`}
                  className='size-6'
                  iconClassName='size-3.5'
                />
              )}
            </span>
          }
          mono
        />
        <DetailRow
          label={t('Top-up type')}
          value={t(
            row.product === 'subscription'
              ? 'Subscription purchase'
              : 'Balance top-up'
          )}
        />
      </div>
      <DetailSection label={t('Commission')}>
        <DetailRow
          label={t('Actual payment (CNY)')}
          value={
            <span className={campusDetailAmountTypography}>
              {cash(row.paid_cents || 0, locale)}
            </span>
          }
        />
        <DetailRow
          label={t('Commission')}
          value={
            <span className={campusDetailAmountTypography}>
              {cash(
                (row.commission_cents || 0) - (row.reversed_cents || 0),
                locale
              )}
            </span>
          }
        />
      </DetailSection>
      <DetailSection label={t('Commission calculation')}>
        <p className='font-mono! text-xs break-all tabular-nums sm:wrap-break-word'>
          {formula}
        </p>
        <p className='text-muted-foreground text-xs leading-relaxed'>
          {t(
            'Commission uses the actual payment and the rates saved at settlement. Segment results are added before rounding to cents.'
          )}
        </p>
      </DetailSection>
      {(row.refunded_cents || 0) > 0 && (
        <DetailSection label={t('Refund Details')}>
          <DetailRow
            label={t('Refund amount')}
            value={
              <span className={campusDetailAmountTypography}>
                {cash(row.refunded_cents || 0, locale)}
              </span>
            }
          />
          <DetailRow
            label={t('Commission reversed')}
            value={
              <span className={campusDetailAmountTypography}>
                {cash(row.reversed_cents || 0, locale)}
              </span>
            }
          />
          <p className='font-mono! text-xs break-all tabular-nums sm:wrap-break-word'>
            {cash(row.commission_cents || 0, locale)} −{' '}
            {cash(row.reversed_cents || 0, locale)} ={' '}
            {cash(
              (row.commission_cents || 0) - (row.reversed_cents || 0),
              locale
            )}
          </p>
        </DetailSection>
      )}
    </Dialog>
  )
}
