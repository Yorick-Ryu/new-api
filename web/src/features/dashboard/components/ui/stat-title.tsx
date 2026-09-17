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
import type { LucideIcon } from 'lucide-react'

import { IconBadge, type IconBadgeTone } from '@/components/ui/icon-badge'

export function StatTitle(props: {
  title: string
  icon: LucideIcon
  iconTone: IconBadgeTone
}) {
  const Icon = props.icon
  return (
    <div className='flex min-w-0 items-center gap-1.5 sm:gap-2'>
      <IconBadge
        tone={props.iconTone}
        size='stat'
        className='size-4 rounded-sm sm:size-7 sm:rounded-md [&>svg]:size-2.5 sm:[&>svg]:size-3.5'
      >
        <Icon />
      </IconBadge>
      <span className='text-muted-foreground truncate text-[11px] leading-4 font-medium tracking-wide uppercase sm:text-xs sm:tracking-wider'>
        {props.title}
      </span>
    </div>
  )
}
