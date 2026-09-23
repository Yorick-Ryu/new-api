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
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { ErrorState } from '@/components/error-state'
import { JsonCodeEditor } from '@/components/json-code-editor'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { ComboboxInput } from '@/components/ui/combobox-input'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Label } from '@/components/ui/label'
import { toIntlLocale } from '@/i18n/languages'
import { api } from '@/lib/api'
import { formatNumber, formatTimestampToDate } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'

import { SettingsForm } from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'

type Profile = Record<string, unknown>
type Profiles = Record<string, Profile>
type OfficialSyncInfo = {
  revision: string
  synced_at: number
  model_count: number
  source_url: string
}
type CatalogDefaults = {
  profiles: Profiles
  fallback: Profile
  models: string[]
  official_sync: OfficialSyncInfo | null
}

const emptyProfile: Profile = {}

function formatProfile(profile: Profile): string {
  const first = [
    'display_name',
    'description',
    'priority',
    'supported_reasoning_levels',
    'default_reasoning_level',
    'input_modalities',
    'context_window',
    'max_context_window',
  ]
  const last = ['model_messages', 'base_instructions']
  const keys = [
    ...first,
    ...Object.keys(profile)
      .filter((key) => !first.includes(key) && !last.includes(key))
      .sort(),
    ...last,
  ].filter((key) => Object.hasOwn(profile, key))
  return JSON.stringify(
    Object.fromEntries(keys.map((key) => [key, profile[key]])),
    null,
    2
  )
}

const schema = z.object({
  profile: z.string().superRefine((value, context) => {
    try {
      const parsed: unknown = JSON.parse(value)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('object required')
      }
    } catch {
      context.addIssue({ code: 'custom', message: 'Enter a valid JSON object' })
    }
  }),
})

