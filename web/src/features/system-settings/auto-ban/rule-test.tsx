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
import { useMutation } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { autoBanApi, type TestSample } from './api'
import type { BanSettings } from './lib/schema'

export function RuleTest(props: { settings: BanSettings; valid: boolean }) {
  const { t } = useTranslation()
  const id = useId()
  const [body, setBody] = useState('')
  const [status, setStatus] = useState(400)
  const [channel, setChannel] = useState(0)
  const [model, setModel] = useState('')
  const sample = { body, http_status: status, channel_id: channel, model }
  const mutation = useMutation({
    mutationFn: (request: { settings: BanSettings; sample: TestSample }) =>
      autoBanApi.test(request.settings, request.sample),
    onError: handleServerError,
  })
  const currentResult =
    JSON.stringify(mutation.variables) ===
    JSON.stringify({ settings: props.settings, sample })
  return (
    <section className='min-w-0 space-y-4'>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Test the current draft without saving or banning any user. Paste only an error sample, without credentials or prompts.'
        )}
      </p>
      <div className='grid min-w-0 gap-x-5 gap-y-6 md:grid-cols-3'>
        <Field>
          <FieldLabel htmlFor={`${id}-status`}>{t('HTTP status')}</FieldLabel>
          <Input
            type='number'
            id={`${id}-status`}
            min={100}
            max={599}
            value={status}
            onChange={(e) => setStatus(Number(e.target.value))}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-channel`}>{t('Channel ID')}</FieldLabel>
          <Input
            type='number'
            id={`${id}-channel`}
            min={0}
            value={channel}
            onChange={(e) => setChannel(Number(e.target.value))}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-model`}>{t('Model')}</FieldLabel>
          <Input
            id={`${id}-model`}
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor={`${id}-body`}>
          {t('Upstream error sample')}
        </FieldLabel>
        <Textarea
          id={`${id}-body`}
          maxLength={65536}
          rows={5}
          value={body}
          onChange={(e) => {
            setBody(e.target.value)
            mutation.reset()
          }}
        />
      </Field>
      <Button
        type='button'
        variant='outline'
        size='sm'
        disabled={
          !props.valid ||
          !body.trim() ||
          mutation.isPending ||
          status < 100 ||
          status > 599
        }
        onClick={() => mutation.mutate({ settings: props.settings, sample })}
      >
        {t('Test matching')}
      </Button>
      {mutation.isError && (
        <p role='alert' className='text-destructive text-sm'>
          {t('Rule test failed. Please retry.')}
        </p>
      )}
      {mutation.data && currentResult && (
        <Alert role='status'>
          <AlertDescription className='space-y-2'>
            <p>
              {mutation.data.is_upstream_error
                ? t('Upstream error recognized')
                : t('No upstream error recognized')}
            </p>
            {mutation.data.rules.map((rule) => (
              <div key={rule.id} className='space-y-1 break-words'>
                <p className='font-medium'>
                  {rule.name}: {rule.matched ? t('Matched') : t('Not matched')}
                </p>
                {rule.groups.map((group, index) => (
                  <p key={group.id} className='text-muted-foreground text-xs'>
                    {t('Matching method {{number}}', { number: index + 1 })}:{' '}
                    {group.matched ? t('Matched') : t('Not matched')} ·{' '}
                    {group.conditions
                      .map(
                        (matched, i) =>
                          `${i + 1}: ${matched ? t('Matched') : t('Not matched')}`
                      )
                      .join(' / ')}
                  </p>
                ))}
              </div>
            ))}
          </AlertDescription>
        </Alert>
      )}
    </section>
  )
}
