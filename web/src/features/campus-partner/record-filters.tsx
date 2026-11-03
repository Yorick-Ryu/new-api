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

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import { LogsFilterInput } from '@/features/usage-logs/components/logs-filter-toolbar'

import { campusWithdrawalStateLabels } from './constants'

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
  payments: boolean
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
  if (props.admin) {
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
  return (
    <form
      className='flex flex-wrap items-center gap-2'
      onSubmit={(event) => {
        event.preventDefault()
        if (!invalidRange && !props.loading) props.onSearch()
      }}
    >
      <CompactDateTimeRangePicker
        className='w-full sm:w-64'
        start={props.value.start}
        end={props.value.end}
        onChange={(range) => props.onChange({ ...props.value, ...range })}
      />
      {fields.map(([key, label, placeholder]) => (
        <LogsFilterInput
          key={key}
          className='w-56'
          aria-label={t(label)}
          placeholder={t(placeholder)}
          maxLength={100}
          value={String(props.value[key] || '')}
          onChange={(event) =>
            props.onChange({ ...props.value, [key]: event.target.value })
          }
        />
      ))}
      <Select
        items={options}
        value={props.value.status || 'all'}
        onValueChange={(value) =>
          props.onChange({ ...props.value, status: value || 'all' })
        }
      >
        <SelectTrigger className='w-48' aria-label={t('Status')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type='submit' disabled={props.loading || invalidRange}>
        {t('Search')}
      </Button>
      <Button type='button' variant='outline' onClick={props.onReset}>
        {t('Reset')}
      </Button>
      {invalidRange && (
        <p role='alert' className='text-destructive w-full text-sm'>
          {t('End time must be after start time')}
        </p>
      )}
    </form>
  )
}
