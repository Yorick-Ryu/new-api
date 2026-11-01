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
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Gift, TicketPercent } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { IconBadge } from '@/components/ui/icon-badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TitledCard } from '@/components/ui/titled-card'

import type { Overview } from './api'
import { InvitationField } from './forms'

export function PartnerInvitation(props: {
  data: Overview
  maximumRate: string
  pending: boolean
  onJoin: () => void
}): ReactElement {
  const { t } = useTranslation()
  const link = `https://beiapi.cn/sign-up?campus=${props.data.member.code}`
  const steps = [
    t('Share your link or invitation code'),
    t('Friends bind and receive a 5% off coupon'),
    t('Earn commission on each qualifying payment'),
  ]
  return (
    <>
      {props.data.can_bind && (
        <Collapsible>
          <Alert>
            <Gift />
            <AlertTitle>{t('No invitation bound yet?')}</AlertTitle>
            <AlertDescription>
              {t(
                'Binding cannot be changed. Only available before your first successful payment. You cannot invite yourself.'
              )}
            </AlertDescription>
            <AlertAction>
              <CollapsibleTrigger render={<Button size='sm' />}>
                {t('Bind invitation')}
              </CollapsibleTrigger>
            </AlertAction>
          </Alert>
          <CollapsibleContent className='pt-3'>
            <InvitationField />
          </CollapsibleContent>
        </Collapsible>
      )}
      <div className='grid min-w-0 gap-4 lg:grid-cols-3'>
        <Card className='min-w-0 lg:col-span-2'>
          <CardContent className='space-y-5 p-3 sm:p-5'>
            <section
              aria-labelledby='campus-intro-title'
              className='grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start'
            >
              <div className='min-w-0 space-y-2'>
                <h2
                  id='campus-intro-title'
                  className='text-lg font-semibold tracking-tight sm:text-xl'
                >
                  {t('Your recommendations deserve a reward.')}
                </h2>
                <p className='text-muted-foreground text-sm leading-6'>
                  {t(
                    'Recommend friends and earn commissions on qualifying top-ups and subscriptions under the current rules. Friends receive one personal 5% off top-up coupon.'
                  )}
                </p>
              </div>
              <div className='sm:text-right'>
                <p className='text-muted-foreground text-xs'>
                  {t('Top-up commission up to')}
                </p>
                <p className='text-primary font-mono text-3xl font-semibold tabular-nums'>
                  {props.maximumRate}
                  <span className='text-lg'>%</span>
                </p>
              </div>
            </section>
            {props.data.member.joined_at > 0 ? (
              <>
                <div className='space-y-2'>
                  <Label htmlFor='campus-invitation-link'>
                    {t('Invitation link')}
                  </Label>
                  <div className='flex min-w-0 flex-wrap gap-2 sm:flex-nowrap'>
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
                <div className='grid min-w-0 gap-4 sm:grid-cols-2 sm:items-center'>
                  <div className='border-primary/40 bg-primary/5 flex min-w-0 items-center justify-between gap-3 rounded-lg border border-dashed p-3'>
                    <div className='min-w-0 space-y-1'>
                      <p className='text-muted-foreground text-xs'>
                        {t('Exclusive campus partner invitation code')}
                      </p>
                      <code className='text-primary font-mono text-2xl font-semibold tracking-widest break-all'>
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
                  <ol className='space-y-2'>
                    {steps.map((step, index) => (
                      <li
                        key={step}
                        className='text-muted-foreground flex items-center gap-2 text-xs'
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
              </>
            ) : (
              <Button
                disabled={!props.data.enabled || props.pending}
                onClick={props.onJoin}
              >
                {t('Get my invitation code')}
                <ArrowUpRight />
              </Button>
            )}
          </CardContent>
        </Card>
        <TitledCard
          title={<h3>{t('Friend benefits')}</h3>}
          icon={<Gift />}
          iconTone='primary'
          className='bg-primary/5 ring-primary/20 min-w-0'
          headerClassName='border-primary/10'
          contentClassName='space-y-4'
        >
          <div className='bg-card flex min-w-0 items-center gap-3 rounded-lg border p-3'>
            <IconBadge tone='primary' size='lg'>
              <TicketPercent />
            </IconBadge>
            <div className='min-w-0'>
              <p className='text-primary font-mono text-2xl font-semibold tabular-nums'>
                {t('5% off')}
              </p>
              <p className='text-muted-foreground text-xs leading-5'>
                {t(
                  '5% off one top-up. No expiry, personal use only, not valid for subscriptions. Refunds do not restore a used coupon.'
                )}
              </p>
            </div>
          </div>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <div className='flex flex-wrap items-center gap-2'>
              <span className='text-sm font-medium'>{t('My coupon')}</span>
              <Badge variant='secondary'>
                {props.data.member.coupon_state
                  ? t(`Campus coupon ${props.data.member.coupon_state}`)
                  : t('No campus coupon yet')}
              </Badge>
            </div>
            <Button
              variant='outline'
              size='sm'
              role='link'
              render={<Link to='/wallet' />}
            >
              {t('Go to wallet')}
              <ArrowUpRight />
            </Button>
          </div>
        </TitledCard>
      </div>
    </>
  )
}
