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
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Accordion } from '@/components/ui/accordion'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { Separator } from '@/components/ui/separator'
import { handleServerError } from '@/lib/handle-server-error'

import { FormDirtyIndicator } from '../components/form-dirty-indicator'
import { SettingsAccordion } from '../components/settings-accordion'
import { SettingsForm } from '../components/settings-form-layout'
import { SettingsPageFrame } from '../components/settings-page'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { autoBanApi } from './api'
import { AutoBanSelect } from './auto-ban-select'
import { BanRecords } from './ban-records'
import { settingsSchema, type BanSettings } from './lib/schema'
import { RuleTest } from './rule-test'
import { RulesEditor } from './rules-editor'

export function AutoBanEditor(props: {
  settings: BanSettings
  save: (settings: BanSettings) => Promise<BanSettings>
}) {
  const { t } = useTranslation()
  const form = useForm<BanSettings>({
    resolver: zodResolver(settingsSchema),
    defaultValues: props.settings,
    mode: 'onChange',
  })
  const draft = useWatch({ control: form.control }) as BanSettings
  const valid = settingsSchema.safeParse(draft).success
  const mutation = useMutation({
    mutationFn: (settings: BanSettings) => props.save(settings),
    onSuccess: (settings) => {
      form.reset(settings)
      toast.success(t('Automatic ban settings saved'))
    },
    onError: (error) => handleServerError(error),
  })
  const submit = form.handleSubmit((settings) => mutation.mutate(settings))
  return (
    <div className='min-w-0 space-y-6'>
      <Form {...form}>
        <SettingsForm onSubmit={submit}>
          <SettingsPageFormActions
            onSave={submit}
            onReset={() => form.reset()}
            isSaving={mutation.isPending}
            isSaveDisabled={!valid || !form.formState.isDirty}
            isResetDisabled={!form.formState.isDirty}
            saveLabel='Save Changes'
            resetLabel='Discard changes'
          />
          <FormDirtyIndicator isDirty={form.formState.isDirty} />
          <div className='space-y-3'>
            <div className='max-w-md'>
              <AutoBanSelect
                label={t('Automatic ban mode')}
                value={draft.mode}
                disabled={mutation.isPending}
                onChange={(mode) =>
                  form.setValue('mode', mode as BanSettings['mode'], {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
                items={[
                  { value: 'off', label: t('Off') },
                  { value: 'observe', label: t('Record only') },
                  { value: 'ban', label: t('Automatically disable account') },
                ]}
              />
            </div>
            <p className='text-muted-foreground text-sm'>
              {t(
                'One matching upstream failure disables the account and blocks its API keys. Administrator accounts are recorded but never automatically disabled.'
              )}
            </p>
            <p className='text-muted-foreground text-sm'>
              {t(
                'Rules apply to new upstream failures after saving. Changing rules does not reprocess history or enable disabled accounts.'
              )}
            </p>
          </div>
          <Separator />
          <RulesEditor
            rules={draft.rules}
            disabled={mutation.isPending}
            onChange={(rules) =>
              form.setValue('rules', rules, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
          />
          {mutation.isError && (
            <Alert variant='destructive'>
              <AlertDescription>
                {t(
                  'Settings were not saved. Your draft is preserved. Reload if another administrator changed the configuration.'
                )}
              </AlertDescription>
            </Alert>
          )}
        </SettingsForm>
      </Form>
      <Separator />
      <Accordion multiple>
        <SettingsAccordion value='test' title={t('Test matching')}>
          <RuleTest settings={draft} valid={valid} />
        </SettingsAccordion>
      </Accordion>
    </div>
  )
}

export function AutoBanPage() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['auto-ban-settings'],
    queryFn: autoBanApi.get,
    refetchOnWindowFocus: false,
  })
  const save = async (settings: BanSettings) => {
    const result = await autoBanApi.save(settings)
    client.setQueryData(['auto-ban-settings'], result)
    return result
  }
  return (
    <SettingsPageFrame title={t('Automatic Banning')}>
      {query.isPending && (
        <div
          role='status'
          className='text-muted-foreground flex min-h-40 items-center justify-center text-sm'
        >
          {t('Loading settings...')}
        </div>
      )}
      {query.isError && (
        <Alert variant='destructive'>
          <AlertDescription>
            {t('Unable to load automatic ban settings')}
          </AlertDescription>
          <Button
            size='sm'
            variant='outline'
            onClick={() => void query.refetch()}
          >
            {t('Retry')}
          </Button>
        </Alert>
      )}
      {query.data && <AutoBanEditor settings={query.data} save={save} />}
      <Separator />
      <BanRecords />
    </SettingsPageFrame>
  )
}
