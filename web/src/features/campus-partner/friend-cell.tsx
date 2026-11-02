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
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { getUserAvatarStyle } from '@/lib/avatar'

export function CampusFriend(props: {
  userId: number
  name?: string
  admin?: boolean
}) {
  const name = props.name || '***'
  return (
    <div className='flex items-center gap-3'>
      <Avatar aria-hidden='true'>
        <AvatarFallback style={getUserAvatarStyle(String(props.userId))}>
          {[...name][0]}
        </AvatarFallback>
      </Avatar>
      <div className='min-w-0'>
        <p className='font-medium'>{name}</p>
        {props.admin && (
          <p className='text-muted-foreground text-xs'>#{props.userId}</p>
        )}
      </div>
    </div>
  )
}
