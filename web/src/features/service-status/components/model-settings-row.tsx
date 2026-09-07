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
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Reorder, useDragControls } from 'motion/react'
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

import type { ServiceStatusSettings } from '../lib/settings'
import { StatusDragHandle } from './status-drag-handle'

export function ModelSettingsRow(props: {
  form: UseFormReturn<ServiceStatusSettings>
  groupIndex: number
  index: number
  count: number
  dragId: string
  disabled: boolean
  move: (from: number, to: number) => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const { t } = useTranslation()
  const controls = useDragControls()
  const group = props.form.watch(`groups.${props.groupIndex}`)
  const model = group.models[props.index]
  const name = `${group.group} / ${model.model}`
  return (
    <Reorder.Item
      value={props.dragId}
      dragListener={false}
      dragControls={controls}
      drag={props.disabled || props.count < 2 ? false : 'y'}
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
      className='bg-background relative flex items-center gap-2 border-b py-1.5 last:border-b-0'
    >
      <StatusDragHandle
        name={name}
        controls={controls}
        disabled={props.disabled}
        index={props.index}
        count={props.count}
        move={props.move}
      />
      <span className='text-muted-foreground w-5 shrink-0 text-xs tabular-nums'>
        {props.index + 1}
      </span>
      <span className='min-w-0 flex-1 text-sm font-medium break-all'>
        {model.model}
      </span>
      <Switch
        size='sm'
        aria-label={`${t('Show model')}: ${name}`}
        disabled={props.disabled}
        checked={!model.hidden}
        onCheckedChange={(value) =>
          props.form.setValue(
            `groups.${props.groupIndex}.models.${props.index}.hidden`,
            !value,
            { shouldDirty: true }
          )
        }
      />
      <Button
        type='button'
        variant='ghost'
        size='icon-sm'
        aria-label={`${t('Move up')}: ${name}`}
        disabled={props.disabled || props.index === 0}
        onClick={() => props.move(props.index, props.index - 1)}
      >
        <ArrowUp className='size-3.5' />
      </Button>
      <Button
        type='button'
        variant='ghost'
        size='icon-sm'
        aria-label={`${t('Move down')}: ${name}`}
        disabled={props.disabled || props.index === props.count - 1}
        onClick={() => props.move(props.index, props.index + 1)}
      >
        <ArrowDown className='size-3.5' />
      </Button>
    </Reorder.Item>
  )
}
