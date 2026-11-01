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
  type StaticDataTableColumn,
} from '@/components/data-table'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'

import { beijingDate, campusGet, cash } from './api'
import { campusWithdrawalStateLabels } from './constants'

export type CampusRecord = {
  id: number
  user_id: number
  trade_no?: string
  kind?: string
  product?: string
  amount_cents?: number
  paid_cents?: number
  commission_cents?: number
  reversed_cents?: number
  frozen_cents?: number
  available_cents?: number
  reserved_cents?: number
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
  const query = useQuery({
    queryKey: ['campus', 'records', !!props.admin, props.kind, page],
    queryFn: () =>
      campusGet<{ items: CampusRecord[]; total: number }>(
        `${props.admin ? 'admin' : 'self'}/records/${props.kind}?page=${page}&size=10`
      ),
  })
  const columns: StaticDataTableColumn<CampusRecord>[] = [
    {
      id: 'date',
      header: t('Time (Beijing)'),
      cell: (row) =>
        beijingDate(
          row.created_at || row.settled_at || row.bound_at || 0,
          locale
        ),
    },
    {
      id: 'source',
      header: t('Source'),
      cell: (row) => (
        <div className='max-w-64 break-all whitespace-normal'>
          {row.trade_no || (row.kind ? t(row.kind) : `#${row.user_id}`)}
          {row.product && (
            <div className='text-muted-foreground text-xs'>
              {t(row.product)}
            </div>
          )}
        </div>
      ),
    },
  ]
  if (props.kind !== 'invitations') {
    columns.push({
      id: 'amount',
      header: t('Amount (CNY)'),
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
  }
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
        {row.reason && (
          <p className='text-muted-foreground text-xs'>{t(row.reason)}</p>
        )}
        {row.paid_at ? (
          <p>
            {t('Actual transfer time')}: {beijingDate(row.paid_at, locale)}
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
  if (props.onAction) {
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
  if (query.isPending) return <LoadingState />
  if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />
  return (
    <div className='space-y-3'>
      <div className='max-w-full overflow-x-auto'>
        <StaticDataTable
          data={query.data.items || []}
          columns={columns}
          getRowKey={(row) => row.id || row.user_id}
          emptyContent={<EmptyState title={t('No records yet')} />}
        />
      </div>
      <div className='flex flex-wrap items-center justify-end gap-3'>
        <Button
          variant='outline'
          size='sm'
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          {t('Previous')}
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
          {t('Next')}
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
