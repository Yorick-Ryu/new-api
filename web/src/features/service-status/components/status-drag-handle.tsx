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
import { GripVertical } from 'lucide-react'
import type { DragControls } from 'motion/react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

export function StatusDragHandle(props: {
  name: string
  controls: DragControls
  disabled: boolean
  index: number
  count: number
  move: (from: number, to: number) => void
}) {
  const { t } = useTranslation()
  return (
    <Button
      type='button'
      variant='ghost'
      size='icon-sm'
      disabled={props.disabled || props.count < 2}
      className='shrink-0 cursor-grab touch-none active:cursor-grabbing'
      aria-label={t('Drag {{model}} to reorder', { model: props.name })}
      onPointerDown={(event) => {
        if (!props.disabled && props.count > 1) props.controls.start(event)
      }}
      onKeyDown={(event) => {
        if (
          props.disabled ||
          (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
        ) {
          return
        }
        event.preventDefault()
        const to = props.index + (event.key === 'ArrowUp' ? -1 : 1)
        if (to >= 0 && to < props.count) props.move(props.index, to)
      }}
    >
      <GripVertical aria-hidden='true' className='size-4' />
    </Button>
  )
}
