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

import {
  StaticDataTable,
  staticDataTableClassNames,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'

import { beijingDate, campusGet, cash } from './api'
import { commissionColumns } from './commission-columns'
import { CommissionDetails } from './commission-records'
import { campusWithdrawalStateLabels } from './constants'
import { CampusFriend } from './friend-cell'
import { InvitationAccount } from './invitation-account'
import { matchesRecordFilters } from './record-filter-matching'
import { CampusRecordFilters, type RecordFilters } from './record-filters'
import { WithdrawalDetails } from './withdrawal-details'

export type CampusRecord = {
  id: number
  user_id: number
  partner_tier?: { level: number; name?: string; rate_percent: number }
  partner_tier_name?: string
  performance_cents?: number
  inviter_id?: number
  inviter_username?: string
  inviter_display_name?: string
  username?: string
  display_name?: string
  masked_name?: string
  registered_at?: number
  payment_id?: number
  withdrawal_id?: number
  actor_id?: number
  reference?: string
  trade_no?: string
  product?: string
  amount_cents?: number
  paid_cents?: number
  commission_cents?: number
  reversed_cents?: number
  frozen_cents?: number
  available_cents?: number
  refunded_cents?: number
  offset_cents?: number
  eligibility?: string
  segments?: string
  state?: string
  created_at?: number
  settled_at?: number
  bound_at?: number
  batch?: string
  reason?: string
  account?: string
  real_name?: string
  receipt?: string
  paid_at?: number
}
export function CampusRecords(props: {
  kind: string
  admin?: boolean
  onAction?: (row: CampusRecord) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [page, setPage] = useState(1)
  const [draft, setDraft] = useState<RecordFilters>({})
  const [filters, setFilters] = useState<RecordFilters>({})
  const [selected, setSelected] = useState<CampusRecord | null>(null)
  const paymentColumns = commissionColumns(t, locale, setSelected, props.admin)
  const commissionView = props.kind === 'payments'
  const hasFilters = Object.values(filters).some(
    (value) => value && value !== 'all'
  )
  const query = useQuery({
    queryKey: hasFilters
      ? ['campus', 'records', !!props.admin, props.kind, page, filters]
      : ['campus', 'records', !!props.admin, props.kind, page],
    queryFn: async () => {
      const path = `${props.admin ? 'admin' : 'self'}/records/${props.kind}`
      if (!hasFilters) {
        return campusGet<{ items: CampusRecord[]; total: number }>(
          `${path}?page=${page}&size=10`
        )
      }
      const items: CampusRecord[] = []
      let currentPage = 1
      let total = 0
      do {
        const result = await campusGet<{
          items: CampusRecord[]
          total: number
        }>(`${path}?page=${currentPage}&size=100`)
        items.push(...result.items)
        total = result.total
        if (result.items.length === 0) break
        currentPage += 1
      } while (items.length < total)
      const filtered = items.filter((row) =>
        matchesRecordFilters(row, filters, commissionView)
      )
      return {
        items: filtered.slice((page - 1) * 10, page * 10),
        total: filtered.length,
      }
    },
  })
  let columns: StaticDataTableColumn<CampusRecord>[] =
    props.kind === 'invitations'
      ? [
          {
            id: 'friend',
            header: t('Friend'),
            cell: (row) => (
              <CampusFriend
                userId={row.user_id}
                name={row.masked_name}
                admin={props.admin}
              />
            ),
          },
          {
            id: 'registered',
            header: t('Registration time'),
            cellClassName: 'tabular-nums',
            cell: (row) => beijingDate(row.registered_at || 0, locale),
          },
          {
            id: 'paid',
            header: t('Cumulative top-ups'),
            className: 'text-right',
            cellClassName: 'text-right tabular-nums',
            cell: (row) => cash(row.paid_cents || 0, locale),
          },
          {
            id: 'commission',
            header: props.admin ? t('Commission') : t('Commission contributed'),
            className: 'text-right',
            cellClassName: 'text-primary text-right font-semibold tabular-nums',
            cell: (row) => cash(row.commission_cents || 0, locale),
          },
        ]
      : [
          {
            id: 'date',
            header: t('Time'),
            cell: (row) =>
              beijingDate(
                row.created_at || row.settled_at || row.bound_at || 0,
                locale,
                props.kind === 'withdrawals' || props.kind === 'refunds'
              ),
          },
          {
            id: 'source',
            header: props.kind === 'refunds' ? t('Order number') : t('Source'),
            cell: (row) => (
              <div className='max-w-64 break-all whitespace-normal'>
                {row.trade_no || `#${row.user_id}`}
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
  if (commissionView) columns = paymentColumns
  if (props.kind !== 'invitations' && !commissionView) {
    columns.push({
      id: 'amount',
      header: props.kind === 'withdrawals' ? t('Amount') : t('Amount (CNY)'),
      cell: (row) => (
        <div className='space-y-1 tabular-nums'>
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
      header: t('Details'),
      cell: (row) => (
        <div className='max-w-72 space-y-2 whitespace-normal'>
          {row.state && (
            <Badge variant='outline'>
              {t(campusWithdrawalStateLabels[row.state] || row.state)}
            </Badge>
          )}
          {row.batch && (
            <p>
              {t('Expected payout')}: {row.batch}
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
        header: t('Status'),
        cell: (row) => (
          <Badge variant='outline'>
            {t(
              campusWithdrawalStateLabels[row.state || ''] || row.state || '—'
            )}
          </Badge>
        ),
      },
      {
        id: 'details',
        header: t('Details'),
        cell: (row) => (
          <Button variant='outline' size='sm' onClick={() => setSelected(row)}>
            {t('Details')}
          </Button>
        ),
      }
    )
  }
  if (props.onAction) {
    columns = columns.filter((column) => column.id !== 'details')
    columns.push({
      id: 'action',
      header: t('Actions'),
      cell: (row) => (
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
      header: t('User'),
      cell: (row) => (
        <InvitationAccount
          id={row.user_id}
          username={row.username || ''}
          displayName={row.display_name || ''}
        />
      ),
    })
  }
  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  return (
    <div className='space-y-3'>
      {(commissionView || props.kind === 'withdrawals') && (
        <CampusRecordFilters
          payments={commissionView}
          admin={props.admin}
          value={draft}
          onChange={setDraft}
          loading={query.isFetching}
          onSearch={() => {
            setFilters({ ...draft })
            setPage(1)
          }}
          onReset={() => {
            setDraft({})
            setFilters({})
            setPage(1)
          }}
        />
      )}
      <div className='max-w-full overflow-x-auto'>
        <StaticDataTable
          data={query.data.items || []}
          columns={columns}
          getRowKey={(row) => row.id || row.user_id}
          emptyContent={<EmptyState title={t('No records yet')} />}
          headerRowClassName={
            props.kind === 'invitations'
              ? staticDataTableClassNames.mutedHeaderRow
              : undefined
          }
        />
      </div>
      {props.kind === 'withdrawals' ? (
        <WithdrawalDetails
          row={selected}
          admin={props.admin}
          onClose={() => setSelected(null)}
        />
      ) : (
        <CommissionDetails
          row={selected}
          admin={props.admin}
          onClose={() => setSelected(null)}
        />
      )}
      <div className='flex flex-wrap items-center justify-end gap-3'>
        <Button
          variant='outline'
          size='sm'
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          {t('Previous page')}
        </Button>
        <span className='text-sm'>
          {page} / {Math.max(1, Math.ceil(query.data.total / 10))}
        </span>
        <Button
          variant='outline'
          size='sm'
          disabled={page * 10 >= query.data.total}
          onClick={() => setPage(page + 1)}
        >
          {t('Next page')}
        </Button>
      </div>
    </div>
  )
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
