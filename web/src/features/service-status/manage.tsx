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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Reorder } from 'motion/react'
import { useRef } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { SettingsPageFrame } from '@/features/system-settings/components/settings-page'
import { SettingsPageFormActions } from '@/features/system-settings/components/settings-page-context'
import { handleServerError } from '@/lib/handle-server-error'

import { getServiceStatusSettings, saveServiceStatusSettings } from './api'
import { GroupSettings } from './components/group-settings'
import {
  serviceStatusSettingsSchema,
  type ServiceStatusSettings,
} from './lib/settings'

function SettingsEditor(props: { settings: ServiceStatusSettings }) {
  const { t } = useTranslation()
  const client = useQueryClient()
  const form = useForm<ServiceStatusSettings>({
    resolver: zodResolver(serviceStatusSettingsSchema),
    defaultValues: props.settings,
  })
  const groups = useFieldArray({ control: form.control, name: 'groups' })
  const draggingGroup = useRef<string | null>(null)
  const mutation = useMutation({
    mutationFn: saveServiceStatusSettings,
    onSuccess: (_data, settings) => {
      form.reset(settings)
      void client.invalidateQueries({ queryKey: ['service-status'] })
      void client.invalidateQueries({ queryKey: ['service-status-settings'] })
      toast.success(t('Service status settings saved'))
    },
    onError: handleServerError,
  })
  return (
    <form
      onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      className='flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4'
    >
      <p className='text-muted-foreground shrink-0 text-sm'>
        {t(
          'Drag groups and models or use the arrow buttons to reorder. Save to apply your changes.'
        )}{' '}
        {t(
          'New groups and models are shown by default. Users still only see groups they can access.'
        )}
      </p>
      {groups.fields.length === 0 && (
        <p role='status' className='py-8 text-center text-sm'>
          {t('No groups available yet.')}
        </p>
      )}
      <fieldset
        disabled={mutation.isPending}
        className='min-h-0 min-w-0 flex-1 disabled:opacity-60'
      >
        <Reorder.Group
          as='div'
          axis='y'
          layoutScroll
          values={groups.fields.map((field) => field.id)}
          aria-label={t('Group display order')}
          className='h-full space-y-3 overflow-y-auto p-1'
          onReorder={(ids) => {
            if (mutation.isPending || !draggingGroup.current) return
            const from = groups.fields.findIndex(
              (field) => field.id === draggingGroup.current
            )
            const to = ids.indexOf(draggingGroup.current)
            if (from >= 0 && to >= 0 && from !== to) groups.move(from, to)
          }}
        >
          {groups.fields.map((field, index) => (
            <GroupSettings
              key={field.id}
              form={form}
              dragId={field.id}
              disabled={mutation.isPending}
              onDragStart={() => {
                draggingGroup.current = field.id
              }}
              onDragEnd={() => {
                draggingGroup.current = null
              }}
              index={index}
              count={groups.fields.length}
              move={groups.move}
            />
          ))}
        </Reorder.Group>
      </fieldset>
      {mutation.isError && (
        <p role='alert' className='text-destructive text-sm'>
          {t(
            'Failed to save service status settings. Your changes have been kept.'
          )}
        </p>
      )}
      {Object.keys(form.formState.errors).length > 0 && (
        <p role='alert' className='text-destructive text-sm'>
          {t('Invalid service status settings')}
        </p>
      )}
      <SettingsPageFormActions
        onSave={() =>
          void form.handleSubmit((values) => mutation.mutate(values))()
        }
        onReset={() => form.reset()}
        isSaving={mutation.isPending}
        isSaveDisabled={!form.formState.isDirty}
        isResetDisabled={!form.formState.isDirty}
        saveLabel='Save'
      />
    </form>
  )
}

export function ServiceStatusManagementPage() {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['service-status-settings'],
    queryFn: ({ signal }) => getServiceStatusSettings(signal),
    retry: false,
    refetchOnWindowFocus: false,
  })
  return (
    <SettingsPageFrame title={t('Service status')} fixedContent>
      {query.isPending && (
        <p role='status' className='text-muted-foreground text-sm'>
          {t('Loading...')}
        </p>
      )}
      {query.isError && (
        <div role='alert' className='space-y-3 text-sm'>
          <p>{t('Failed to load service status settings')}</p>
          <Button
            variant='outline'
            size='sm'
            onClick={() => void query.refetch()}
          >
            {t('Retry')}
          </Button>
        </div>
      )}
      {query.data && <SettingsEditor settings={query.data} />}
    </SettingsPageFrame>
  )
}
