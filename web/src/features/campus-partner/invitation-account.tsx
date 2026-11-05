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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { UserInfoDialog } from '@/features/usage-logs/components/dialogs/user-info-dialog'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'

export function InvitationAccount(props: {
  id: number
  username: string
  displayName: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const name = props.username || props.displayName || `#${props.id}`
  return (
    <>
      <Button
        type='button'
        variant='ghost'
        className='h-auto max-w-full min-w-0 justify-start gap-1.5 p-0 text-left hover:bg-transparent'
        aria-label={`${t('User Information')}: ${name}`}
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
      >
        <Avatar
          aria-hidden='true'
          className='ring-border/60 size-6 shrink-0 ring-1'
        >
          <AvatarFallback
            className='text-[11px] font-semibold'
            style={getUserAvatarStyle(name)}
          >
            {getUserAvatarFallback(name)}
          </AvatarFallback>
        </Avatar>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className='text-muted-foreground max-w-40 min-w-0 truncate text-sm hover:underline' />
            }
          >
            {name}
          </TooltipTrigger>
          <TooltipContent>
            {props.displayName || name} · #{props.id}
          </TooltipContent>
        </Tooltip>
      </Button>
      {open && <UserInfoDialog userId={props.id} open onOpenChange={setOpen} />}
    </>
  )
}
