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
import { useRef } from 'react'
import { useFieldArray, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

import type { ServiceStatusSettings } from '../lib/settings'
import { ModelSettingsRow } from './model-settings-row'
import { StatusDragHandle } from './status-drag-handle'

export function GroupSettings(props: {
  form: UseFormReturn<ServiceStatusSettings>
  index: number
  count: number
  dragId: string
  disabled: boolean
  onDragStart: () => void
  onDragEnd: () => void
  move: (from: number, to: number) => void
}) {
  const { t } = useTranslation()
  const controls = useDragControls()
  const draggingModel = useRef<string | null>(null)
  const path = `groups.${props.index}` as const
  const group = props.form.watch(path)
  const description = group.description?.trim()
  const models = useFieldArray({
    control: props.form.control,
    name: `${path}.models`,
  })
  return (
    <Reorder.Item
      as='section'
      value={props.dragId}
      dragListener={false}
      dragControls={controls}
      drag={props.disabled || props.count < 2 ? false : 'y'}
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
      className='bg-background relative rounded-lg border'
      aria-label={group.group}
    >
      <div className='flex items-center gap-2 px-3 py-2'>
        <StatusDragHandle
          name={group.group}
          controls={controls}
          disabled={props.disabled}
          index={props.index}
          count={props.count}
          move={props.move}
        />
        <span className='text-muted-foreground w-5 shrink-0 text-xs tabular-nums'>
          {props.index + 1}
        </span>
        <div className='min-w-0 flex-1'>
          <h3 className='flex min-w-0 items-baseline gap-2 text-sm font-medium'>
            <span
              className='min-w-0 truncate'
              title={description || group.group}
            >
              {description || group.group}
            </span>
            {description && description !== group.group && (
              <span
                className='text-muted-foreground max-w-[50%] shrink-0 truncate text-xs font-normal'
                title={group.group}
              >
                {group.group}
              </span>
            )}
          </h3>
        </div>
        <Switch
          aria-label={`${t('Show group')}: ${group.group}`}
          checked={!group.hidden}
          onCheckedChange={(value) =>
            props.form.setValue(`${path}.hidden`, !value, { shouldDirty: true })
          }
        />
        <Button
          type='button'
          variant='ghost'
          size='icon-sm'
          aria-label={`${t('Move up')}: ${group.group}`}
          disabled={props.index === 0}
          onClick={() => props.move(props.index, props.index - 1)}
        >
          <ArrowUp className='size-4' />
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='icon-sm'
          aria-label={`${t('Move down')}: ${group.group}`}
          disabled={props.index === props.count - 1}
          onClick={() => props.move(props.index, props.index + 1)}
        >
          <ArrowDown className='size-4' />
        </Button>
      </div>
      <details className='border-t'>
        <summary className='text-muted-foreground cursor-pointer px-3 py-1.5 text-sm'>
          {t('Models')} ({group.models.length})
          {group.hidden && ` · ${t('Group hidden')}`}
        </summary>
        {models.fields.length === 0 && (
          <p className='text-muted-foreground px-4 pb-3 text-sm'>
            {t('No models in this group yet.')}
          </p>
        )}
        <Reorder.Group
          as='ol'
          axis='y'
          values={models.fields.map((field) => field.id)}
          aria-label={`${t('Model display order')}: ${group.group}`}
          className='px-3'
          onReorder={(ids) => {
            if (props.disabled || !draggingModel.current) return
            const from = models.fields.findIndex(
              (field) => field.id === draggingModel.current
            )
            const to = ids.indexOf(draggingModel.current)
            if (from >= 0 && to >= 0 && from !== to) models.move(from, to)
          }}
        >
          {models.fields.map((field, index) => (
            <ModelSettingsRow
              key={field.id}
              form={props.form}
              groupIndex={props.index}
              index={index}
              count={models.fields.length}
              dragId={field.id}
              disabled={props.disabled}
              move={models.move}
              onDragStart={() => {
                draggingModel.current = field.id
              }}
              onDragEnd={() => {
                draggingModel.current = null
              }}
            />
          ))}
        </Reorder.Group>
      </details>
    </Reorder.Item>
  )
}
