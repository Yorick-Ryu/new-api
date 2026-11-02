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
import type { TFunction } from 'i18next'

import type { StaticDataTableColumn } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import { beijingDate, cash } from './api'
import type { CampusRecord } from './records'

export function commissionStatus(row: CampusRecord): string {
  if ((row.refunded_cents || 0) > 0) {
    if ((row.refunded_cents || 0) >= (row.paid_cents || 0)) {
      return 'Fully refunded'
    }
    return 'Partially refunded'
  }
  if (!row.settled_at) return 'Awaiting payment'
  if ((row.frozen_cents || 0) > 0) return 'Pending settlement'
  if ((row.reserved_cents || 0) > 0) return 'Withdrawal in progress'
  if ((row.available_cents || 0) > 0) return 'Available to withdraw'
  if ((row.paid_out_cents || 0) > 0) return 'Paid out'
  if ((row.offset_cents || 0) > 0) return 'Commission offset'
  return 'Settled'
}

export function commissionColumns(
  t: TFunction,
  locale: string | undefined,
  onDetails: (row: CampusRecord) => void
): StaticDataTableColumn<CampusRecord>[] {
  return [
    {
      id: 'time',
      header: t('Time (Beijing)'),
      cell: (row) => beijingDate(row.settled_at || 0, locale),
    },
    {
      id: 'friend',
      header: t('Friend'),
      cell: (row) => row.masked_name || '***',
    },
    {
      id: 'order',
      header: t('Masked order number'),
      cell: (row) => row.trade_no || '—',
    },
    {
      id: 'product',
      header: t('Top-up type'),
      cell: (row) =>
        t(
          row.product === 'subscription'
            ? 'Subscription purchase'
            : 'Balance top-up'
        ),
    },
    {
      id: 'commission',
      header: t('Commission'),
      cellClassName: 'font-semibold tabular-nums',
      cell: (row) =>
        cash((row.commission_cents || 0) - (row.reversed_cents || 0), locale),
    },
    {
      id: 'status',
      header: t('Status'),
      cell: (row) => (
        <Badge variant='outline'>{t(commissionStatus(row))}</Badge>
      ),
    },
    {
      id: 'details',
      header: t('Details'),
      cell: (row) => (
        <Button variant='outline' size='sm' onClick={() => onDetails(row)}>
          {t('Details')}
        </Button>
      ),
    },
  ]
}
