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

import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { submitPaymentForm } from '@/features/wallet/lib'

import { useCampus, campusSite, campusPost, useCampusAction } from './api'

// Rendered inside Add Funds above the payment methods, only while the user
// holds a coupon that can still be applied or whose order is still pending.
export function CampusCouponSection(props: {
  selected: boolean
  onChange: (value: boolean) => void
}) {
  const { t } = useTranslation()
  const overview = useCampus()
  const resume = useCampusAction(() =>
    campusPost<{ url: string; params: Record<string, unknown> }>(
      'self/coupon/resume'
    ).then((data) => submitPaymentForm(data.url, data.params))
  )
  if (!campusSite() || !overview.data) return null
  const coupon = overview.data.member.coupon_state
  if (coupon !== 'available' && coupon !== 'reserved') return null
  return (
    <div className='space-y-2.5 sm:space-y-3'>
      <Label className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
        {t('My coupon')}
      </Label>
      <div className='space-y-2 rounded-lg border p-3'>
        <div className='flex flex-wrap items-center gap-3'>
          <Switch
            id='campus-coupon'
            checked={props.selected && coupon === 'available'}
            onCheckedChange={props.onChange}
            disabled={coupon !== 'available'}
          />
          <Label htmlFor='campus-coupon'>
            {t('Use my campus top-up coupon')}
          </Label>
          <span className='text-muted-foreground text-xs'>
            {t(`Campus coupon ${coupon}`)}
          </span>
        </div>
        <p className='text-muted-foreground text-xs'>
          {t(
            '5% off one top-up. No expiry, personal use only, not valid for subscriptions. Refunds do not restore a used coupon.'
          )}
        </p>
        {coupon === 'reserved' && (
          <div className='space-y-2'>
            <p className='text-muted-foreground text-xs'>
              {t(
                'Payment status is still pending. Continue the original order, or contact support to reconcile a definitively closed unpaid order.'
              )}
            </p>
            <div className='flex flex-wrap items-center gap-2'>
              <code className='text-xs break-all'>
                {overview.data.member.coupon_trade}
              </code>
              <CopyButton value={overview.data.member.coupon_trade} />
              <Button
                size='sm'
                disabled={resume.isPending}
                onClick={() => resume.mutate()}
              >
                {t('Continue original payment')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
