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
import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getPricing } from '@/features/pricing/api'
import { useBillingTime } from '@/features/pricing/hooks/use-billing-time'
import { toIntlLocale } from '@/i18n/languages'
import { formatBillingCurrencyFromUSD } from '@/lib/currency'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import type { ImageInput } from '../api'
import { estimateImageCost } from '../lib/cost-estimate'

type ImageCostEstimateProps = {
  input: Pick<ImageInput, 'model' | 'size' | 'quality' | 'n'>
}

export function ImageCostEstimate(props: ImageCostEstimateProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const userID = useAuthStore((state) => state.auth.user?.id)
  // Currency formatters read this store; subscribe so display changes are immediate.
  useSystemConfigStore((state) => state.config.currency)
  const pricing = useQuery({
    queryKey: ['image-studio-pricing', userID],
    queryFn: async () => {
      const data = await getPricing()
      if (useAuthStore.getState().auth.user?.id !== userID) {
        throw new DOMException('Account changed', 'AbortError')
      }
      requireServerSuccess(data)
      return data
    },
    enabled: !!userID && !!props.input.model,
    staleTime: 60000,
    refetchInterval: 60000,
    retry: false,
    meta: { errorToast: false },
  })
  const model = pricing.data?.data?.find(
    (item) => item.model_name === props.input.model
  )
  // Keep time-dependent fixed expressions current without a separate timer.
  useBillingTime(model?.billing_expr)
  const estimate =
    pricing.data && !pricing.isError
      ? estimateImageCost(props.input, pricing.data)
      : null
  let value = t('Estimate unavailable')
  if (pricing.isLoading) value = t('Estimating…')
  else if (estimate) {
    const formatOptions = { digitsSmall: 6, abbreviate: false, locale }
    const minimum = formatBillingCurrencyFromUSD(estimate.minUSD, formatOptions)
    const maximum = formatBillingCurrencyFromUSD(estimate.maxUSD, formatOptions)
    if (estimate.minUSD !== estimate.maxUSD) {
      value = `${minimum} – ${maximum}`
    } else {
      value = estimate.scope === 'request' ? minimum : `≈ ${minimum}`
    }
  }

  return (
    <Field className='w-40 max-w-full min-w-0 shrink-0 sm:w-44'>
      <div className='flex h-5 items-center gap-1'>
        <FieldLabel>{t('Estimated image cost')}</FieldLabel>
        {estimate?.scope === 'output' && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type='button'
                  variant='ghost'
                  size='icon-xs'
                  aria-label={t('Cost estimate details')}
                />
              }
            >
              <Info className='size-3.5' />
            </TooltipTrigger>
            <TooltipContent className='block max-w-72 space-y-2'>
              <p>
                {t(
                  'Excludes prompt and reference-image input costs. Final cost depends on actual usage.'
                )}
              </p>
              {estimate.automatic && estimate.minUSD !== estimate.maxUSD && (
                <p>
                  {t(
                    'Automatic size or quality is shown as a range across supported settings.'
                  )}
                </p>
              )}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className='flex h-8 min-w-0 items-center'>
        <span
          role='status'
          aria-label={t('Estimated image cost')}
          title={value}
          className='truncate font-mono text-sm font-medium tabular-nums'
        >
          {value}
        </span>
      </div>
    </Field>
  )
}
