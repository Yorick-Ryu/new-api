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
import { useNavigate } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'

import { PublicLayout } from '@/components/layout'
import { Footer } from '@/components/layout/components/footer'
import { useStatus } from '@/hooks/use-status'
import { getModuleAccessFromStatus } from '@/lib/nav-modules'
import { useAuthStore } from '@/stores/auth-store'

import { PublicCatalog } from './presentation'

import './plans.css'

export { PublicCatalog } from './presentation'

const Wallet = lazy(() =>
  import('@/features/wallet').then((module) => ({ default: module.Wallet }))
)

export function Plans() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.auth.user)
  const { status } = useStatus()
  const access = getModuleAccessFromStatus(status, 'plans')
  if (!access.enabled || (access.requireAuth && !user)) return null
  const signIn = () => {
    void navigate({ to: '/sign-in', search: { redirect: '/plans' } })
  }
  const guestPage = <PublicCatalog onCredit={signIn} onMonthly={signIn} />
  return (
    <PublicLayout showMainContainer={false}>
      <div className='beiapi-plans'>
        {user ? (
          <Suspense
            fallback={
              <PublicCatalog loading onCredit={signIn} onMonthly={signIn} />
            }
          >
            <Wallet
              renderPlans={(actions) => (
                <PublicCatalog
                  loading={actions.loading}
                  onCredit={(amount) => void actions.purchaseTopup(amount)}
                  onMonthly={actions.purchaseSubscription}
                />
              )}
            />
          </Suspense>
        ) : (
          guestPage
        )}
      </div>
      <Footer
        compact
        attributionVariant='based-on'
        description={t('AI tools and access services · For researchers')}
      />
    </PublicLayout>
  )
}
