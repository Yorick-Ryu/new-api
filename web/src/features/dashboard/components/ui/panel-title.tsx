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

export function PanelTitle(props: {
  title: string
  icon: LucideIcon
  iconTone: IconBadgeTone
  as?: 'h2' | 'h3'
}) {
  const Heading = props.as ?? 'h3'
  const Icon = props.icon

  return (
    <Heading className='flex min-w-0 items-center gap-2 text-sm font-semibold'>
      <IconBadge tone={props.iconTone} size='sm'>
        <Icon />
      </IconBadge>
      <span className='min-w-0 break-words'>{props.title}</span>
    </Heading>
  )
}
