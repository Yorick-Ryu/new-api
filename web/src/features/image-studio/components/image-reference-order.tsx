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
import { Reorder, useDragControls } from 'motion/react'
import { useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { ImageReferencePreview, type ImageReference } from './image-references'

type ImageReferenceOrderProps = {
  value: ImageReference[]
  disabled: boolean
  onChange: (references: ImageReference[]) => void
}

export function ImageReferenceOrder(props: ImageReferenceOrderProps) {
  const { t } = useTranslation()
  const descriptionId = useId()
  return (
    <>
      <p id={descriptionId} className='sr-only'>
        {t(
          'Drag images to reorder, or use the left and right arrow keys. The first image is used for markup.'
        )}
      </p>
      <Reorder.Group
        as='div'
        axis='x'
        role='group'
        aria-label={t('Reference images')}
        className='flex gap-3 overflow-x-auto p-1'
        layoutScroll
        values={props.value}
        onReorder={(next) => {
          if (!props.disabled) props.onChange(next)
        }}
      >
        {props.value.map((reference, index) => (
          <SortableReference
            key={reference.id}
            reference={reference}
            disabled={props.disabled}
            canSort={props.value.length > 1}
            descriptionId={descriptionId}
            onRemove={() =>
              props.onChange(
                props.value.filter((item) => item.id !== reference.id)
              )
            }
            onMove={(direction) => {
              if (props.disabled) return
              const to = index + direction
              if (to < 0 || to >= props.value.length) return
              const next = [...props.value]
              next.splice(index, 1)
              next.splice(to, 0, reference)
              props.onChange(next)
            }}
          />
        ))}
      </Reorder.Group>
    </>
  )
}

function SortableReference(props: {
  reference: ImageReference
  disabled: boolean
  canSort: boolean
  descriptionId: string
  onRemove: () => void
  onMove: (direction: number) => void
}) {
  const controls = useDragControls()
  const didDrag = useRef(false)
  const sortable = props.canSort && !props.disabled
  return (
    <Reorder.Item
      as='div'
      value={props.reference}
      dragListener={false}
      drag={sortable ? 'x' : false}
      dragControls={controls}
      dragMomentum={false}
      className='relative shrink-0'
      onDragStart={() => {
        didDrag.current = true
      }}
    >
      <ImageReferencePreview
        reference={props.reference}
        disabled={props.disabled}
        onRemove={props.onRemove}
        previewButtonProps={{
          className: sortable
            ? 'cursor-grab touch-none active:cursor-grabbing'
            : undefined,
          'aria-describedby': props.canSort ? props.descriptionId : undefined,
          'aria-keyshortcuts': sortable ? 'ArrowLeft ArrowRight' : undefined,
          onPointerDown: (event) => {
            didDrag.current = false
            if (sortable && event.button === 0) controls.start(event)
          },
          onClickCapture: (event) => {
            if (didDrag.current && event.detail !== 0) {
              event.preventDefault()
              event.stopPropagation()
            }
          },
          onKeyDown: (event) => {
            if (!sortable || !['ArrowLeft', 'ArrowRight'].includes(event.key)) {
              return
            }
            event.preventDefault()
            props.onMove(event.key === 'ArrowLeft' ? -1 : 1)
          },
        }}
      />
    </Reorder.Item>
  )
}
