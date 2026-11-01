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
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'
import dayjs from '@/lib/dayjs'

import { cash, type CampusAdminInvitation } from './api'
import { InvitationAccount } from './invitation-account'

export function useAdminInvitationColumns(): ColumnDef<CampusAdminInvitation>[] {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  return useMemo(
    () => [
      {
        id: 'inviter',
        header: t('Inviter'),
        accessorFn: (row) =>
          row.inviter_username ||
          row.inviter_display_name ||
          `#${row.inviter_id}`,
        cell: ({ row }) => (
          <InvitationAccount
            id={row.original.inviter_id}
            username={row.original.inviter_username}
            displayName={row.original.inviter_display_name}
          />
        ),
        size: 230,
        meta: { label: t('Inviter') },
      },
      {
        id: 'invitee',
        header: t('Invitee'),
        accessorFn: (row) =>
          row.username || row.display_name || `#${row.user_id}`,
        cell: ({ row }) => (
          <InvitationAccount
            id={row.original.user_id}
            username={row.original.username}
            displayName={row.original.display_name}
          />
        ),
        size: 230,
        meta: { label: t('Invitee'), mobileTitle: true },
      },
      {
        accessorKey: 'bound_at',
        header: t('Binding time'),
        cell: ({ row }) => (
          <span className='whitespace-nowrap tabular-nums'>
            {row.original.bound_at
              ? dayjs.unix(row.original.bound_at).format('YYYY-MM-DD HH:mm:ss')
              : '—'}
          </span>
        ),
        size: 180,
        meta: { label: t('Binding time') },
      },
      {
        accessorKey: 'registered_at',
        header: t('Registration time'),
        cell: ({ row }) => (
          <span className='whitespace-nowrap tabular-nums'>
            {row.original.registered_at
              ? dayjs
                  .unix(row.original.registered_at)
                  .format('YYYY-MM-DD HH:mm:ss')
              : '—'}
          </span>
        ),
        size: 180,
        meta: { label: t('Registration time') },
      },
      {
        accessorKey: 'paid_cents',
        header: t('Cumulative top-ups'),
        cell: ({ row }) => (
          <span className='tabular-nums'>
            {cash(row.original.paid_cents, locale)}
          </span>
        ),
        size: 150,
        meta: { label: t('Cumulative top-ups') },
      },
      {
        accessorKey: 'commission_cents',
        header: t('Commission'),
        cell: ({ row }) => (
          <span className='text-primary font-semibold tabular-nums'>
            {cash(row.original.commission_cents, locale)}
          </span>
        ),
        size: 140,
        meta: { label: t('Commission') },
      },
    ],
    [t, locale]
  )
}
