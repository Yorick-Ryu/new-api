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
import type { Table } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import {
  LogsFilterField,
  LogsFilterInput,
  LogsFilterToolbar,
} from '@/features/usage-logs/components/logs-filter-toolbar'

import { campusWithdrawalStateLabels } from './constants'
import type { CampusRecord } from './records'

export type RecordFilters = {
  start?: Date
  end?: Date
  inviter?: string
  invitee?: string
  user?: string
  order?: string
  status?: string
}

export function CampusRecordFilters(props: {
  table: Table<CampusRecord>
  appliedValue: RecordFilters
  payments: boolean
  invitations?: boolean
  admin?: boolean
  value: RecordFilters
  onChange: (filters: RecordFilters) => void
  onSearch: () => void
  onReset: () => void
  loading: boolean
}) {
  const { t } = useTranslation()
  const statuses = props.payments
    ? [
        'Pending settlement',
        'Settled',
        'Partially refunded',
        'Fully refunded',
      ].map((status) => ({ value: status, label: t(status) }))
    : Object.entries(campusWithdrawalStateLabels).map(([value, label]) => ({
        value,
        label: t(label),
      }))
  const options = [{ value: 'all', label: t('All') }, ...statuses]
  const fields: [keyof RecordFilters, string, string][] = []
  if (props.invitations) {
    fields.push(['invitee', 'Invitee', 'Invitee: username, display name or ID'])
  } else if (props.admin) {
    if (props.payments) {
      fields.push(
        ['inviter', 'Inviter', 'Inviter: username, display name or ID'],
        ['invitee', 'Invitee', 'Invitee: username, display name or ID']
      )
    } else fields.push(['user', 'User', 'Username, display name or ID'])
  }
  if (props.payments) fields.push(['order', 'Order number', 'Order number'])
  const invalidRange =
    !!props.value.start &&
    !!props.value.end &&
    props.value.start > props.value.end
  const dateFilter = (
    <LogsFilterField wide>
      <CompactDateTimeRangePicker
        start={props.value.start}
        end={props.value.end}
        onChange={(range) => props.onChange({ ...props.value, ...range })}
      />
    </LogsFilterField>
  )
  const otherFilters = (
    <>
      {fields.map(([key, label, placeholder]) => (
        <LogsFilterField key={key}>
          <LogsFilterInput
            aria-label={t(label)}
            placeholder={t(placeholder)}
            maxLength={100}
            value={String(props.value[key] || '')}
            onChange={(event) =>
              props.onChange({ ...props.value, [key]: event.target.value })
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                if (!invalidRange && !props.loading) props.onSearch()
              }
            }}
          />
        </LogsFilterField>
      ))}
      {!props.invitations && (
        <LogsFilterField>
          <Select
            items={options}
            value={props.value.status || 'all'}
            onValueChange={(value) =>
              props.onChange({ ...props.value, status: value || 'all' })
            }
          >
            <SelectTrigger
              className='h-8 w-full text-sm'
              aria-label={t('Status')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </LogsFilterField>
      )}
    </>
  )
  return (
    <div className='min-w-0 space-y-3'>
      <LogsFilterToolbar
        table={props.table}
        inlineActions
        primaryFilters={
          <>
            {dateFilter}
            {otherFilters}
          </>
        }
        mobilePinnedFilters={dateFilter}
        mobileFilters={otherFilters}
        mobileFilterCount={
          [
            props.value.inviter,
            props.value.invitee,
            props.value.user,
            props.value.order,
            props.value.status !== 'all' ? props.value.status : undefined,
          ].filter(Boolean).length
        }
        hasActiveFilters={[props.value, props.appliedValue].some((value) =>
          Object.values(value).some(
            (item) => item !== undefined && item !== '' && item !== 'all'
          )
        )}
        searchLoading={props.loading}
        searchDisabled={invalidRange}
        mobileFilterDescription={t(
          'Adjust filters, then search to refresh the records.'
        )}
        onSearch={props.onSearch}
        onReset={props.onReset}
      />
      {invalidRange && (
        <Alert variant='destructive'>
          <AlertDescription>
            {t('End time must be after start time')}
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
