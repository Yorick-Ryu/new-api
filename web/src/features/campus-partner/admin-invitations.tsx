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
import { useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import {
  LogsFilterField,
  LogsFilterInput,
  LogsFilterToolbar,
} from '@/features/usage-logs/components/logs-filter-toolbar'
import { useAuthStore } from '@/stores/auth-store'

import { useAdminInvitationColumns } from './admin-invitation-columns'
import { campusGet, type CampusAdminInvitation } from './api'

type InvitationFilters = {
  inviter?: string
  invitee?: string
  start_timestamp?: number
  end_timestamp?: number
}
const EMPTY_INVITATIONS: CampusAdminInvitation[] = []

export function CampusAdminInvitations() {
  const { t } = useTranslation()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const [draft, setDraft] = useState<InvitationFilters>({})
  const [filters, setFilters] = useState<InvitationFilters>({})
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  })
  const params = {
    page: pagination.pageIndex + 1,
    size: pagination.pageSize,
    ...filters,
  }
  const query = useQuery({
    queryKey: ['campus', 'admin-invitations', userId, params],
    queryFn: () => {
      const search = new URLSearchParams()
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '') search.set(key, String(value))
      }
      return campusGet<{ items: CampusAdminInvitation[]; total: number }>(
        `admin/records/invitations?${search}`
      )
    },
    retry: false,
  })
  const columns = useAdminInvitationColumns()
  const { table } = useDataTable({
    data: query.isError
      ? EMPTY_INVITATIONS
      : (query.data?.items ?? EMPTY_INVITATIONS),
    columns,
    getRowId: (row) => String(row.user_id),
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
  const invalidRange =
    draft.start_timestamp !== undefined &&
    draft.end_timestamp !== undefined &&
    draft.start_timestamp > draft.end_timestamp
  const search = () => {
    if (invalidRange || query.isFetching) return
    const next = {
      ...draft,
      inviter: draft.inviter?.trim() || undefined,
      invitee: draft.invitee?.trim() || undefined,
    }
    const unchanged =
      next.inviter === filters.inviter &&
      next.invitee === filters.invitee &&
      next.start_timestamp === filters.start_timestamp &&
      next.end_timestamp === filters.end_timestamp
    setDraft(next)
    setFilters(next)
    setPagination((previous) => ({ ...previous, pageIndex: 0 }))
    if (unchanged && pagination.pageIndex === 0) void query.refetch()
  }
  const searchOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      search()
    }
  }
  const dateFilter = (
    <LogsFilterField wide>
      <CompactDateTimeRangePicker
        start={
          draft.start_timestamp === undefined
            ? undefined
            : new Date(draft.start_timestamp * 1000)
        }
        end={
          draft.end_timestamp === undefined
            ? undefined
            : new Date(draft.end_timestamp * 1000)
        }
        onChange={({ start, end }) =>
          setDraft((previous) => ({
            ...previous,
            start_timestamp: start
              ? Math.floor(start.getTime() / 1000)
              : undefined,
            end_timestamp: end ? Math.floor(end.getTime() / 1000) : undefined,
          }))
        }
      />
    </LogsFilterField>
  )
  const accountFilters = (
    <>
      <LogsFilterField>
        <LogsFilterInput
          aria-label={t('Inviter')}
          placeholder={t('Inviter: username, display name or ID')}
          maxLength={100}
          value={draft.inviter ?? ''}
          onChange={(event) =>
            setDraft((previous) => ({
              ...previous,
              inviter: event.target.value || undefined,
            }))
          }
          onKeyDown={searchOnEnter}
        />
      </LogsFilterField>
      <LogsFilterField>
        <LogsFilterInput
          aria-label={t('Invitee')}
          placeholder={t('Invitee: username, display name or ID')}
          maxLength={100}
          value={draft.invitee ?? ''}
          onChange={(event) =>
            setDraft((previous) => ({
              ...previous,
              invitee: event.target.value || undefined,
            }))
          }
          onKeyDown={searchOnEnter}
        />
      </LogsFilterField>
    </>
  )
  return (
    <div className='min-w-0 space-y-3'>
      <LogsFilterToolbar
        inlineActions
        table={table}
        primaryFilters={
          <>
            {dateFilter}
            {accountFilters}
          </>
        }
        mobilePinnedFilters={dateFilter}
        mobileFilters={accountFilters}
        mobileFilterCount={
          [draft.inviter, draft.invitee].filter(Boolean).length
        }
        hasActiveFilters={
          Object.values(draft).some(
            (value) => value !== undefined && value !== ''
          ) ||
          Object.values(filters).some(
            (value) => value !== undefined && value !== ''
          )
        }
        searchLoading={query.isFetching}
        searchDisabled={invalidRange}
        mobileFilterDescription={t(
          'Adjust filters, then search to refresh the records.'
        )}
        onSearch={search}
        onReset={() => {
          setDraft({})
          setFilters({})
          setPagination((previous) => ({ ...previous, pageIndex: 0 }))
        }}
      />
      {invalidRange && (
        <Alert variant='destructive'>
          <AlertDescription>
            {t('End time must be after start time')}
          </AlertDescription>
        </Alert>
      )}
      {query.isError ? (
        <ErrorState
          title={t('Failed to load invitation records')}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <DataTablePage
          table={table}
          columns={columns}
          toolbarProps={null}
          isLoading={query.isPending}
          isFetching={query.isFetching}
          emptyTitle={t('No records yet')}
          fixedHeight={false}
          paginationInFooter={false}
          getColumnClassName={(columnId) =>
            columnId === 'paid_cents' || columnId === 'commission_cents'
              ? 'text-right'
              : 'py-3'
          }
        />
      )}
    </div>
  )
}
