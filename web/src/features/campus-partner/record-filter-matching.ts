import type { RecordFilters } from './record-filters'

export function recordFilterParams(
  page: number,
  filters: RecordFilters
): URLSearchParams {
  const params = new URLSearchParams({ page: String(page), size: '10' })
  if (filters.start) {
    params.set(
      'start_timestamp',
      String(Math.ceil(filters.start.getTime() / 1000))
    )
  }
  if (filters.end) {
    params.set(
      'end_timestamp',
      String(Math.floor(filters.end.getTime() / 1000))
    )
  }
  for (const key of [
    'inviter',
    'invitee',
    'user',
    'order',
    'status',
  ] as const) {
    const value = filters[key]?.trim()
    if (value && (key !== 'status' || value !== 'all')) params.set(key, value)
  }
  return params
}
