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
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from '@/components/ui/carousel'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { ImageAsset } from '../api'
import { ImageAssetView } from './image-asset-view'

export function ImageViewer(props: {
  assets: ImageAsset[]
  initialIndex: number
  onSelect: (index: number) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [api, setApi] = useState<CarouselApi>()
  const [index, setIndex] = useState(props.initialIndex)
  const onSelect = props.onSelect
  useEffect(() => {
    if (!api) return
    const select = () => {
      const value = api.selectedScrollSnap()
      setIndex(value)
      onSelect(value)
    }
    api.on('select', select)
    return () => {
      api.off('select', select)
    }
  }, [api, onSelect])
  useEffect(() => {
    if (!api || props.assets.length < 2) return
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      if (
        (event.target as HTMLElement).closest(
          'input,textarea,[contenteditable="true"],[role="alertdialog"]'
        )
      ) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const step = event.key === 'ArrowLeft' ? -1 : 1
      api.scrollTo(
        (api.selectedScrollSnap() + step + props.assets.length) %
          props.assets.length
      )
    }
    document.addEventListener('keydown', keydown, true)
    return () => document.removeEventListener('keydown', keydown, true)
  }, [api, props.assets.length])
  return (
    <div className='flex min-w-0 flex-col gap-3'>
      <Carousel
        opts={{ startIndex: props.initialIndex, loop: true }}
        setApi={setApi}
        aria-label={t('Image Preview')}
      >
        <CarouselContent>
          {props.assets.map((asset) => (
            <CarouselItem key={asset.id}>
              <ImageAssetView asset={asset} />
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
      {props.assets.length > 1 && (
        <div className='flex items-center justify-center gap-4'>
          <Button
            variant='outline'
            size='icon-sm'
            aria-label={t('Previous image')}
            onClick={() =>
              api?.scrollTo(
                (index - 1 + props.assets.length) % props.assets.length
              )
            }
          >
            <ChevronLeft />
          </Button>
          <span
            aria-live='polite'
            className='text-muted-foreground inline-flex w-16 shrink-0 items-center justify-center gap-1 font-mono text-sm whitespace-nowrap tabular-nums'
          >
            <span className='inline-block w-3 text-center'>
              {formatNumber(index + 1, locale)}
            </span>
            <span className='inline-block w-3 text-center'>/</span>
            <span className='inline-block w-3 text-center'>
              {formatNumber(props.assets.length, locale)}
            </span>
          </span>
          <Button
            variant='outline'
            size='icon-sm'
            aria-label={t('Next image')}
            onClick={() => api?.scrollTo((index + 1) % props.assets.length)}
          >
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  )
}
