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

import { StatusBadge, type StatusVariant } from '@/components/status-badge'

import { campusWithdrawalStateLabels } from './constants'
import type { CampusRecord } from './records'

const withdrawalVariants: Record<string, StatusVariant> = {
  pending: 'warning',
  approved: 'info',
  paused: 'warning',
  unknown: 'warning',
  paid: 'success',
  rejected: 'danger',
  failed: 'danger',
  cancelled: 'neutral',
}
const commissionVariants: Record<string, StatusVariant> = {
  'Pending settlement': 'warning',
  Settled: 'success',
  'Partially refunded': 'warning',
  'Fully refunded': 'neutral',
}

function commissionStatus(row: CampusRecord): string {
  if ((row.refunded_cents || 0) > 0) {
    return (row.refunded_cents || 0) >= (row.paid_cents || 0)
      ? 'Fully refunded'
      : 'Partially refunded'
  }
  return (row.frozen_cents || 0) > 0 ? 'Pending settlement' : 'Settled'
}

export function CampusWithdrawalStatus(props: { state?: string }) {
  const { t } = useTranslation()
  const state = props.state || ''
  return (
    <StatusBadge
      label={t(campusWithdrawalStateLabels[state] || state || '—')}
      variant={withdrawalVariants[state] || 'neutral'}
      showDot
      copyable={false}
    />
  )
}

export function CampusCommissionStatus(props: {
  row: CampusRecord
  admin?: boolean
}) {
  const { t } = useTranslation()
  const label =
    props.admin && props.row.eligibility && props.row.eligibility !== 'eligible'
      ? props.row.eligibility
      : commissionStatus(props.row)
  return (
    <StatusBadge
      label={t(label)}
      variant={commissionVariants[label] || 'neutral'}
      showDot
      copyable={false}
    />
  )
}
