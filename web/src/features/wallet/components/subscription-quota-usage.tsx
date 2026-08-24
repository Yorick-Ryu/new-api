/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or (at your
option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useTranslation } from 'react-i18next'

import { Progress } from '@/components/ui/progress'
import { formatQuota } from '@/lib/format'

interface SubscriptionQuotaUsageProps {
  label: string
  amountUsed: number
  amountTotal: number
  nextResetTime?: number
  isActive: boolean
}

export function SubscriptionQuotaUsage(props: SubscriptionQuotaUsageProps) {
  const { t } = useTranslation()
  const usagePercent =
    props.amountTotal > 0
      ? Math.min(
          100,
          Math.max(0, Math.round((props.amountUsed / props.amountTotal) * 100))
        )
      : 0

  return (
    <div data-slot='subscription-quota-usage' className='mt-2'>
      <div className='flex flex-wrap items-center justify-between gap-1'>
        <span className='font-medium'>{props.label}</span>
        <span className='text-muted-foreground'>
          {props.amountTotal > 0
            ? `${formatQuota(props.amountUsed)}/${formatQuota(props.amountTotal)} · ${usagePercent}%`
            : t('Unlimited')}
        </span>
      </div>
      {props.isActive && Number(props.nextResetTime) > 0 && (
        <div className='text-muted-foreground mt-1'>
          {t('Next reset')}:{' '}
          {new Date(Number(props.nextResetTime) * 1000).toLocaleString()}
        </div>
      )}
      {props.isActive && props.amountTotal > 0 && (
        <Progress value={usagePercent} className='mt-1.5 h-1.5' />
      )}
    </div>
  )
}
