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
import { Plus, Trash2 } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

import { SettingsControlGroup } from '../components/settings-form-layout'
import { AutoBanSelect } from './auto-ban-select'
import type { BanCondition, BanMatchGroup } from './lib/schema'

function ConditionEditor(props: {
  condition: BanCondition
  onChange: (condition: BanCondition) => void
  onRemove: () => void
  canRemove: boolean
  disabled: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  const change = (patch: Partial<BanCondition>) =>
    props.onChange({ ...props.condition, ...patch })
  const operators =
    props.condition.field === 'violations'
      ? [{ value: 'includes', label: t('List includes') }]
      : [
          { value: 'equals', label: t('Equals') },
          ...(props.condition.field === 'http_status'
            ? []
            : [{ value: 'contains', label: t('Contains') }]),
        ]
  return (
    <div className='grid min-w-0 items-end gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)_auto]'>
      <AutoBanSelect
        label={t('Error field')}
        value={props.condition.field}
        disabled={props.disabled}
        items={[
          { value: 'code', label: t('Error code') },
          { value: 'message', label: t('Error message') },
          { value: 'violations', label: t('Violation marker') },
          { value: 'http_status', label: t('HTTP status') },
        ]}
        onChange={(value) =>
          change({
            field: value as BanCondition['field'],
            operator: value === 'violations' ? 'includes' : 'equals',
          })
        }
      />
      <AutoBanSelect
        label={t('Match operator')}
        value={props.condition.operator}
        disabled={props.disabled}
        items={operators}
        onChange={(value) =>
          change({ operator: value as BanCondition['operator'] })
        }
      />
      <Field>
        <FieldLabel htmlFor={id}>{t('Match value')}</FieldLabel>
        <Input
          id={id}
          value={props.condition.value}
          maxLength={1000}
          onChange={(event) => change({ value: event.target.value })}
        />
      </Field>
      <Button
        type='button'
        variant='ghost'
        size='icon'
        aria-label={t('Remove condition')}
        disabled={props.disabled || !props.canRemove}
        onClick={props.onRemove}
      >
        <Trash2 className='size-4' aria-hidden='true' />
      </Button>
    </div>
  )
}

export function MatchGroupEditor(props: {
  group: BanMatchGroup
  index: number
  onChange: (group: BanMatchGroup) => void
  onRemove: () => void
  canRemove: boolean
  disabled: boolean
}) {
  const { t } = useTranslation()
  return (
    <SettingsControlGroup>
      <div className='flex items-center justify-between gap-3'>
        <span className='text-sm font-medium'>
          {t('Matching method {{number}}', { number: props.index + 1 })}
        </span>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          disabled={props.disabled || !props.canRemove}
          onClick={props.onRemove}
        >
          {t('Remove matching method')}
        </Button>
      </div>
      <p className='text-muted-foreground text-xs'>
        {t('All conditions in this method must match.')}
      </p>
      {props.group.conditions.map((condition, index) => (
        <ConditionEditor
          key={condition.id}
          condition={condition}
          disabled={props.disabled}
          canRemove={props.group.conditions.length > 1}
          onChange={(updated) =>
            props.onChange({
              ...props.group,
              conditions: props.group.conditions.map((c, i) =>
                i === index ? updated : c
              ),
            })
          }
          onRemove={() =>
            props.onChange({
              ...props.group,
              conditions: props.group.conditions.filter((_, i) => i !== index),
            })
          }
        />
      ))}
      <Button
        type='button'
        variant='outline'
        size='sm'
        disabled={props.disabled || props.group.conditions.length >= 8}
        onClick={() =>
          props.onChange({
            ...props.group,
            conditions: [
              ...props.group.conditions,
              {
                id: crypto.randomUUID(),
                field: 'code',
                operator: 'equals',
                value: '',
              },
            ],
          })
        }
      >
        <Plus data-icon='inline-start' />
        {t('Add condition')}
      </Button>
    </SettingsControlGroup>
  )
}
