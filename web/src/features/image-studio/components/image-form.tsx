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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import {
  ImagePlus,
  Images,
  RectangleHorizontal,
  RectangleVertical,
  Square,
  Scan,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { ModelSelector } from '@/components/model-group-selector'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from '@/components/ui/field'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { createImageJob, type ImageInput, type ImageOptions } from '../api'
import { formatAspectRatio } from '../lib/aspect-ratio'
import { ImageCostEstimate } from './image-cost-estimate'
import { ImageReferences, type ImageReference } from './image-references'
import { ImageSizePicker } from './image-size-picker'

const schema = z.object({
  model: z.string().min(1),
  prompt: z.string().trim().min(1).max(16000),
  size: z.string().refine((value) => {
    if (value === '') return true
    const match = /^(\d+)x(\d+)$/.exec(value)
    if (!match) return false
    const width = Number(match[1])
    const height = Number(match[2])
    return (
      Number.isSafeInteger(width) &&
      Number.isSafeInteger(height) &&
      width > 0 &&
      height > 0 &&
      width <= 3840 &&
      height <= 3840 &&
      width % 16 === 0 &&
      height % 16 === 0 &&
      width * height >= 655360 &&
      width <= 8294400 / height &&
      Math.max(width, height) <= 3 * Math.min(width, height)
    )
  }, 'Custom image dimensions must be multiples of 16, no larger than 3840 pixels per edge, with 655,360 to 8,294,400 total pixels and an aspect ratio between 1:3 and 3:1.'),
  quality: z.string(),
  n: z.number().int().min(1).max(4),
  reference_id: z.string().optional(),
  reference_ids: z.array(z.string()).max(4).optional(),
})
const defaults: ImageInput = {
  model: '',
  prompt: '',
  size: '',
  quality: '',
  n: 1,
}

type ImageFormProps = {
  options: ImageOptions
  reuse: { input: ImageInput; version: number } | null
  reference: { id: string; name: string } | null
  referencePending?: boolean
  onReferenceStateChange?: (state: { count: number; enabled: boolean }) => void
  onCreated: (id: string) => void
}

export function ImageForm(props: ImageFormProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const form = useForm<ImageInput>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  })
  const model = form.watch('model')
  const size = form.watch('size')
  const quality = form.watch('quality')
  const count = form.watch('n')
  const [ratioSize, setRatioSize] = useState('')
  const [ratioWidth, ratioHeight] = ratioSize.split('x').map(Number)
  let RatioIcon = Scan
  if (ratioSize) {
    if (ratioWidth === ratioHeight) RatioIcon = Square
    else if (ratioWidth > ratioHeight) RatioIcon = RectangleHorizontal
    else RatioIcon = RectangleVertical
  }
  const [sizeOpen, setSizeOpen] = useState(false)
  const [qualityOpen, setQualityOpen] = useState(false)
  const [countOpen, setCountOpen] = useState(false)
  const capability = props.options.models.find((item) => item.model === model)
  const [references, setReferences] = useState<ImageReference[]>([])
  const [uploading, setUploading] = useState(false)
  const request = useRef<{ fingerprint: string; key: string } | null>(null)
  const create = useMutation({
    mutationFn: (input: ImageInput) => {
      const fingerprint = JSON.stringify(input)
      if (request.current?.fingerprint !== fingerprint) {
        request.current = { fingerprint, key: crypto.randomUUID() }
      }
      return createImageJob(input, request.current.key)
    },
    onError: (error) =>
      handleServerError(error, undefined, {
        title: t(getServerErrorMessage(error)),
      }),
    onSuccess: (result) => {
      request.current = null
      props.onCreated(result.id)
    },
  })

  useEffect(() => {
    if (!form.getValues('model') && props.options.models[0]) {
      const defaultModel = props.options.models.find(
        (item) => item.model === 'gpt-image-2.5'
      )
      form.setValue(
        'model',
        defaultModel?.model ?? props.options.models[0].model
      )
    }
  }, [props.options.models, form])
  useEffect(() => {
    if (props.reuse) {
      form.reset(props.reuse.input)
      setRatioSize('')
      setReferences([])
    }
  }, [props.reuse, form])
  const appliedReference = useRef<ImageReference | null>(null)
  useEffect(() => {
    if (!props.reference || appliedReference.current === props.reference) return
    appliedReference.current = props.reference
    if (
      references.length >= 4 ||
      references.some((item) => item.id === props.reference?.id)
    ) {
      return
    }
    const next = [...references, props.reference]
    form.setValue('reference_id', undefined)
    form.setValue(
      'reference_ids',
      next.map((item) => item.id)
    )
    setReferences(next)
  }, [props.reference, references, form])
  const onReferenceStateChange = props.onReferenceStateChange
  useEffect(() => {
    onReferenceStateChange?.({
      count: references.length,
      enabled: !!capability?.editing && !uploading && !create.isPending,
    })
  }, [
    references.length,
    capability?.editing,
    uploading,
    create.isPending,
    onReferenceStateChange,
  ])

  const busy = create.isPending || uploading || !!props.referencePending
  const qualityLabels: Record<string, string> = {
    low: t('Low'),
    medium: t('Medium'),
    high: t('High'),
    standard: t('Standard'),
    hd: t('HD'),
  }
  return (
    <Card className='h-fit min-w-0' data-card-hover='false'>
      <CardContent>
        <form
          noValidate
          onSubmit={form.handleSubmit(
            (input) =>
              create.mutate({ ...input, size: input.size || ratioSize }),
            (errors) => {
              if (errors.size) setSizeOpen(true)
            }
          )}
        >
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.prompt}>
              <FieldLabel htmlFor='image-prompt'>
                {t('Image prompt')}
              </FieldLabel>
              <Textarea
                id='image-prompt'
                data-mobile-compact
                placeholder={t('Describe the image you want to create…')}
                rows={4}
                onKeyDown={(event) => {
                  if (
                    (event.ctrlKey || event.metaKey) &&
                    event.key === 'Enter' &&
                    !busy
                  ) {
                    event.preventDefault()
                    event.currentTarget.form?.requestSubmit()
                  }
                }}
                className='min-h-28 resize-y text-sm'
                maxLength={16000}
                aria-invalid={!!form.formState.errors.prompt}
                {...form.register('prompt')}
              />
              {form.formState.errors.prompt && (
                <FieldError>
                  {t('Enter a prompt of up to 16,000 characters')}
                </FieldError>
              )}
            </Field>
            <div className='flex flex-wrap items-end gap-4'>
              <Field className='w-36 max-w-full min-w-0 shrink-0'>
                <FieldLabel>{t('Model')}</FieldLabel>
                <ModelSelector
                  showLabelOnMobile
                  matchTriggerWidth
                  popupClassName='min-w-48'
                  searchable={false}
                  showCategories={false}
                  selectedModel={model}
                  models={props.options.models.map((item) => ({
                    value: item.model,
                    label: item.model,
                  }))}
                  disabled={busy || !props.options.available}
                  className='w-full'
                  onModelChange={(value) => {
                    form.setValue('model', value)
                    form.setValue('size', '')
                    setRatioSize('')
                    form.setValue('quality', '')
                    form.setValue('n', 1)
                    form.setValue('reference_id', undefined)
                    form.setValue('reference_ids', undefined)
                    setReferences([])
                  }}
                />
              </Field>
              {capability?.editing && (
                <Popover>
                  <PopoverTrigger
                    render={
                      <Button
                        type='button'
                        variant='outline'
                        className='max-w-full justify-start tabular-nums'
                        disabled={busy || !props.options.available}
                        aria-label={t('Reference images (up to 4)')}
                      />
                    }
                  >
                    <ImagePlus className='size-4' />
                    <span className='truncate'>{t('Reference images')}</span>
                    {references.length > 0 && (
                      <span className='shrink-0 font-mono tabular-nums'>
                        {formatNumber(references.length, locale)}/4
                      </span>
                    )}
                  </PopoverTrigger>
                  <PopoverContent
                    keepMounted
                    align='start'
                    aria-label={t('Reference images')}
                    className='w-max max-w-[calc(100vw-2rem)]'
                  >
                    <ImageReferences
                      key={`references:${model}:${props.reuse?.version ?? 0}`}
                      value={references}
                      disabled={busy || !props.options.available}
                      onUploadingChange={setUploading}
                      onChange={(items) => {
                        setReferences(items)
                        form.setValue('reference_id', undefined)
                        form.setValue(
                          'reference_ids',
                          items.map((item) => item.id)
                        )
                      }}
                    />
                  </PopoverContent>
                </Popover>
              )}
              <Field className='w-auto shrink-0'>
                <FieldLabel>{t('Image size')}</FieldLabel>
                <Popover open={sizeOpen} onOpenChange={setSizeOpen}>
                  <PopoverTrigger
                    render={
                      <Button
                        type='button'
                        variant='outline'
                        className='justify-start tabular-nums'
                        disabled={busy}
                        aria-label={t('Choose image size')}
                        aria-invalid={!!form.formState.errors.size}
                      />
                    }
                  >
                    <Scan className='size-4' />
                    {size.replace('x', '×') || t('Auto')}
                  </PopoverTrigger>
                  <PopoverContent
                    keepMounted
                    align='start'
                    aria-label={t('Image size')}
                    className='w-max max-w-[calc(100vw-2rem)]'
                  >
                    <ImageSizePicker
                      key={`size:${model}:${props.reuse?.version ?? 0}`}
                      sizes={capability?.sizes ?? ['']}
                      customSize={!!capability?.custom_size}
                      value={size}
                      ratioSize={ratioSize}
                      error={form.formState.errors.size?.message}
                      disabled={busy}
                      onChange={(value) => {
                        form.setValue('size', value, {
                          shouldValidate: true,
                        })
                        if (value) setRatioSize('')
                      }}
                      onRatioChange={(value) => {
                        setRatioSize(value)
                        form.setValue('size', '', {
                          shouldValidate: true,
                        })
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </Field>
              <Field className='w-auto min-w-20 shrink-0'>
                <FieldLabel>{t('Aspect ratio')}</FieldLabel>
                <Popover>
                  <PopoverTrigger
                    render={
                      <Button
                        type='button'
                        variant='outline'
                        className='justify-start tabular-nums'
                        disabled={busy}
                        aria-label={t('Aspect ratio')}
                      />
                    }
                  >
                    <RatioIcon className='size-4 shrink-0' aria-hidden='true' />
                    {ratioSize ? formatAspectRatio(ratioSize) : t('Free ratio')}
                  </PopoverTrigger>
                  <PopoverContent
                    keepMounted
                    align='start'
                    aria-label={t('Aspect ratio')}
                    className='w-[360px] max-w-[calc(100vw-2rem)]'
                  >
                    <ImageSizePicker
                      mode='ratio'
                      sizes={capability?.sizes ?? ['']}
                      customSize={!!capability?.custom_size}
                      value={size}
                      ratioSize={ratioSize}
                      disabled={busy}
                      onChange={() => {}}
                      onRatioChange={(value) => {
                        setRatioSize(value)
                        form.setValue('size', '', {
                          shouldValidate: true,
                        })
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </Field>
              <Field className='w-auto min-w-20 shrink-0'>
                <FieldLabel>{t('Quality')}</FieldLabel>
                <Popover open={qualityOpen} onOpenChange={setQualityOpen}>
                  <PopoverTrigger
                    render={
                      <Button
                        type='button'
                        variant='outline'
                        disabled={busy}
                        className='justify-start'
                        aria-label={t('Choose image quality')}
                      />
                    }
                  >
                    <SlidersHorizontal className='size-4' />
                    <span className='truncate'>
                      {qualityLabels[quality] || t('Auto')}
                    </span>
                  </PopoverTrigger>
                  <PopoverContent
                    align='start'
                    aria-label={t('Quality')}
                    className='w-auto max-w-[calc(100vw-2rem)]'
                  >
                    <FieldTitle>{t('Quality')}</FieldTitle>
                    <ToggleGroup
                      aria-label={t('Quality')}
                      variant='outline'
                      spacing={2}
                      value={[quality || 'auto']}
                      disabled={busy}
                      className='flex-wrap justify-start'
                      onValueChange={(values) => {
                        const value = values[0] === 'auto' ? '' : values[0]
                        if (
                          value !== undefined &&
                          (capability?.qualities ?? ['']).includes(value)
                        ) {
                          form.setValue('quality', value)
                          setQualityOpen(false)
                        }
                      }}
                    >
                      {(capability?.qualities ?? ['']).map((quality) => (
                        <ToggleGroupItem
                          key={quality}
                          value={quality || 'auto'}
                          className='aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground h-[30px] px-2.5'
                        >
                          {qualityLabels[quality] || t('Auto')}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </PopoverContent>
                </Popover>
              </Field>
              <Field className='w-auto min-w-16 shrink-0'>
                <FieldLabel>{t('Number of images')}</FieldLabel>
                <Popover open={countOpen} onOpenChange={setCountOpen}>
                  <PopoverTrigger
                    render={
                      <Button
                        type='button'
                        variant='outline'
                        className='tabular-nums'
                        disabled={busy}
                        aria-label={t('Choose number of images')}
                      />
                    }
                  >
                    <Images className='size-4 shrink-0' />
                    <span className='inline-block w-[2ch] shrink-0 text-center font-mono tabular-nums'>
                      ×{formatNumber(count, locale)}
                    </span>
                  </PopoverTrigger>
                  <PopoverContent
                    align='start'
                    aria-label={t('Number of images')}
                    className='w-auto max-w-[calc(100vw-2rem)]'
                  >
                    <FieldTitle>{t('Number of images')}</FieldTitle>
                    <ToggleGroup
                      aria-label={t('Number of images')}
                      variant='outline'
                      spacing={2}
                      value={[String(count)]}
                      disabled={busy}
                      onValueChange={(values) => {
                        const value = Number(values[0])
                        if (
                          Number.isInteger(value) &&
                          value >= 1 &&
                          value <= (capability?.max_count ?? 1)
                        ) {
                          form.setValue('n', value)
                          setCountOpen(false)
                        }
                      }}
                    >
                      {Array.from(
                        { length: capability?.max_count ?? 1 },
                        (_, i) => (
                          <ToggleGroupItem
                            key={i + 1}
                            value={String(i + 1)}
                            className='aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground h-[30px] w-10 p-0'
                          >
                            {formatNumber(i + 1, locale)}
                          </ToggleGroupItem>
                        )
                      )}
                    </ToggleGroup>
                  </PopoverContent>
                </Popover>
              </Field>
              <div className='flex flex-1 items-end gap-4'>
                <ImageCostEstimate
                  input={{ model, size: size || ratioSize, quality, n: count }}
                />
                <Button
                  type='submit'
                  className='shrink-0'
                  disabled={busy || !props.options.available || !capability}
                >
                  {busy ? <Spinner /> : <Sparkles className='size-4' />}
                  {t('Generate image')}
                </Button>
              </div>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
