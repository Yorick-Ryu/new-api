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
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { DataTableBulkActions as BulkActionsToolbar } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { handleServerError } from '@/lib/handle-server-error'
import { AuthOperationError } from '@/lib/secure-verification'
import { requireServerSuccess } from '@/lib/server-error-message'

import { batchDisableUsers } from '../api'
import type { User } from '../types'
import { useUsers } from './users-provider'

interface DataTableBulkActionsProps {
  table: Table<User>
}

export function DataTableBulkActions(props: DataTableBulkActionsProps) {
  const { t } = useTranslation()
  const users = useUsers()
  const [targets, setTargets] = useState<User[]>([])
  const [pending, setPending] = useState(false)
  const inFlight = useRef(false)
  const selected = props.table.getFilteredSelectedRowModel().rows

  const handleDisable = async () => {
    if (inFlight.current || targets.length === 0) return
    inFlight.current = true
    setPending(true)
    // Snapshot the exact reviewed set before verification; table changes cannot expand it.
    const ids = targets.map((user) => user.id).sort((a, b) => a - b)
    try {
      const proof = await users.requestVerification({
        scope: 'admin.user.batch_disable',
        context: { user_ids: ids },
        title: t('Verify to disable selected users'),
        description: t('Verify once to disable all {{count}} selected users.', {
          count: ids.length,
        }),
      })
      if (!proof) return
      requireServerSuccess(await batchDisableUsers(ids, proof.proof_token))
      toast.success(t('Selected users disabled'))
      props.table.resetRowSelection()
      setTargets([])
    } catch (error) {
      handleServerError(AuthOperationError.from(error))
    } finally {
      users.triggerRefresh()
      inFlight.current = false
      setPending(false)
    }
  }

  return (
    <>
      <BulkActionsToolbar table={props.table} entityName='user'>
        <Button
          variant='destructive'
          size='sm'
          disabled={
            pending ||
            users.verificationActive ||
            selected.length === 0 ||
            selected.length > 100
          }
          onClick={() =>
            setTargets(selected.map((row) => ({ ...row.original })))
          }
        >
          {t('Disable selected users')}
        </Button>
      </BulkActionsToolbar>
      <ConfirmDialog
        open={targets.length > 0 && !users.verificationActive}
        onOpenChange={(open) => {
          if (!open && !inFlight.current) setTargets([])
        }}
        title={t('Disable selected users')}
        desc={t(
          'Disable these {{count}} users? Their active sessions will be revoked. Already disabled users remain disabled.',
          { count: targets.length }
        )}
        confirmText={t('Continue')}
        destructive
        isLoading={pending}
        handleConfirm={handleDisable}
      >
        <ul
          className='max-h-60 overflow-y-auto text-sm break-all'
          aria-label={t('Selected users')}
        >
          {targets.map((user) => (
            <li key={user.id}>
              #{user.id} · {user.username}
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </>
  )
}
