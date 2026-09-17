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
import { ChartNoAxesCombined, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import dayjs from '@/lib/dayjs'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { getBusinessDashboard } from '../../api'
import { PanelTitle } from '../ui/panel-title'
import { BusinessDetails } from './business-details'
import { BusinessFilterDialog } from './business-filter-dialog'
import { BusinessMetrics } from './business-metrics'
import {
  toBusinessPickerDate,
  type BusinessFilter,
  type BusinessPreset,
} from './business-period'

export function BusinessOverview() {
  const role = useAuthStore((state) => state.auth.user?.role)
  if (!role || role < ROLE.ADMIN) return null
  return <AdminBusinessOverview />
}

function AdminBusinessOverview() {
  const { t } = useTranslation()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const [filter, setFilter] = useState<BusinessFilter>({ period: '1' })
  const period = filter.period
  const params =
    filter.period === 'custom'
      ? {
          start_timestamp: filter.start_timestamp,
          end_timestamp: filter.end_timestamp,
        }
      : {
          days: period === 'yesterday' ? 1 : Number(period),
          offset: period === 'yesterday' ? 1 : 0,
        }
  const query = useQuery({
    queryKey: ['dashboard', 'business', userId, params],
    queryFn: () => getBusinessDashboard(params),
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[2] === userId ? previousData : undefined,
    staleTime: 60_000,
    gcTime: 0,
  })
  const data = query.data

  return (
    <section
      aria-label={t('Business overview')}
      aria-busy={query.isFetching}
      className='bg-card overflow-hidden rounded-lg border'
    >
      <div className='flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-5'>
        <PanelTitle
          as='h2'
          title={t('Business overview')}
          icon={ChartNoAxesCombined}
          iconTone='info'
        />
        <div className='flex max-w-full flex-wrap items-center gap-2'>
          <Tabs
            className='min-w-0 overflow-x-auto'
            value={period}
            onValueChange={(value) => {
              if (value !== 'custom') {
                setFilter({ period: value as BusinessPreset })
              }
            }}
          >
            <TabsList animated aria-label={t('Business reporting period')}>
              <TabsTrigger value='1' className='px-2.5 text-xs'>
                {t('Today')}
              </TabsTrigger>
              <TabsTrigger value='yesterday' className='px-2.5 text-xs'>
                {t('Yesterday')}
              </TabsTrigger>
              {[3, 7, 30].map((value) => (
                <TabsTrigger
                  key={value}
                  value={String(value)}
                  className='px-2.5 text-xs'
                >
                  {t('Last {{days}} days', { days: value })}
                </TabsTrigger>
              ))}
              {period === 'custom' && (
                <TabsTrigger value='custom' className='px-2.5 text-xs'>
                  {t('Custom')}
                </TabsTrigger>
              )}
            </TabsList>
          </Tabs>
          <BusinessFilterDialog value={filter} onChange={setFilter} />
          <Button
            size='icon'
            className='shrink-0'
            variant='ghost'
            aria-label={t('Refresh business data')}
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw
              className={
                query.isFetching
                  ? 'size-4 animate-spin motion-reduce:animate-none'
                  : 'size-4'
              }
              aria-hidden='true'
            />
          </Button>
        </div>
        {filter.period === 'custom' && (
          <div className='text-muted-foreground basis-full text-xs'>
            {t('Selected period: {{start}} – {{end}} (Beijing time)', {
              start: dayjs(toBusinessPickerDate(filter.start_timestamp)).format(
                'YYYY-MM-DD HH:mm'
              ),
              end: dayjs(toBusinessPickerDate(filter.end_timestamp)).format(
                'YYYY-MM-DD HH:mm'
              ),
            })}
          </div>
        )}
      </div>
      {query.isError && (
        <div
          role='alert'
          className='text-destructive flex items-center justify-between gap-3 p-4 text-sm'
        >
          <span>{t('Failed to load business overview')}</span>
          <Button
            variant='outline'
            size='sm'
            onClick={() => void query.refetch()}
          >
            {t('Retry')}
          </Button>
        </div>
      )}
      {query.isPending && (
        <div
          role='status'
          aria-label={t('Loading business data')}
          className='grid grid-cols-2 gap-4 p-5 lg:grid-cols-3'
        >
          {[0, 1, 2, 3, 4, 5].map((key) => (
            <Skeleton key={key} className='h-24 rounded-xl' />
          ))}
        </div>
      )}
      {data && (
        <>
          {query.isFetching && (
            <span
              role='status'
              aria-label={t('Loading business data')}
              className='sr-only'
            >
              {t('Loading business data')}
            </span>
          )}
          <BusinessMetrics data={data} loading={query.isFetching} />
          <BusinessDetails data={data} loading={query.isFetching} />
        </>
      )}
    </section>
  )
}
