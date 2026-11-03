import { commissionStatus } from './commission-columns'
import type { RecordFilters } from './record-filters'
import type { CampusRecord } from './records'

export function matchesRecordFilters(
  row: CampusRecord,
  filters: RecordFilters,
  payments: boolean
): boolean {
  const timestamp = (payments ? row.settled_at : row.created_at) || 0
  if (filters.start && timestamp * 1000 < filters.start.getTime()) return false
  if (filters.end && timestamp * 1000 > filters.end.getTime()) return false
  if (
    filters.status &&
    filters.status !== 'all' &&
    (payments ? commissionStatus(row) : row.state) !== filters.status
  ) {
    return false
  }
  if (
    filters.order &&
    !row.trade_no?.toLowerCase().includes(filters.order.trim().toLowerCase())
  ) {
    return false
  }
  const accounts = [
    [
      filters.inviter,
      row.inviter_id,
      row.inviter_username,
      row.inviter_display_name,
    ],
    [
      filters.invitee || filters.user,
      row.user_id,
      row.username,
      row.display_name,
    ],
  ] as const
  for (const [value, id, username, displayName] of accounts) {
    const search = value?.trim().toLowerCase()
    if (!search) continue
    if (String(id) === search.replace(/^#/, '')) continue
    if (
      ![username, displayName].some((name) =>
        name?.toLowerCase().includes(search)
      )
    ) {
      return false
    }
  }
  return true
}
