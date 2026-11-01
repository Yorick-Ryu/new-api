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
import { ArrowUpRight, Gift, Share2 } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { TitledCard } from '@/components/ui/titled-card'

import type { Overview } from './api'
import { InvitationField } from './forms'

export function PartnerInvitation(props: {
  data: Overview
  pending: boolean
  onJoin: () => void
}): ReactElement {
  const { t } = useTranslation()
  const link = `https://beiapi.cn/sign-up?campus=${props.data.member.code}`
  return (
    <>
      {props.data.can_bind && (
        <Collapsible>
          <Card size='sm'>
            <CardContent className='space-y-3'>
              <div className='flex flex-wrap items-center justify-between gap-3'>
                <div className='min-w-0 flex-1 space-y-1'>
                  <h3 className='font-medium'>{t('Bind invitation')}</h3>
                  <p className='text-muted-foreground text-xs'>
                    {t(
                      'Binding cannot be changed. Only available before your first successful payment. You cannot invite yourself.'
                    )}
                  </p>
                </div>
                <CollapsibleTrigger
                  render={<Button variant='outline' size='sm' />}
                >
                  {t('Bind invitation')}
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <InvitationField />
              </CollapsibleContent>
            </CardContent>
          </Card>
        </Collapsible>
      )}
      <div className='grid min-w-0 gap-4 lg:grid-cols-3'>
        <TitledCard
          title={<h3>{t('Invite a friend')}</h3>}
          description={t('Exclusive campus partner invitation code')}
          icon={<Share2 />}
          iconTone='primary'
          className='min-w-0 lg:col-span-2'
          contentClassName='space-y-4'
        >
          <p className='text-muted-foreground text-sm leading-6'>
            {t(
              'Recommend friends and earn commissions on qualifying top-ups and subscriptions under the current rules. Friends receive one personal 5% off top-up coupon.'
            )}
          </p>
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
              <div className='bg-muted/40 flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border p-3'>
                <code className='font-mono text-2xl font-semibold tracking-wider break-all'>
                  {props.data.member.code}
                </code>
                <CopyButton
                  value={props.data.member.code}
                  variant='outline'
                  size='sm'
                >
                  {t('Copy')}
                </CopyButton>
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
        </TitledCard>
        <TitledCard
          title={<h3>{t('Friend benefits')}</h3>}
          icon={<Gift />}
          iconTone='primary'
          className='min-w-0'
          contentClassName='space-y-4'
        >
          <p className='text-primary font-mono text-3xl font-semibold tabular-nums'>
            {t('5% off')}
          </p>
          <p className='text-muted-foreground text-xs leading-5'>
            {t(
              '5% off one top-up. No expiry, personal use only, not valid for subscriptions. Refunds do not restore a used coupon.'
            )}
          </p>
          <Separator />
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
        </TitledCard>
      </div>
    </>
  )
}
