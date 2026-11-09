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
import { Pencil, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { FieldError } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { handleServerError } from '@/lib/handle-server-error'

import { uploadReference } from '../api'
import type { ImageReference } from './image-references'

type Point = { x: number; y: number }
type Stroke = { points: Point[]; circle: boolean }
export type ImageMarkupValue = { id: string; strokes: Stroke[] }

// The shared dialog supplies focus and scrolling; canvas is needed because the
// existing image preview has no drawing or transparent-overlay export API.
export function ImageMarkup(props: {
  reference: ImageReference
  value: ImageMarkupValue | null
  disabled: boolean
  onBusyChange: (busy: boolean) => void
  onApply: (reference: ImageReference, markup: ImageMarkupValue) => void
  onClear: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [url, setURL] = useState(props.reference.url)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [tool, setTool] = useState('pen')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const imageRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef<number | null>(null)
  const cursor = useRef<Point>({ x: 0, y: 0 })
  const [keyboardCursor, setKeyboardCursor] = useState<Point | null>(null)
  const onBusyChange = props.onBusyChange
  useEffect(() => {
    onBusyChange(saving)
    return () => onBusyChange(false)
  }, [saving, onBusyChange])
  useEffect(() => {
    if (!props.reference.blob) {
      setURL(props.reference.url)
      return
    }
    const objectURL = URL.createObjectURL(props.reference.blob)
    setURL(objectURL)
    return () => URL.revokeObjectURL(objectURL)
  }, [props.reference.blob, props.reference.url])
  useEffect(() => {
    const context = canvasRef.current?.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, dimensions.width, dimensions.height)
    context.strokeStyle = '#ef4444'
    context.lineWidth = Math.max(3, dimensions.width / 180)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    for (const stroke of strokes) {
      const start = stroke.points[0]
      const end = stroke.points.at(-1)
      if (!start || !end) continue
      context.beginPath()
      if (stroke.circle) {
        context.ellipse(
          (start.x + end.x) / 2,
          (start.y + end.y) / 2,
          Math.max(1, Math.abs(end.x - start.x) / 2),
          Math.max(1, Math.abs(end.y - start.y) / 2),
          0,
          0,
          Math.PI * 2
        )
      } else {
        context.moveTo(start.x, start.y)
        for (const point of stroke.points) context.lineTo(point.x, point.y)
        if (stroke.points.length === 1) context.lineTo(start.x + 1, start.y)
      }
      context.stroke()
    }
  }, [strokes, dimensions, open])
  async function save() {
    const canvas = canvasRef.current
    const source = imageRef.current
    if (!canvas || !source || saving) return
    setSaving(true)
    setError('')
    try {
      // Normalize browser-decoded EXIF orientation in the submitted first image
      // so the original and the transparent layer have identical pixel axes.
      const normalized = document.createElement('canvas')
      normalized.width = dimensions.width
      normalized.height = dimensions.height
      const context = normalized.getContext('2d')
      if (!context) throw new Error(t('Failed to prepare image markup'))
      context.drawImage(source, 0, 0)
      const blobs = await Promise.all(
        [normalized, canvas].map(
          (item) =>
            new Promise<Blob>((resolve, reject) =>
              item.toBlob((blob) => {
                if (blob) resolve(blob)
                else reject(new Error(t('Failed to prepare image markup')))
              }, 'image/png')
            )
        )
      )
      if (blobs.some((blob) => blob.size > 20 * 1024 * 1024)) {
        throw new Error(t('Reference images must be 20 MB or smaller'))
      }
      const referenceID = await uploadReference(
        new File([blobs[0]], 'reference.png', { type: 'image/png' })
      )
      const markupID = await uploadReference(
        new File([blobs[1]], 'markup.png', { type: 'image/png' })
      )
      props.onApply(
        { id: referenceID, name: props.reference.name, blob: blobs[0] },
        { id: markupID, strokes }
      )
      setOpen(false)
    } catch (failure) {
      handleServerError(failure)
    } finally {
      setSaving(false)
    }
  }
  const ready = dimensions.width > 0 && !error && !saving
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (saving) return
          if (value) {
            setStrokes(props.value?.strokes ?? [])
            setDimensions({ width: 0, height: 0 })
            setError('')
            setKeyboardCursor(null)
            drawing.current = null
          }
          setOpen(value)
        }}
        title={t('Mark areas to edit')}
        description={t(
          'Mark the first reference image, then describe the changes in your prompt. The original image stays intact.'
        )}
        trigger={
          <Button type='button' variant='outline' disabled={props.disabled}>
            <Pencil />
            {props.value ? t('Edit markup') : t('Mark areas to edit')}
          </Button>
        }
        footer={
          <>
            <Button
              type='button'
              variant='outline'
              disabled={saving}
              onClick={() => setOpen(false)}
            >
              {t('Cancel')}
            </Button>
            <Button
              type='button'
              disabled={!ready || strokes.length === 0}
              onClick={() => void save()}
            >
              {saving && <Spinner />}
              {t('Apply markup')}
            </Button>
          </>
        }
      >
        <div className='flex flex-wrap items-center gap-2 pb-3'>
          <ToggleGroup
            aria-label={t('Drawing tool')}
            value={[tool]}
            disabled={saving}
            onValueChange={(value) => {
              if (value[0]) setTool(value[0])
            }}
          >
            <ToggleGroupItem value='pen'>{t('Brush')}</ToggleGroupItem>
            <ToggleGroupItem value='circle'>{t('Circle')}</ToggleGroupItem>
          </ToggleGroup>
          <Button
            type='button'
            variant='outline'
            disabled={!ready || strokes.length === 0}
            onClick={() => setStrokes((value) => value.slice(0, -1))}
          >
            <Undo2 />
            {t('Undo')}
          </Button>
          <Button
            type='button'
            variant='outline'
            disabled={!ready || strokes.length === 0}
            onClick={() => setStrokes([])}
          >
            {t('Clear')}
          </Button>
        </div>
        {error && <FieldError>{t(error)}</FieldError>}
        <div
          className='relative mx-auto w-full'
          style={{
            maxWidth: dimensions.height
              ? (dimensions.width * 480) / dimensions.height
              : undefined,
          }}
        >
          <img
            ref={imageRef}
            src={url}
            alt={props.reference.name}
            className='block w-full rounded-md'
            onError={() => setError('Failed to load image')}
            onLoad={(event) => {
              const { naturalWidth: width, naturalHeight: height } =
                event.currentTarget
              if (!width || !height || width * height > 16777216) {
                setError('Markup images must have at most 16,777,216 pixels')
                return
              }
              cursor.current = { x: width / 2, y: height / 2 }
              setDimensions({ width, height })
            }}
          />
          <canvas
            ref={canvasRef}
            width={dimensions.width}
            height={dimensions.height}
            className='focus-visible:ring-ring absolute inset-0 size-full touch-none rounded-md outline-none focus-visible:ring-2'
            tabIndex={ready ? 0 : -1}
            role='img'
            aria-label={t('Image markup canvas')}
            aria-describedby='image-markup-keyboard'
            onPointerDown={(event) => {
              if (!ready || drawing.current !== null || event.button !== 0) {
                return
              }
              event.preventDefault()
              setKeyboardCursor(null)
              event.currentTarget.focus()
              event.currentTarget.setPointerCapture(event.pointerId)
              const rect = event.currentTarget.getBoundingClientRect()
              const point = {
                x:
                  ((event.clientX - rect.left) * dimensions.width) / rect.width,
                y:
                  ((event.clientY - rect.top) * dimensions.height) /
                  rect.height,
              }
              drawing.current = event.pointerId
              setStrokes((value) => [
                ...value,
                { points: [point], circle: tool === 'circle' },
              ])
            }}
            onPointerMove={(event) => {
              if (!ready || drawing.current !== event.pointerId) return
              const rect = event.currentTarget.getBoundingClientRect()
              const point = {
                x: Math.max(
                  0,
                  Math.min(
                    dimensions.width,
                    ((event.clientX - rect.left) * dimensions.width) /
                      rect.width
                  )
                ),
                y: Math.max(
                  0,
                  Math.min(
                    dimensions.height,
                    ((event.clientY - rect.top) * dimensions.height) /
                      rect.height
                  )
                ),
              }
              setStrokes((value) =>
                value.map((stroke, index) => {
                  if (index !== value.length - 1) return stroke
                  const points = stroke.circle
                    ? [stroke.points[0], point]
                    : [...stroke.points, point]
                  return { ...stroke, points }
                })
              )
            }}
            onPointerUp={() => {
              drawing.current = null
            }}
            onPointerCancel={() => {
              drawing.current = null
            }}
            onLostPointerCapture={() => {
              drawing.current = null
            }}
            onKeyDown={(event) => {
              if (
                !ready ||
                ![
                  'ArrowLeft',
                  'ArrowRight',
                  'ArrowUp',
                  'ArrowDown',
                  ' ',
                ].includes(event.key)
              ) {
                return
              }
              event.preventDefault()
              const step = Math.max(
                1,
                Math.min(dimensions.width, dimensions.height) / 20
              )
              const point = cursor.current
              if (event.key === 'ArrowLeft') {
                point.x = Math.max(step, point.x - step)
              }
              if (event.key === 'ArrowRight') {
                point.x = Math.min(dimensions.width - step, point.x + step)
              }
              if (event.key === 'ArrowUp') {
                point.y = Math.max(step, point.y - step)
              }
              if (event.key === 'ArrowDown') {
                point.y = Math.min(dimensions.height - step, point.y + step)
              }
              setKeyboardCursor({ ...point })
              if (event.key === ' ') {
                setStrokes((value) => [
                  ...value,
                  {
                    circle: true,
                    points: [
                      { x: point.x - step, y: point.y - step },
                      { x: point.x + step, y: point.y + step },
                    ],
                  },
                ])
              }
            }}
          />
          {keyboardCursor && ready && (
            <span
              aria-hidden='true'
              className='pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-red-500 bg-white/70'
              style={{
                left: `${(keyboardCursor.x / dimensions.width) * 100}%`,
                top: `${(keyboardCursor.y / dimensions.height) * 100}%`,
              }}
            />
          )}
        </div>
        <p id='image-markup-keyboard' className='sr-only'>
          {t(
            'Drag to mark an area. Keyboard: arrow keys move from the center; Space adds a circle.'
          )}
        </p>
      </Dialog>
      {props.value && (
        <Button
          type='button'
          variant='ghost'
          disabled={props.disabled}
          onClick={props.onClear}
        >
          {t('Remove markup')}
        </Button>
      )}
    </>
  )
}
