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
import { campusAmountTypography } from './constants'
import { CampusFriend } from './friend-cell'
import { InvitationAccount } from './invitation-account'
import type { CampusRecord } from './records'

export function commissionStatus(row: CampusRecord): string {
  if ((row.refunded_cents || 0) > 0) {
    return (row.refunded_cents || 0) >= (row.paid_cents || 0)
      ? 'Fully refunded'
      : 'Partially refunded'
  }
  return (row.frozen_cents || 0) > 0 ? 'Pending settlement' : 'Settled'
}

export function commissionColumns(
  t: TFunction,
  locale: string | undefined,
  onDetails: (row: CampusRecord) => void,
  admin = false
): StaticDataTableColumn<CampusRecord>[] {
  const columns: StaticDataTableColumn<CampusRecord>[] = [
    {
      id: 'time',
      header: t('Time'),
      cell: (row) => beijingDate(row.settled_at || 0, locale, true),
    },
    {
      id: 'friend',
      header: t(admin ? 'Invitee' : 'Friend'),
      cell: (row) =>
        admin ? (
          <InvitationAccount
            id={row.user_id}
            username={row.username || ''}
            displayName={row.display_name || ''}
          />
        ) : (
          <CampusFriend userId={row.user_id} name={row.masked_name} />
        ),
    },
    {
      id: 'order',
      header: t('Order number'),
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
      cellClassName: campusAmountTypography,
      cell: (row) =>
        cash((row.commission_cents || 0) - (row.reversed_cents || 0), locale),
    },
    {
      id: 'status',
      header: t('Status'),
      cell: (row) => (
        <Badge variant='outline'>
          {t(
            admin && row.eligibility && row.eligibility !== 'eligible'
              ? row.eligibility
              : commissionStatus(row)
          )}
        </Badge>
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
  if (admin) {
    columns.unshift({
      id: 'inviter',
      header: t('Inviter'),
      cell: (row) =>
        row.inviter_id ? (
          <InvitationAccount
            id={row.inviter_id}
            username={row.inviter_username || ''}
            displayName={row.inviter_display_name || ''}
          />
        ) : (
          '—'
        ),
    })
    const friendIndex = columns.findIndex((column) => column.id === 'friend')
    columns.splice(1, 0, ...columns.splice(friendIndex, 1))
  }
  return columns
}
