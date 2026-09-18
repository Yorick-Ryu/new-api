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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { autoBanApi } from './api'
import { BanRecordAction } from './ban-record-action'
import { BanRecordDetails } from './ban-record-details'

export function BanRecords() {
  const { t } = useTranslation()
  const [before, setBefore] = useState(0)
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['auto-ban-events', before],
    queryFn: () => autoBanApi.events(before),
  })
  const unban = useMutation({
    mutationFn: autoBanApi.lift,
    onSuccess: async () => {
      toast.success(t('Ban lifted successfully'))
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auto-ban-events'] })
    },
  })
  const labels: Record<string, string> = {
    recorded: t('Recorded only'),
    banned: t('Account disabled'),
    protected: t('Administrator protected'),
    already_disabled: t('Already disabled'),
  }
  return (
    <section className='min-w-0 space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <h2 className='text-sm font-medium'>{t('Automatic ban records')}</h2>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() => {
            setBefore(0)
            void query.refetch()
          }}
        >
          {t('Refresh')}
        </Button>
      </div>
      {query.isPending && <p role='status'>{t('Loading...')}</p>}
      {query.isError && (
        <p role='alert'>{t('Unable to load automatic ban records')}</p>
      )}
      {query.data?.length === 0 && (
        <p className='text-muted-foreground rounded-lg border py-10 text-center text-sm'>
          {t('No automatic ban records')}
        </p>
      )}
      <div className='w-full overflow-x-auto'>
        {Boolean(query.data?.length) && (
          <Table>
            <TableHeader>
              <TableRow>
                {[
                  t('Time'),
                  t('User ID'),
                  t('Result'),
                  t('Ban reason'),
                  t('Actions'),
                ].map((title) => (
                  <TableHead key={title} className='whitespace-nowrap'>
                    {title}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data?.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className='whitespace-nowrap'>
                    {new Date(event.created_at * 1000).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Link
                      to='/users'
                      search={{ filter: String(event.user_id) }}
                    >
                      {event.user_id}
                    </Link>
                  </TableCell>
                  <TableCell className='whitespace-nowrap'>
                    <Badge
                      variant={
                        event.action === 'banned' && !event.ban_lifted
                          ? 'destructive'
                          : 'secondary'
                      }
                    >
                      {event.ban_lifted
                        ? t('Ban lifted')
                        : (labels[event.action] ?? event.action)}
                    </Badge>
                  </TableCell>
                  <TableCell className='max-w-80 min-w-48 break-words whitespace-normal'>
                    {event.reason}
                    <div>
                      <BanRecordDetails
                        event={event}
                        resultLabel={
                          event.ban_lifted
                            ? t('Ban lifted')
                            : (labels[event.action] ?? event.action)
                        }
                      />
                    </div>
                  </TableCell>
                  <TableCell className='whitespace-nowrap'>
                    <BanRecordAction
                      event={event}
                      pending={unban.isPending}
                      pendingEventId={unban.variables?.id}
                      onUnban={unban.mutate}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      {(query.data?.length === 30 || before > 0) && (
        <div className='flex gap-2'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={!before}
            onClick={() => setBefore(0)}
          >
            {t('Latest records')}
          </Button>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={query.data?.length !== 30}
            onClick={() => {
              const last = query.data?.at(-1)
              if (last) setBefore(last.id)
            }}
          >
            {t('Older records')}
          </Button>
        </div>
      )}
    </section>
  )
}
