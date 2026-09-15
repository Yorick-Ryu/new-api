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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Dialog } from '@/components/dialog'
import { Badge } from '@/components/ui/badge'

import type { BanEvent } from './api'
import { ruleSchema } from './lib/schema'

// The database serializes unrestricted scopes as null. A snapshot is read-only
// and always comes from the event, rather than the current editable rules.
const snapshotSchema = z.array(
  z.object({
    ...ruleSchema.shape,
    channels: z.array(z.number()).nullable(),
    models: z.array(z.string()).nullable(),
  })
)

function RecordDetailsBody(props: { event: BanEvent; resultLabel: string }) {
  const { t } = useTranslation()
  let rules: z.infer<typeof snapshotSchema> | null = null
  try {
    const parsed = snapshotSchema.safeParse(JSON.parse(props.event.rules))
    if (parsed.success) rules = parsed.data
  } catch {
    // Keep the event metadata available if a stored snapshot is malformed.
  }
  const fields = [
    [t('Time'), new Date(props.event.created_at * 1000).toLocaleString()],
    [t('User ID'), props.event.user_id],
    [t('Ban reason'), props.event.reason],
    [t('HTTP status'), props.event.http_status],
    [t('Model'), props.event.model || '—'],
    [t('Channel ID'), props.event.channel_id || '—'],
    [t('Request ID'), props.event.request_id || '—'],
    [t('Rule version'), props.event.version],
  ]
  const fieldLabels = {
    code: t('Error code'),
    message: t('Error message'),
    violations: t('Violation marker'),
    http_status: t('HTTP status'),
  }
  const operatorLabels = {
    equals: t('Equals'),
    contains: t('Contains'),
    includes: t('List includes'),
  }
  return (
    <div className='min-w-0 space-y-4'>
      <Badge
        variant={props.event.action === 'banned' ? 'destructive' : 'secondary'}
      >
        {props.resultLabel}
      </Badge>
      <dl className='min-w-0 space-y-2'>
        {fields.map(([label, value]) => (
          <div
            key={label}
            className='grid min-w-0 grid-cols-[5.25rem_minmax(0,1fr)] gap-2 text-xs sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3'
          >
            <dt className='text-muted-foreground'>{label}</dt>
            <dd className='min-w-0 break-all'>{value}</dd>
          </div>
        ))}
      </dl>
      <section
        className='min-w-0 space-y-2'
        aria-label={t('Matched rule snapshot')}
      >
        <h3 className='text-xs font-semibold'>{t('Matched rule snapshot')}</h3>
        {rules === null && (
          <p role='alert' className='text-destructive text-xs'>
            {t('Unable to display rule snapshot')}
          </p>
        )}
        {rules?.length === 0 && (
          <p className='text-muted-foreground text-xs'>
            {t('No rule snapshot')}
          </p>
        )}
        {rules?.map((rule) => (
          <div
            key={rule.id}
            className='bg-muted/30 min-w-0 space-y-3 rounded-md border p-3'
          >
            <h4 className='text-sm font-medium break-words'>{rule.name}</h4>
            <p className='text-muted-foreground text-xs break-words'>
              {rule.reason}
            </p>
            <p className='text-muted-foreground text-xs'>
              {t('Any matching method triggers this rule.')}
            </p>
            {rule.match_groups.map((group, index) => (
              <div key={group.id} className='min-w-0 space-y-1.5'>
                <p className='text-xs font-medium'>
                  {t('Matching method {{number}}', { number: index + 1 })}
                </p>
                <p className='text-muted-foreground text-xs'>
                  {t('All conditions in this method must match.')}
                </p>
                <ul className='min-w-0 space-y-2'>
                  {group.conditions.map((condition, conditionIndex) => (
                    <li
                      key={condition.id ?? conditionIndex}
                      className='min-w-0 space-y-1 text-xs'
                    >
                      <span>
                        {fieldLabels[condition.field]} ·{' '}
                        {operatorLabels[condition.operator]}
                      </span>
                      <code className='bg-background block min-w-0 rounded border px-2 py-1.5 break-all whitespace-pre-wrap'>
                        {condition.value}
                      </code>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <dl className='grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 border-t pt-2 text-xs'>
              <dt className='text-muted-foreground'>{t('Channel')}</dt>
              <dd className='break-all'>
                {rule.channels?.length ? rule.channels.join(', ') : t('All')}
              </dd>
              <dt className='text-muted-foreground'>{t('Model')}</dt>
              <dd className='break-all'>
                {rule.models?.length ? rule.models.join(', ') : t('All')}
              </dd>
            </dl>
          </div>
        ))}
      </section>
    </div>
  )
}

export function BanRecordDetails(props: {
  event: BanEvent
  resultLabel: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title={t('Automatic ban details')}
      description={t('Saved rules at the time of this event.')}
      contentClassName='min-w-0 overflow-hidden max-sm:max-h-[calc(100dvh-1.5rem)] max-sm:w-[calc(100vw-1.5rem)] max-sm:max-w-[calc(100vw-1.5rem)] sm:max-w-xl'
      contentHeight='min(72dvh, 720px)'
      bodyClassName='pr-2 sm:pr-4'
      trigger={
        <button
          type='button'
          className='text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 cursor-pointer rounded-sm text-xs underline decoration-dotted underline-offset-4 outline-none focus-visible:ring-2'
        >
          {t('Matched rule snapshot')}
        </button>
      }
    >
      {open && (
        <RecordDetailsBody
          event={props.event}
          resultLabel={props.resultLabel}
        />
      )}
    </Dialog>
  )
}
