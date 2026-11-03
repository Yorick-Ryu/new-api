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
export const campusWithdrawalStateLabels: Record<string, string> = {
  pending: 'Awaiting review',
  approved: 'Approved · month-end payout',
  paused: 'Payout paused',
  unknown: 'Transfer result unknown',
  paid: 'Paid',
  rejected: 'Rejected',
  failed: 'Transfer failed',
  cancelled: 'Cancelled',
}

export const campusTierNameKeys = [
  'Apprentice partner',
  'Growing partner',
  'Elite partner',
  'Senior partner',
  'Lead partner',
] as const

export const campusAmountTypography =
  'font-mono! text-sm font-medium tabular-nums'

export const campusCardTypography = {
  title: 'text-foreground text-base font-semibold tracking-tight sm:text-lg',
  subtitle: 'text-foreground text-sm font-semibold',
  body: 'text-muted-foreground text-sm font-normal leading-6',
  caption: 'text-muted-foreground text-xs font-normal leading-5',
  metric: 'font-mono text-2xl font-bold tracking-tight tabular-nums',
} as const
