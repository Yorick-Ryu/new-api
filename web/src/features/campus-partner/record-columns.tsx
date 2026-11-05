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
import { cn } from '@/lib/utils'

import { payoutWindow, beijingDate, cash } from './api'
import { commissionColumns } from './commission-columns'
import { campusAmountTypography } from './constants'
import { CampusFriend } from './friend-cell'
import { InvitationAccount } from './invitation-account'
import { CampusWithdrawalStatus } from './record-status'
import type { CampusRecord } from './records'

export function recordColumns(
  t: TFunction,
  locale: string | undefined,
  props: {
    kind: string
    admin?: boolean
    onAction?: (row: CampusRecord) => void
    onDetails: (row: CampusRecord) => void
  }
): ColumnDef<CampusRecord>[] {
  let columns: ColumnDef<CampusRecord>[] =
    props.kind === 'invitations'
      ? [
          {
            id: 'friend',
            accessorFn: (row) => row.masked_name,
            header: t('Invitee'),
            cell: ({ row: { original: row } }) => (
              <CampusFriend
                userId={row.user_id}
                name={row.masked_name}
                admin={props.admin}
              />
            ),
          },
          {
            id: 'registered',
            accessorFn: (row) => row.registered_at,
            header: t('Registration time'),
            cell: ({ row: { original: row } }) =>
              beijingDate(row.registered_at || 0, locale),
          },
          {
            id: 'paid',
            accessorFn: (row) => row.paid_cents,
            header: t('Cumulative top-ups'),
            cell: ({ row: { original: row } }) => (
              <span className={campusAmountTypography}>
                {cash(row.paid_cents || 0, locale)}
              </span>
            ),
          },
          {
            id: 'commission',
            accessorFn: (row) => row.commission_cents,
            header: props.admin ? t('Commission') : t('Commission contributed'),
            cell: ({ row: { original: row } }) => (
              <span className={cn('text-primary', campusAmountTypography)}>
                {cash(row.commission_cents || 0, locale)}
              </span>
            ),
          },
        ]
      : [
          {
            id: 'date',
            accessorFn: (row) =>
              row.created_at || row.settled_at || row.bound_at,
            header: t('Time'),
            cell: ({ row: { original: row } }) =>
              beijingDate(
                row.created_at || row.settled_at || row.bound_at || 0,
                locale,
                props.kind === 'withdrawals' || props.kind === 'refunds'
              ),
          },
          {
            id: 'source',
            accessorFn: (row) => row.trade_no,
            header: props.kind === 'refunds' ? t('Order number') : t('Source'),
            cell: ({ row: { original: row } }) => (
              <div className='max-w-64 break-all whitespace-normal'>
                <TruncatedCell className='max-w-64 font-mono!'>
                  {row.trade_no || `#${row.user_id}`}
                </TruncatedCell>
                {row.payment_id ? (
                  <p className='text-xs'>
                    {t('Commission order')} #{row.payment_id}
                  </p>
                ) : null}
                {row.withdrawal_id ? (
                  <p className='text-xs'>
                    {t('Withdrawal request')} #{row.withdrawal_id}
                  </p>
                ) : null}
                {props.admin && props.kind !== 'refunds' && (
                  <p className='text-xs'>
                    {t('Account')} #{row.user_id}
                  </p>
                )}
                {row.product && (
                  <div className='text-muted-foreground text-xs'>
                    {t(row.product)}
                  </div>
                )}
              </div>
            ),
          },
        ]
  if (props.kind === 'withdrawals') {
    columns = columns.filter((column) => column.id !== 'source')
  }
  if (props.kind === 'payments') {
    return commissionColumns(t, locale, props.onDetails, props.admin)
  }
  if (props.kind !== 'invitations') {
    columns.push({
      id: 'amount',
      accessorFn: (row) => row.amount_cents ?? row.paid_cents,
      header: t('Amount'),
      cell: ({ row: { original: row } }) => (
        <div className={`space-y-1 ${campusAmountTypography}`}>
          {cash(row.amount_cents ?? row.paid_cents ?? 0, locale)}
          {row.commission_cents !== undefined && (
            <p className='text-muted-foreground text-xs'>
              {t('Commission')}:{' '}
              {cash(row.commission_cents - (row.reversed_cents || 0), locale)}
            </p>
          )}
        </div>
      ),
    })
    columns.push({
      id: 'details',
      accessorFn: (row) => row.reference || row.reason,
      header: t('Details'),
      cell: ({ row: { original: row } }) => (
        <div className='max-w-72 space-y-2 whitespace-normal'>
          {row.state && <CampusWithdrawalStatus state={row.state} />}
          {row.batch && (
            <p>
              {t('Expected payout')}: {payoutWindow(row.batch)}
            </p>
          )}
          {row.account && (
            <p className='break-all'>
              {row.account} · {row.real_name}
            </p>
          )}
          {row.eligibility && <p className='text-xs'>{t(row.eligibility)}</p>}
          {row.reference && (
            <p className='text-xs break-all'>
              {t('Refund reference')}: {row.reference}
            </p>
          )}
          {props.admin && !!row.actor_id && (
            <p className='text-xs'>
              {t('Processed by')} #{row.actor_id}
            </p>
          )}
          {row.reason && (
            <p className='text-muted-foreground text-xs'>{t(row.reason)}</p>
          )}
          {row.paid_at ? (
            <p>
              {t('Actual transfer time')}:{' '}
              {beijingDate(row.paid_at, locale, true)}
            </p>
          ) : null}
          {row.receipt && (
            <p className='break-all'>
              {t('Transfer receipt')}: {row.receipt}
            </p>
          )}
          {row.commission_cents !== undefined && (
            <p className='text-xs'>
              {t('Settlement freeze')}: {cash(row.frozen_cents || 0, locale)} ·{' '}
              {t('Available')}: {cash(row.available_cents || 0, locale)}
            </p>
          )}
          {row.segments && (
            <details>
              <summary className='cursor-pointer text-xs'>
                {t('Commission calculation')}
              </summary>
              <p className='text-xs break-all'>
                {formatSegments(row.segments, locale)}
              </p>
            </details>
          )}
        </div>
      ),
    })
  }
  if (props.kind === 'withdrawals') {
    columns = columns.filter((column) => column.id !== 'details')
    columns.push(
      {
        id: 'status',
        accessorFn: (row) => row.state,
        header: t('Status'),
        cell: ({ row: { original: row } }) => (
          <CampusWithdrawalStatus state={row.state} />
        ),
      },
      {
        id: 'actions',
        header: t('Details'),
        cell: ({ row: { original: row } }) => (
          <Button
            variant='outline'
            size='sm'
            onClick={() => props.onDetails(row)}
          >
            {t('Details')}
          </Button>
        ),
      }
    )
  }
  if (props.onAction) {
    columns = columns.filter((column) => column.id !== 'actions')
    columns.push({
      id: 'actions',
      header: t('Actions'),
      cell: ({ row: { original: row } }) => (
        <Button
          variant='outline'
          size='sm'
          onClick={() => props.onAction?.(row)}
        >
          {t('Manage')}
        </Button>
      ),
    })
  }
  if (
    props.admin &&
    (props.kind === 'withdrawals' || props.kind === 'refunds')
  ) {
    columns.unshift({
      id: 'user',
      accessorFn: (row) => row.username || row.display_name,
      header: t('User'),
      cell: ({ row: { original: row } }) => (
        <InvitationAccount
          id={row.user_id}
          username={row.username || ''}
          displayName={row.display_name || ''}
        />
      ),
    })
  }
  return columns.map((column) => ({
    ...column,
    meta: {
      label: typeof column.header === 'string' ? column.header : undefined,
      mobileTitle:
        column.id ===
          (props.admin && props.kind !== 'invitations' ? 'user' : 'friend') ||
        (props.kind === 'withdrawals' && !props.admin && column.id === 'date'),
      mobileBadge: column.id === 'status',
    },
    enableHiding: column.id !== 'actions',
  }))
}
function formatSegments(value: string, locale?: string) {
  try {
    const rows: unknown = JSON.parse(value)
    if (!Array.isArray(rows)) return '—'
    return rows
      .map(
        (row: { base_cents: number; rate_percent: number }) =>
          `${cash(row.base_cents, locale)} × ${row.rate_percent}%`
      )
      .join(' + ')
  } catch {
    return '—'
  }
}
