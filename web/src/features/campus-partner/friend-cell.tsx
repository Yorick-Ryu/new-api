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
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'

export function CampusFriend(props: {
  userId: number
  name?: string
  admin?: boolean
}) {
  const name = props.name || '***'
  return (
    <div className='flex min-w-0 items-center gap-1.5'>
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
      <div className='min-w-0'>
        <TruncatedCell className='text-muted-foreground max-w-40 text-sm'>
          {name}
        </TruncatedCell>
        {props.admin && (
          <p className='text-muted-foreground text-xs'>#{props.userId}</p>
        )}
      </div>
    </div>
  )
}
