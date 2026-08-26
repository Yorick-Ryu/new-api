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
import { ExternalLink, Loader2, Ticket } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { TitledCard } from '@/components/ui/titled-card'

type RedeemCodeCardProps = {
  enabled: boolean
  loading?: boolean
  redeeming: boolean
  topupLink?: string
  onRedeem: (code: string) => Promise<boolean>
}

export function RedeemCodeCard(props: RedeemCodeCardProps) {
  const { t } = useTranslation()
  const [code, setCode] = useState('')

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalizedCode = code.trim()
    if (!normalizedCode) return

    const success = await props.onRedeem(normalizedCode)
    if (success) setCode('')
  }

  let content: ReactNode
  if (props.loading) {
    content = (
      <div className='space-y-3' data-testid='redeem-code-loading'>
        <Skeleton className='h-4 w-28' />
        <Skeleton className='h-10 w-full' />
        <Skeleton className='h-10 w-full sm:w-28' />
      </div>
    )
  } else if (props.enabled) {
    content = (
      <form className='space-y-4' onSubmit={handleSubmit}>
        <div className='border-border/80 bg-muted/20 space-y-3 rounded-xl border border-dashed p-3 sm:p-4'>
          <Label htmlFor='redeem-code-input'>{t('Redemption Code')}</Label>
          <Input
            id='redeem-code-input'
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder={t('Enter your redemption code')}
            autoComplete='off'
            autoCapitalize='off'
            spellCheck={false}
            className='h-10 font-mono tracking-wide'
          />
        </div>

        <Button
          type='submit'
          disabled={props.redeeming || code.trim() === ''}
          className='w-full sm:w-auto'
        >
          {props.redeeming && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
          {t('Redeem')}
        </Button>

        {props.topupLink && (
          <p className='text-muted-foreground text-sm'>
            {t('Need a redemption code?')}{' '}
            <a
              href={props.topupLink}
              target='_blank'
              rel='noopener noreferrer'
              className='text-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline'
            >
              {t('Get one here')}
              <ExternalLink className='h-3.5 w-3.5' aria-hidden='true' />
            </a>
          </p>
        )}
      </form>
    )
  } else {
    content = (
      <Alert>
        <AlertDescription>
          {t(
            'Redemption codes are disabled until the administrator confirms compliance terms.'
          )}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <TitledCard
      title={t('Redeem Code')}
      description={t('Redeem codes for account credit')}
      icon={<Ticket />}
      iconTone='warning'
      disableHoverEffect
      contentClassName='space-y-4 sm:space-y-5'
    >
      {content}
    </TitledCard>
  )
}
