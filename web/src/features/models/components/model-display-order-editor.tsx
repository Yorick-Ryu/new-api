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
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react'
import { Reorder, useDragControls } from 'motion/react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

type OrderEditorProps = {
  names: string[]
  disabled?: boolean
  onChange: (names: string[]) => void
}

type OrderItemProps = {
  name: string
  index: number
  count: number
  disabled?: boolean
  onMove: (from: number, to: number) => void
}

function OrderItem(props: OrderItemProps) {
  const { t } = useTranslation()
  const dragControls = useDragControls()
  const disabled = props.disabled || props.count < 2
  return (
    <Reorder.Item
      value={props.name}
      dragListener={false}
      dragControls={dragControls}
      drag={disabled ? false : 'y'}
      className='bg-background flex items-center gap-2 rounded-md border p-2'
    >
      <Button
        type='button'
        variant='ghost'
        size='icon-sm'
        disabled={disabled}
        className='shrink-0 cursor-grab touch-none active:cursor-grabbing'
        aria-label={t('Drag {{model}} to reorder', { model: props.name })}
        onPointerDown={(event) => {
          if (!disabled) dragControls.start(event)
        }}
        onKeyDown={(event) => {
          if (disabled) return
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            props.onMove(
              props.index,
              props.index + (event.key === 'ArrowUp' ? -1 : 1)
            )
          }
        }}
      >
        <GripVertical aria-hidden='true' />
      </Button>
      <span className='text-muted-foreground w-8 shrink-0 text-center'>
        {props.index + 1}
      </span>
      <span className='min-w-0 flex-1 text-sm break-all'>{props.name}</span>
      <Button
        type='button'
        variant='ghost'
        size='icon-sm'
        disabled={disabled || props.index === 0}
        aria-label={t('Move {{model}} up', { model: props.name })}
        onClick={() => props.onMove(props.index, props.index - 1)}
      >
        <ArrowUp aria-hidden='true' />
      </Button>
      <Button
        type='button'
        variant='ghost'
        size='icon-sm'
        disabled={disabled || props.index === props.count - 1}
        aria-label={t('Move {{model}} down', { model: props.name })}
        onClick={() => props.onMove(props.index, props.index + 1)}
      >
        <ArrowDown aria-hidden='true' />
      </Button>
    </Reorder.Item>
  )
}

export function ModelDisplayOrderEditor(props: OrderEditorProps) {
  const { t } = useTranslation()
  const move = (from: number, to: number) => {
    if (props.disabled || to < 0 || to >= props.names.length || from === to) {
      return
    }
    const names = [...props.names]
    const [name] = names.splice(from, 1)
    names.splice(to, 0, name)
    props.onChange(names)
  }
  if (props.names.length === 0) {
    return (
      <p className='text-muted-foreground py-8 text-center'>
        {t('No models available to reorder')}
      </p>
    )
  }
  return (
    <Reorder.Group
      axis='y'
      values={props.names}
      layoutScroll
      aria-label={t('Model display order')}
      onReorder={(names) => {
        if (!props.disabled) props.onChange(names)
      }}
      className='min-h-0 flex-1 space-y-2 overflow-y-auto p-1'
    >
      {props.names.map((name, index) => (
        <OrderItem
          key={name}
          name={name}
          index={index}
          count={props.names.length}
          disabled={props.disabled}
          onMove={move}
        />
      ))}
    </Reorder.Group>
  )
}
