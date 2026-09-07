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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout/components/section-page-layout'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { getServiceStatus } from './api'
import { ModelStatus } from './components/model-status'
import { getGroupHealth, HEALTH_CLASSES } from './lib/status'
import type { ServiceStatusHours } from './types'

export function ServiceStatusPage() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const [hours, setHours] = useState<ServiceStatusHours>(24)
  const query = useQuery({
    queryKey: ['service-status', user?.id, user?.group, hours],
    queryFn: ({ signal }) => getServiceStatus(hours, signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  })
  const data = query.data?.data
  const healthLabels = {
    normal: t('Normal (≥99%)'),
    warning: t('Degraded (95–99%)'),
    error: t('Errors (<95%)'),
    unknown: t('No recent data'),
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Service status')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Tabs
          value={String(hours)}
          onValueChange={(value) => {
            if (value === '24' || value === '72' || value === '168') {
              setHours(Number(value) as ServiceStatusHours)
            }
          }}
        >
          <TabsList
            aria-label={t('Time range')}
            className='p-0.5 group-data-horizontal/tabs:h-7'
          >
            <TabsTrigger
              value='24'
              className='px-1.5 py-0 text-[11px] leading-4'
            >
              {t('Last 24 hours')}
            </TabsTrigger>
            <TabsTrigger
              value='72'
              className='px-1.5 py-0 text-[11px] leading-4'
            >
              {t('Last 3 days')}
            </TabsTrigger>
            <TabsTrigger
              value='168'
              className='px-1.5 py-0 text-[11px] leading-4'
            >
              {t('Last week')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div
          className='max-w-5xl space-y-4 pt-1 pb-3'
          aria-busy={query.isFetching}
        >
          {query.isError && (
            <div
              role='alert'
              className='border-destructive/30 bg-destructive/5 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 text-sm'
            >
              <span>
                {data
                  ? t('Refresh failed. The last available data is shown below.')
                  : t('Failed to load service status')}
              </span>
              <Button
                variant='outline'
                size='sm'
                onClick={() => void query.refetch()}
                disabled={query.isFetching}
              >
                {t('Retry')}
              </Button>
            </div>
          )}
          {query.data?.enabled === false && (
            <p role='status' className='text-muted-foreground text-sm'>
              {t(
                'Performance collection is disabled. Historical data may still be shown.'
              )}
            </p>
          )}
          {query.isPending && (
            <div
              role='status'
              aria-label={t('Loading service status')}
              className='grid grid-cols-1 gap-x-6 gap-y-5 pt-5 @3xl/content:grid-cols-2'
            >
              {Array.from({ length: 6 }, (_, index) => (
                <div key={index} className='space-y-3'>
                  <Skeleton className='h-5 w-36' />
                  <Skeleton className='h-5 w-full' />
                  <Skeleton className='h-4 w-3/4' />
                </div>
              ))}
            </div>
          )}
          {data?.groups.length === 0 && (
            <p
              role='status'
              className='text-muted-foreground py-16 text-center text-sm'
            >
              {t('No model performance data is available for your groups yet.')}
            </p>
          )}
          {data?.groups.map((group) => {
            const description = group.description?.trim()
            const health = getGroupHealth(
              group.models,
              data.end_ts,
              data.bucket_seconds
            )
            return (
              <section
                key={group.group}
                aria-label={group.group}
                className='border-border/60 border-b pb-5 last-of-type:border-b-0'
              >
                <div className='mb-3 flex items-center gap-2'>
                  <span
                    className={cn(
                      'size-2 shrink-0 rounded-full',
                      HEALTH_CLASSES[health]
                    )}
                    role='img'
                    aria-label={t('Latest interval: {{status}}', {
                      status: healthLabels[health],
                    })}
                  />
                  <h3 className='text-foreground/80 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-sm font-medium break-all'>
                    <span>
                      {description ||
                        (group.group === 'auto' ? t('Auto') : group.group)}
                    </span>
                    {description && description !== group.group && (
                      <span className='text-xs font-normal text-neutral-500 dark:text-neutral-400'>
                        {group.group}
                      </span>
                    )}
                  </h3>
                  <span className='text-muted-foreground ml-auto shrink-0 text-xs'>
                    {t('{{count}} models', { count: group.models.length })}
                  </span>
                </div>
                <div className='grid grid-cols-1 gap-x-6 gap-y-5 @3xl/content:grid-cols-2'>
                  {group.models.map((model) => (
                    <ModelStatus
                      key={`${hours}:${model.model_name}`}
                      model={model}
                      start={data.start_ts}
                      end={data.end_ts}
                      step={data.bucket_seconds}
                      hours={hours}
                    />
                  ))}
                </div>
              </section>
            )
          })}
          {data && data.groups.length > 0 && (
            <div className='text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 text-xs'>
              {Object.entries(healthLabels).map(([health, label]) => (
                <span key={health} className='inline-flex items-center gap-1.5'>
                  <i
                    className={cn(
                      'size-1.5 rounded-sm',
                      HEALTH_CLASSES[health as keyof typeof HEALTH_CLASSES]
                    )}
                    aria-hidden='true'
                  />
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