export function CodexSettingsCard(props: { overrides: string }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [modelChoice, setModelChoice] = useState<string | null>(null)
  const updateOption = useUpdateOption()
  const overrides = useMemo(
    () => JSON.parse(props.overrides) as Profiles,
    [props.overrides]
  )
  const defaults = useQuery({
    queryKey: ['codex-model-profile-defaults'],
    queryFn: async () => {
      const response = await api.get<{
        success: boolean
        message?: string
        data: CatalogDefaults
      }>('/api/option/codex_model_profiles')
      return requireServerSuccess(response.data).data
    },
  })
  const names = useMemo(() => {
    const data = defaults.data
    if (!data) return []
    const models = [
      ...new Set([
        ...data.models,
        ...Object.keys(overrides),
        ...(modelChoice ? [modelChoice] : []),
      ]),
    ]
    const priority = (name: string): number => {
      const value =
        overrides[name]?.priority ??
        data.profiles[name]?.priority ??
        data.fallback.priority
      return typeof value === 'number' ? value : 1000
    }
    return models.sort((left, right) => {
      const difference = priority(left) - priority(right)
      if (difference !== 0) return difference
      if (left === right) return 0
      return left < right ? -1 : 1
    })
  }, [defaults.data, overrides, modelChoice])
  const selectedModel = modelChoice ?? names[0] ?? ''
  useEffect(() => {
    if (modelChoice === null && selectedModel) setModelChoice(selectedModel)
  }, [modelChoice, selectedModel])
  const syncOfficial = useMutation({
    mutationFn: async () => {
      const response = await api.post<{
        success: boolean
        message?: string
        data: OfficialSyncInfo
      }>('/api/option/codex_model_profiles/sync', {}, { timeout: 45000 })
      return requireServerSuccess(response.data).data
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        queryKey: ['codex-model-profile-defaults'],
      })
      toast.success(
        t('Synced {{count}} model profiles from the official repository.', {
          count: result.model_count,
        })
      )
    },
  })
  const pending = updateOption.isPending || syncOfficial.isPending
  const base =
    defaults.data?.profiles[selectedModel] ??
    defaults.data?.fallback ??
    emptyProfile
  const effective = useMemo(
    () => formatProfile({ ...base, ...overrides[selectedModel] }),
    [base, overrides, selectedModel]
  )
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { profile: effective },
  })
  const dirty = form.formState.isDirty

  useEffect(() => {
    if (!dirty) form.reset({ profile: effective })
  }, [effective, dirty, form])

  const onSubmit = async (values: z.infer<typeof schema>) => {
    if (!selectedModel) return
    const profile = JSON.parse(values.profile) as Profile
    const next = { ...overrides }
    const changedFields = Object.fromEntries(
      Object.entries(profile).filter(
        ([key, value]) => JSON.stringify(value) !== JSON.stringify(base[key])
      )
    )
    if (Object.keys(changedFields).length === 0) {
      delete next[selectedModel]
    } else {
      next[selectedModel] = changedFields
    }
    await updateOption.mutateAsync({
      key: 'CodexModelProfiles',
      value: JSON.stringify(next),
    })
    form.reset({ profile: formatProfile(profile) })
  }

  if (defaults.isPending) return <LoadingState />
  if (defaults.isError || !defaults.data) {
    return <ErrorState onRetry={() => void defaults.refetch()} />
  }

  const data = defaults.data

  return (
    <SettingsSection title={t('Codex')}>
      <div className='text-muted-foreground text-sm'>
        {t(
          'Edit model capabilities for the Codex model picker. Saved changes take effect without restarting the service; refresh the model list in Codex to load them.'
        )}
      </div>
      <div className='flex items-center gap-3 overflow-x-auto'>
        <Button
          type='button'
          variant='outline'
          className='shrink-0'
          disabled={dirty || pending}
          onClick={() => syncOfficial.mutate()}
        >
          {syncOfficial.isPending
            ? t('Syncing official profiles...')
            : t('Sync official configuration')}
        </Button>
        <Button
          type='button'
          variant='outline'
          className='shrink-0'
          disabled={pending || !selectedModel}
          onClick={() =>
            form.setValue('profile', formatProfile(base), {
              shouldDirty: true,
              shouldValidate: true,
            })
          }
        >
          {t('Restore default configuration')}
        </Button>
        {data.official_sync ? (
          <p className='text-muted-foreground text-sm whitespace-nowrap'>
            {t('Last sync')}:{' '}
            {formatTimestampToDate(data.official_sync.synced_at)}
            {' · '}
            {formatNumber(data.official_sync.model_count, locale)} {t('Models')}
            {' · '}
            <a
              href={data.official_sync.source_url}
              target='_blank'
              rel='noreferrer'
              className='underline underline-offset-4'
            >
              {data.official_sync.revision.slice(0, 8)}
            </a>
          </p>
        ) : (
          <p className='text-muted-foreground text-sm whitespace-nowrap'>
            {t('Not synced yet; using bundled model profiles.')}
          </p>
        )}
      </div>
      <div className='grid w-full max-w-60 gap-2'>
        <Label htmlFor='codex-profile-model'>{t('Model')}</Label>
        <ComboboxInput
          id='codex-profile-model'
          value={selectedModel}
          options={names.map((name) => ({ label: name, value: name }))}
          disabled={dirty || pending}
          onValueChange={(name) => {
            setModelChoice(name)
            form.reset({
              profile: formatProfile({
                ...(data.profiles[name] ?? data.fallback),
                ...overrides[name],
              }),
            })
          }}
        />
        {dirty && (
          <p className='text-muted-foreground text-xs'>
            {t('Save changes before switching models.')}
          </p>
        )}
      </div>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <FormField
            control={form.control}
            name='profile'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Model capabilities JSON')}</FormLabel>
                <FormControl>
                  <JsonCodeEditor
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    textareaRef={field.ref}
                    name={field.name}
                    ariaLabel={t('Model capabilities JSON')}
                    disabled={pending || !selectedModel}
                    heightClassName='h-[28rem] min-h-[28rem] max-h-[28rem]'
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
            isSaveDisabled={!dirty || syncOfficial.isPending || !selectedModel}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
