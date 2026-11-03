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
import { submitPaymentForm } from '@/features/wallet/lib'
import { cn } from '@/lib/utils'

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
      <div
        className={cn(
          'bg-card overflow-hidden rounded-xl ring-1 transition-shadow',
          props.selected && coupon === 'available'
            ? 'ring-primary ring-2'
            : 'ring-primary/20'
        )}
      >
        <Button
          type='button'
          variant='ghost'
          aria-label={t('New user top-up coupon')}
          aria-pressed={props.selected && coupon === 'available'}
          disabled={coupon !== 'available'}
          onClick={() => props.onChange(!props.selected)}
          className='h-auto w-full justify-start gap-0 overflow-hidden rounded-xl p-0 text-left whitespace-normal hover:bg-transparent disabled:opacity-100'
        >
          <div className='flex w-full min-w-0 self-stretch'>
            <div className='bg-primary text-primary-foreground border-primary-foreground/40 flex w-24 shrink-0 flex-col items-center justify-center border-r-2 border-dashed px-2 py-4 sm:w-32'>
              <span className='font-mono text-4xl leading-none font-bold tracking-wider tabular-nums sm:text-5xl'>
                {t('Coupon discount value')}
              </span>
              <span className='mt-1 text-sm font-semibold'>
                {t('Coupon discount unit')}
              </span>
            </div>
            <div className='min-w-0 flex-1 space-y-2 p-3 sm:p-4'>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <span className='text-sm font-semibold'>
                  {t('New user top-up coupon')}
                </span>
                <span className='bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium'>
                  {t('Available: {{quantity}} coupons', {
                    quantity: coupon === 'available' ? '1' : '0',
                  })}
                </span>
              </div>
              {coupon === 'reserved' && (
                <p className='text-muted-foreground text-xs'>
                  {t('Campus coupon reserved')}
                </p>
              )}
              <p className='text-muted-foreground text-xs leading-relaxed font-normal'>
                {t(
                  '5% off one top-up. No expiry, personal use only, not valid for subscriptions. Refunds do not restore a used coupon.'
                )}
              </p>
            </div>
          </div>
        </Button>
        {coupon === 'reserved' && (
          <div className='space-y-2 px-3 pb-3 sm:px-4'>
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
