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
import { useTranslation } from 'react-i18next'

interface SubscriptionExpiryProps {
  endTime: number
  isActive: boolean
  isCancelled?: boolean
}

export function SubscriptionExpiry(props: SubscriptionExpiryProps) {
  const { t } = useTranslation()
  const remainingDays = Math.max(
    0,
    Math.ceil((props.endTime - Date.now() / 1000) / 86400)
  )
  let label = t('Expired at')
  if (props.isActive) label = t('Until')
  else if (props.isCancelled) label = t('Cancelled at')

  return (
    <p className='text-muted-foreground ml-auto flex min-w-0 flex-wrap justify-end gap-x-1 text-right text-[11px]'>
      <span className='whitespace-nowrap'>
        {label}{' '}
        <time dateTime={new Date(props.endTime * 1000).toISOString()}>
          {new Date(props.endTime * 1000).toLocaleString()}
        </time>
      </span>
      {props.isActive && (
        <span className='text-foreground whitespace-nowrap'>
          · {t('{{count}} days remaining', { count: remainingDays })}
        </span>
      )}
    </p>
  )
}
