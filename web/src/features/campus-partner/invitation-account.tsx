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
import { TruncatedCell } from '@/components/data-table'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { getUserAvatarStyle } from '@/lib/avatar'

export function InvitationAccount(props: {
  id: number
  username: string
  displayName: string
}) {
  const name = props.username || props.displayName || `#${props.id}`
  return (
    <div className='flex min-w-0 items-center gap-2'>
      <Avatar aria-hidden='true'>
        <AvatarFallback style={getUserAvatarStyle(String(props.id))}>
          {[...name][0]}
        </AvatarFallback>
      </Avatar>
      <div className='min-w-0 space-y-0.5'>
        <div className='flex items-baseline gap-1.5'>
          <TruncatedCell className='max-w-48 font-medium'>{name}</TruncatedCell>
          <span className='text-muted-foreground shrink-0 text-xs'>
            #{props.id}
          </span>
        </div>
        {props.displayName && props.displayName !== name && (
          <TruncatedCell className='text-muted-foreground max-w-56 text-xs'>
            {props.displayName}
          </TruncatedCell>
        )}
      </div>
    </div>
  )
}
