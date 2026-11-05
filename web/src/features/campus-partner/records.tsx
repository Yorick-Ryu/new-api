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
import type { PaginationState } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { useMediaQuery } from '@/hooks'
import { toIntlLocale } from '@/i18n/languages'

import { campusGet } from './api'
import { CommissionDetails } from './commission-records'
import { recordColumns } from './record-columns'
import { recordFilterParams } from './record-filter-params'
import { CampusRecordFilters, type RecordFilters } from './record-filters'
import { WithdrawalDetails } from './withdrawal-details'

export type CampusRecord = {
  id: number
  user_id: number
  partner_tier?: { level: number; name?: string; rate_percent: number }
  partner_tier_name?: string
  total_commission_cents?: number
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

const EMPTY_RECORDS: CampusRecord[] = []

export function CampusRecords(props: {
  kind: string
  admin?: boolean
  onAction?: (row: CampusRecord) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const isMobile = useMediaQuery('(max-width: 640px)')
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })
  const [draft, setDraft] = useState<RecordFilters>({})
  const [filters, setFilters] = useState<RecordFilters>({})
  const [selected, setSelected] = useState<CampusRecord | null>(null)
  const commissionView = props.kind === 'payments'
  const columns = useMemo(
    () =>
      recordColumns(t, locale, {
        kind: props.kind,
        admin: props.admin,
        onAction: props.onAction,
        onDetails: setSelected,
      }),
    [t, locale, props.kind, props.admin, props.onAction]
  )
  const page = pagination.pageIndex + 1
  const query = useQuery({
    queryKey: [
      'campus',
      'records',
      !!props.admin,
      props.kind,
      page,
      filters,
      pagination.pageSize,
    ],
    queryFn: async () => {
      const path = `${props.admin ? 'admin' : 'self'}/records/${props.kind}`
      return campusGet<{ items: CampusRecord[]; total: number }>(
        `${path}?${recordFilterParams(page, filters, pagination.pageSize)}`
      )
    },
  })
  const { table } = useDataTable({
    data: query.isError ? EMPTY_RECORDS : (query.data?.items ?? EMPTY_RECORDS),
    columns,
    getRowId: (row) => String(row.id || row.user_id),
    totalCount: query.isError ? 0 : (query.data?.total ?? 0),
    pagination,
    onPaginationChange: (updater) => {
      if (query.isFetching || query.isError) return
      setPagination((previous) => {
        const next = typeof updater === 'function' ? updater(previous) : updater
        return {
          ...next,
          pageIndex: next.pageSize === previous.pageSize ? next.pageIndex : 0,
        }
      })
    },
    manualPagination: true,
    manualFiltering: true,
    enableSorting: false,
    enableRowSelection: false,
  })
  return (
    <div className='min-w-0 space-y-3'>
      {(commissionView || props.kind === 'withdrawals') && (
        <CampusRecordFilters
          table={table}
          payments={commissionView}
          admin={props.admin}
          value={draft}
          appliedValue={filters}
          onChange={setDraft}
          loading={query.isFetching}
          onSearch={() => {
            if (
              query.isFetching ||
              (draft.start && draft.end && draft.start > draft.end)
            ) {
              return
            }
            const unchanged =
              recordFilterParams(1, draft).toString() ===
              recordFilterParams(1, filters).toString()
            setFilters({ ...draft })
            setPagination((previous) => ({ ...previous, pageIndex: 0 }))
            if (unchanged && page === 1) void query.refetch()
          }}
          onReset={() => {
            setDraft({})
            setFilters({})
            setPagination((previous) => ({ ...previous, pageIndex: 0 }))
          }}
        />
      )}
      {query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : (
        <DataTablePage
          table={table}
          columns={columns}
          toolbarProps={null}
          isLoading={query.isPending}
          isFetching={query.isFetching}
          emptyTitle={t('No records yet')}
          fixedHeight={false}
          compactPagination={isMobile}
          paginationInFooter={false}
          getColumnClassName={(columnId) =>
            ['paid', 'commission', 'amount'].includes(columnId)
              ? 'text-right'
              : 'py-3'
          }
        />
      )}
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
    </div>
  )
}
