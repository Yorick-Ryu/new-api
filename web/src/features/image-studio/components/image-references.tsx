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
import { useMutation } from '@tanstack/react-query'
import { ImagePlus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldTitle,
} from '@/components/ui/field'
import { markServerErrorHandled } from '@/lib/handle-server-error'
import { getServerErrorMessage } from '@/lib/server-error-message'

import { uploadReference } from '../api'

export type ImageReference = {
  id: string
  name: string
  blob?: Blob
  url?: string
}

type ImageReferencesProps = {
  value: ImageReference[]
  disabled: boolean
  onChange: (references: ImageReference[]) => void
  onUploadingChange: (uploading: boolean) => void
}

export function ImageReferences(props: ImageReferencesProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const onUploadingChange = props.onUploadingChange
  const [error, setError] = useState('')
  const upload = useMutation({
    mutationFn: (files: File[]) =>
      Promise.allSettled(
        files.map(async (file) => ({
          id: await uploadReference(file),
          name: file.name,
          blob: file,
        }))
      ),
  })
  useEffect(() => {
    onUploadingChange(upload.isPending)
    return () => onUploadingChange(false)
  }, [upload.isPending, onUploadingChange])
  const busy = props.disabled || upload.isPending

  return (
    <Field data-invalid={!!error} className='gap-2.5'>
      <div className='flex flex-wrap items-center gap-2'>
        <FieldTitle>{t('Reference images (up to 4)')}</FieldTitle>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={busy || props.value.length >= 4}
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus />
          {t('Choose file')}
        </Button>
      </div>
      <input
        ref={inputRef}
        id='image-reference'
        type='file'
        className='sr-only'
        tabIndex={-1}
        aria-label={t('Reference images (up to 4)')}
        multiple
        accept='image/png,image/jpeg,image/webp'
        disabled={busy || props.value.length >= 4}
        aria-invalid={!!error}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          event.target.value = ''
          if (files.length === 0) return
          if (props.value.length + files.length > 4) {
            setError(t('You can add up to 4 reference images.'))
            return
          }
          if (files.some((file) => file.size > 20 * 1024 * 1024)) {
            setError(t('Reference images must be 20 MB or smaller'))
            return
          }
          setError('')
          upload.mutate(files, {
            onSuccess: (results) => {
              const added = results.flatMap((result) =>
                result.status === 'fulfilled' ? [result.value] : []
              )
              props.onChange([...props.value, ...added])
              const failure = results.find(
                (result) => result.status === 'rejected'
              )
              if (failure) {
                setError(
                  t(
                    getServerErrorMessage(
                      failure.reason,
                      t(
                        'Some reference images could not be uploaded. You can retry the failed images.'
                      )
                    )
                  )
                )
                markServerErrorHandled(failure.reason)
              }
            },
          })
        }}
      />
      <FieldDescription className='text-xs'>
        {t('PNG, JPEG, WebP, 20 MB each')}
      </FieldDescription>
      {error && <FieldError>{error}</FieldError>}
      {upload.isPending && (
        <span role='status' className='text-muted-foreground text-xs'>
          {t('Uploading…')}
        </span>
      )}
    </Field>
  )
}

export function ImageReferencePreview(props: {
  reference: ImageReference
  disabled: boolean
  onRemove: () => void
}) {
  const { t } = useTranslation()
  const [url, setURL] = useState(props.reference.url)
  useEffect(() => {
    if (!props.reference.blob) {
      setURL(props.reference.url)
      return
    }
    const objectURL = URL.createObjectURL(props.reference.blob)
    setURL(objectURL)
    return () => URL.revokeObjectURL(objectURL)
  }, [props.reference.blob, props.reference.url])
  return (
    <div className='relative size-14 shrink-0'>
      <Dialog
        title={t('Image Preview')}
        trigger={
          <Button
            type='button'
            variant='outline'
            className='size-14 overflow-hidden p-0'
            aria-label={`${t('Image Preview')}: ${props.reference.name}`}
          >
            {url ? (
              <img
                src={url}
                alt={props.reference.name}
                className='size-full object-cover'
              />
            ) : (
              <ImagePlus aria-hidden='true' />
            )}
          </Button>
        }
      >
        {url && (
          <img
            src={url}
            alt={props.reference.name}
            className='max-h-[65vh] w-full rounded-lg object-contain'
          />
        )}
      </Dialog>
      <Button
        type='button'
        size='icon-xs'
        variant='outline'
        className='bg-background absolute -top-1 -right-1 size-5 rounded-full'
        disabled={props.disabled}
        aria-label={`${t('Remove reference image')}: ${props.reference.name}`}
        onClick={props.onRemove}
      >
        <X className='size-3' aria-hidden='true' />
      </Button>
    </div>
  )
}
