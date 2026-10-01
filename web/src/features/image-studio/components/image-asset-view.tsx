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
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { getImageURL, type ImageAsset } from '../api'

export function ImageAssetView(props: { asset: ImageAsset; cover?: boolean }) {
  const { t } = useTranslation()
  const userID = useAuthStore((state) => state.auth.user?.id)
  const [failed, setFailed] = useState(false)
  const image = useQuery({
    queryKey: ['image-studio-asset', userID, props.asset.id],
    queryFn: () => getImageURL(props.asset.id),
    initialData: props.asset.url || undefined,
    staleTime: 5 * 60 * 1000,
    retry: false,
    enabled: !props.asset.unavailable,
    meta: { errorToast: false, errorRedirect: false },
  })
  if (props.asset.unavailable || failed || image.isError) {
    return (
      <span className='text-muted-foreground flex aspect-square w-full items-center justify-center p-4 text-sm whitespace-normal'>
        {t('Image unavailable')}
      </span>
    )
  }
  if (!image.data) {
    return (
      <Skeleton className='aspect-square w-full motion-reduce:animate-none' />
    )
  }
  return (
    <img
      src={image.data}
      alt={t('Generated image')}
      loading='lazy'
      className={cn(
        'bg-muted w-full',
        props.cover
          ? 'aspect-square object-cover'
          : 'max-h-[55vh] rounded-lg object-contain'
      )}
      onError={() => setFailed(true)}
    />
  )
}
