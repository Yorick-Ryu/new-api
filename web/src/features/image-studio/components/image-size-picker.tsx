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
import {
  RectangleHorizontal,
  RectangleVertical,
  Scan,
  Square,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldTitle,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

import { formatAspectRatio } from '../lib/aspect-ratio'

type ImageSizePickerProps = {
  mode?: 'size' | 'ratio'
  sizes: string[]
  customSize: boolean
  value: string
  ratioSize: string
  error?: string
  disabled: boolean
  onChange: (size: string) => void
  onRatioChange: (size: string) => void
}

export function ImageSizePicker(props: ImageSizePickerProps) {
  const { t } = useTranslation()
  const [customSelected, setCustomSelected] = useState(false)
  const isCustom =
    props.customSize &&
    props.value !== '' &&
    (customSelected || !props.sizes.includes(props.value))
  const [width = '', height = ''] = props.value.split('x')
  const [invalidWidth, invalidHeight] = [width, height].map((value) => {
    const pixels = Number(value)
    return (
      !Number.isInteger(pixels) ||
      pixels <= 0 ||
      pixels > 3840 ||
      pixels % 16 !== 0
    )
  })
  // A combined size constraint applies to both fields only when each edge is valid.
  const widthError = !!props.error && (invalidWidth || !invalidHeight)
  const heightError = !!props.error && (invalidHeight || !invalidWidth)
  const ratioSizes = props.customSize
    ? [...new Set([...props.sizes, '1152x1536', '1536x1152'])]
    : props.sizes
  const ratios = ratioSizes.flatMap((size) => {
    if (size === '') {
      return [
        { size, ratio: t('Free ratio'), label: t('Model decides'), Icon: Scan },
      ]
    }
    const match = /^(\d+)x(\d+)$/.exec(size)
    if (!match) return []
    const width = Number(match[1])
    const height = Number(match[2])
    if (
      !Number.isSafeInteger(width) ||
      !Number.isSafeInteger(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return []
    }
    let Icon = Square
    let label = t('Square image')
    if (width > height) {
      Icon = RectangleHorizontal
      label = t('Landscape image')
    } else if (width < height) {
      Icon = RectangleVertical
      label = t('Portrait image')
    }
    return [{ size, ratio: formatAspectRatio(size), label, Icon }]
  })

  return (
    <>
      {props.mode !== 'ratio' && (
        <Field className='gap-2.5'>
          <FieldTitle>{t('Image size')}</FieldTitle>
          <ToggleGroup
            aria-label={t('Image size')}
            variant='outline'
            spacing={2}
            value={[isCustom ? 'custom' : props.value || 'auto']}
            disabled={props.disabled}
            className='w-full flex-wrap justify-start'
            onValueChange={(values) => {
              if (values[0] === 'custom' && props.customSize) {
                setCustomSelected(true)
                props.onChange(`${width || '1024'}x${height || '1024'}`)
                return
              }
              const size = values[0] === 'auto' ? '' : values[0]
              if (size !== undefined && props.sizes.includes(size)) {
                setCustomSelected(false)
                props.onChange(size)
              }
            }}
          >
            {props.sizes.map((size) => (
              <ToggleGroupItem
                key={size}
                value={size || 'auto'}
                className='aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground h-[30px] px-2.5'
              >
                {size ? size.replace('x', '×') : t('Auto')}
              </ToggleGroupItem>
            ))}
            {props.customSize && (
              <ToggleGroupItem
                value='custom'
                className='aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground h-[30px] px-2.5'
              >
                {t('Custom')}
              </ToggleGroupItem>
            )}
          </ToggleGroup>
          {isCustom && (
            <div className='grid min-w-0 gap-2.5 [contain:inline-size]'>
              <div className='grid grid-cols-2 gap-3'>
                <Field>
                  <FieldLabel htmlFor='image-width'>{t('Width')}</FieldLabel>
                  <Input
                    id='image-width'
                    type='text'
                    inputMode='numeric'
                    maxLength={4}
                    pattern='[0-9]*'
                    value={width}
                    disabled={props.disabled}
                    aria-invalid={widthError}
                    aria-describedby='image-size-limits'
                    onChange={(event) => {
                      const value = event.target.value
                      if (/^\d{0,4}$/.test(value) && Number(value) <= 3840) {
                        props.onChange(`${value}x${height}`)
                      }
                    }}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor='image-height'>{t('Height')}</FieldLabel>
                  <Input
                    id='image-height'
                    type='text'
                    inputMode='numeric'
                    maxLength={4}
                    pattern='[0-9]*'
                    value={height}
                    disabled={props.disabled}
                    aria-invalid={heightError}
                    aria-describedby='image-size-limits'
                    onChange={(event) => {
                      const value = event.target.value
                      if (/^\d{0,4}$/.test(value) && Number(value) <= 3840) {
                        props.onChange(`${width}x${value}`)
                      }
                    }}
                  />
                </Field>
              </div>
              {props.error ? (
                <FieldError id='image-size-limits'>{t(props.error)}</FieldError>
              ) : (
                <FieldDescription id='image-size-limits'>
                  {t(
                    'Width and height must be multiples of 16 and no greater than 3840, with 655,360 to 8,294,400 total pixels and an aspect ratio no greater than 3:1.'
                  )}
                </FieldDescription>
              )}
            </div>
          )}
          {!isCustom && props.error && (
            <FieldError className='[contain:inline-size]'>
              {t(props.error)}
            </FieldError>
          )}
        </Field>
      )}
      {props.mode === 'ratio' && ratios.length > 0 && (
        <Field className='gap-2.5'>
          <FieldTitle>{t('Aspect ratio')}</FieldTitle>
          <ToggleGroup
            aria-label={t('Aspect ratio')}
            variant='outline'
            spacing={2}
            value={[props.ratioSize || 'auto']}
            disabled={props.disabled}
            className={`grid w-full ${ratios.length > 4 ? 'grid-cols-3' : 'grid-cols-4'}`}
            onValueChange={(values) => {
              const size = values[0] === 'auto' ? '' : values[0]
              if (size !== undefined && ratioSizes.includes(size)) {
                if (size) setCustomSelected(false)
                props.onRatioChange(size)
              }
            }}
          >
            {ratios.map(({ size, ratio, label, Icon }) => (
              <ToggleGroupItem
                key={size}
                value={size || 'auto'}
                className='aria-pressed:border-primary aria-pressed:bg-primary/10 h-auto min-w-0 flex-col gap-2 px-1 py-3'
              >
                <Icon aria-hidden='true' className='size-5' />
                <span>{ratio}</span>
                <span className='text-muted-foreground text-center text-[11px] leading-4 font-normal whitespace-normal'>
                  {label}
                </span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
      )}
    </>
  )
}
