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
import type { ColumnDef } from '@tanstack/react-table'
import type { TFunction } from 'i18next'

import { TruncatedCell } from '@/components/data-table'
import { Button } from '@/components/ui/button'

import { beijingDate, cash } from './api'
import { campusAmountTypography } from './constants'
import { CampusFriend } from './friend-cell'
import { InvitationAccount } from './invitation-account'
import { CampusCommissionStatus } from './record-status'
import type { CampusRecord } from './records'

export function commissionColumns(
  t: TFunction,
  locale: string | undefined,
  onDetails: (row: CampusRecord) => void,
  admin = false
): ColumnDef<CampusRecord>[] {
  const columns: ColumnDef<CampusRecord>[] = [
    {
      id: 'time',
      accessorFn: (row) => row.settled_at,
      header: t('Time'),
      cell: ({ row: { original: row } }) =>
        beijingDate(row.settled_at || 0, locale, true),
    },
    {
      id: 'friend',
      accessorFn: (row) => row.masked_name || row.username || row.display_name,
      header: t('Invitee'),
      cell: ({ row: { original: row } }) =>
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
      accessorFn: (row) => row.trade_no,
      header: t('Order number'),
      cell: ({ row: { original: row } }) => (
        <TruncatedCell className='max-w-56 font-mono!'>
          {row.trade_no || '—'}
        </TruncatedCell>
      ),
    },
    {
      id: 'product',
      accessorFn: (row) => row.product,
      header: t('Top-up type'),
      cell: ({ row: { original: row } }) =>
        t(
          row.product === 'subscription'
            ? 'Subscription purchase'
            : 'Balance top-up'
        ),
    },
    {
      id: 'commission',
      accessorFn: (row) =>
        (row.commission_cents || 0) - (row.reversed_cents || 0),
      header: t('Commission'),
      cell: ({ row: { original: row } }) => (
        <span className={campusAmountTypography}>
          {cash(
            (row.commission_cents || 0) - (row.reversed_cents || 0),
            locale
          )}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('Status'),
      cell: ({ row: { original: row } }) => (
        <CampusCommissionStatus row={row} admin={admin} />
      ),
    },
    {
      id: 'actions',
      header: t('Details'),
      cell: ({ row: { original: row } }) => (
        <Button variant='outline' size='sm' onClick={() => onDetails(row)}>
          {t('Details')}
        </Button>
      ),
    },
  ]
  if (admin) {
    columns.unshift({
      id: 'inviter',
      accessorFn: (row) => row.inviter_username || row.inviter_display_name,
      header: t('Inviter'),
      cell: ({ row: { original: row } }) =>
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
  return columns.map((column) => ({
    ...column,
    meta: {
      label: typeof column.header === 'string' ? column.header : undefined,
      mobileTitle: column.id === 'friend',
      mobileBadge: column.id === 'status',
    },
    enableHiding: column.id !== 'actions',
  }))
}
