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
import { ArrowRight02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

interface HeroButtonsProps {
  isAuthenticated: boolean
}

/**
 * Hero section action buttons
 */
export function HeroButtons({ isAuthenticated }: HeroButtonsProps) {
  const { t } = useTranslation()
  if (isAuthenticated) {
    return (
      <Button size='lg' render={<Link to='/dashboard' />}>
        {t('Go to Dashboard')}{' '}
        <HugeiconsIcon
          icon={ArrowRight02Icon}
          className='ml-2 h-5 w-5'
          aria-hidden='true'
        />
      </Button>
    )
  }

  return (
    <>
      <Button size='lg' render={<Link to='/sign-up' />}>
        {t('Get Started')}
        <HugeiconsIcon
          icon={ArrowRight02Icon}
          className='ml-2 h-5 w-5'
          aria-hidden='true'
        />
      </Button>
      <Button size='lg' variant='outline' render={<Link to='/sign-in' />}>
        {t('Sign In')}
      </Button>
    </>
  )
}
