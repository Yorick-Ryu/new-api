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
import { ArrowUpRight, Gift, GraduationCap } from 'lucide-react'
import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { IconBadge } from '@/components/ui/icon-badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TitledCard } from '@/components/ui/titled-card'

import type { Overview } from './api'
import { campusCardTypography } from './constants'
import { InvitationField } from './forms'

export function PartnerInvitation(props: {
  data: Overview
  pending: boolean
  onJoin: () => void
}): ReactElement {
  const { t } = useTranslation()
  const [bindOpen, setBindOpen] = useState(false)
  const link = `https://beiapi.cn/i/${props.data.member.code}`
  let bindingUnavailable = ''
  if (!props.data.can_bind) {
    if (props.data.member.inviter_id > 0) {
      bindingUnavailable = t('An invitation is already bound to your account.')
    } else if (!props.data.enabled) {
      bindingUnavailable = t('Campaign disabled')
    } else {
      bindingUnavailable = t('Invitation binding is currently unavailable.')
    }
  }
  const steps = [
    t('Share your link or invitation code'),
    t('Friends bind and receive a 5% off coupon'),
    t('Earn commission on each qualifying payment'),
  ]
  return (
    <>
      <Alert>
        <Gift />
        <AlertTitle>{t('No invitation bound yet?')}</AlertTitle>
        <AlertDescription id='campus-binding-description'>
          {bindingUnavailable ||
            t(
              'Binding cannot be changed. Only qualifying payments after binding earn commission. You cannot invite yourself or invite each other.'
            )}
        </AlertDescription>
        <AlertAction>
          <Button
            size='sm'
            disabled={!props.data.can_bind}
            aria-describedby='campus-binding-description'
            onClick={() => setBindOpen(true)}
          >
            {t('Add invitation code')}
          </Button>
        </AlertAction>
      </Alert>
      <div className='grid min-w-0 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'>
        <TitledCard
          className='min-w-0'
          title={
            <h2 id='campus-intro-title'>
              {t(
                'Invite friends to register and earn commission on every top-up.'
              )}
            </h2>
          }
          description={t(
            'Friends can register through your exclusive link or enter your invitation code during registration to bind with you. Earn commission on each qualifying top-up or subscription payment under the current rules.'
          )}
          titleClassName={campusCardTypography.title}
          descriptionClassName={campusCardTypography.body}
          icon={<GraduationCap />}
          iconTone='primary'
          contentClassName='space-y-5'
        >
          {props.data.member.joined_at > 0 ? (
            <div className='grid min-w-0 gap-3 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:gap-x-6'>
              <div className='space-y-2 md:col-span-2'>
                <Label htmlFor='campus-invitation-link'>
                  {t('Invitation link')}
                </Label>
                <div className='flex w-full min-w-0 flex-wrap gap-2 sm:flex-nowrap'>
                  <Input
                    id='campus-invitation-link'
                    value={link}
                    readOnly
                    className='min-w-0 flex-1 basis-full font-mono text-xs sm:basis-auto'
                  />
                  <CopyButton
                    value={link}
                    variant='default'
                    size='default'
                    tooltip={t('Copy invitation link')}
                  >
                    {t('Copy invitation link')}
                  </CopyButton>
                </div>
              </div>
              <div className='border-primary/40 bg-primary/5 flex min-w-0 items-center justify-between gap-3 rounded-lg border border-dashed p-3'>
                <div className='min-w-0 space-y-1'>
                  <p className={campusCardTypography.caption}>
                    {t('Exclusive campus partner invitation code')}
                  </p>
                  <code className='text-primary font-mono text-2xl font-bold tracking-widest break-all'>
                    {props.data.member.code}
                  </code>
                </div>
                <CopyButton
                  value={props.data.member.code}
                  variant='outline'
                  size='sm'
                >
                  {t('Copy')}
                </CopyButton>
              </div>
              <ol className='space-y-3 md:col-start-2 md:row-start-2 md:self-center'>
                {steps.map((step, index) => (
                  <li
                    key={step}
                    className={`text-muted-foreground flex items-center gap-2 ${campusCardTypography.body}`}
                  >
                    <IconBadge
                      size='xs'
                      tone='primary'
                      className='font-mono text-[10px] font-semibold'
                    >
                      {index + 1}
                    </IconBadge>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <Button
              disabled={!props.data.enabled || props.pending}
              onClick={props.onJoin}
            >
              {t('Get my invitation code')}
              <ArrowUpRight />
            </Button>
          )}
        </TitledCard>
        <TitledCard
          title={<h3>{t('Exclusive friend benefits')}</h3>}
          titleClassName={campusCardTypography.title}
          icon={<Gift />}
          iconTone='primary'
          className='bg-primary/5 ring-primary/20 min-w-0'
          headerClassName='border-primary/10'
          contentClassName='space-y-4'
        >
          <div className='bg-card ring-primary/20 flex min-w-0 overflow-hidden rounded-xl ring-1'>
            <div className='bg-primary text-primary-foreground border-primary-foreground/40 flex w-24 shrink-0 flex-col items-center justify-center border-r-2 border-dashed px-2 py-4 sm:w-32'>
              <span className='font-mono text-4xl leading-none font-bold tracking-wider tabular-nums sm:text-5xl'>
                {t('Coupon discount value')}
              </span>
              <span className='mt-1 text-sm font-semibold'>
                {t('Coupon discount unit')}
              </span>
            </div>
            <div className='min-w-0 space-y-1.5 p-3 sm:p-4'>
              <p className={campusCardTypography.subtitle}>
                {t('New user top-up coupon')}
              </p>
              <p className={campusCardTypography.body}>
                {t(
                  "Sign up with your invitation link or code and it is issued to your friend's account automatically"
                )}
              </p>
            </div>
          </div>
          <p className='text-primary text-sm leading-6'>
            {t(
              'Your friends save and you earn commission. Share your invitation code so friends can bind and receive one single-use 5% off top-up coupon.'
            )}
          </p>
        </TitledCard>
      </div>
      {props.data.can_bind && (
        <Dialog
          open={bindOpen}
          onOpenChange={setBindOpen}
          title={t('Add invitation code')}
          description={t(
            'Binding cannot be changed. Only qualifying payments after binding earn commission. You cannot invite yourself or invite each other.'
          )}
        >
          <InvitationField />
        </Dialog>
      )}
    </>
  )
}
