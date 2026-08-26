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
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { getSelf } from '@/lib/api'
import { formatQuota } from '@/lib/format'
import { type AuthUser, useAuthStore } from '@/stores/auth-store'

import { getRedemptionConfig, redeemCode } from './api'
import { RedeemCodeCard } from './components/redeem-code-card'

export function RedeemCode() {
  const { t } = useTranslation()
  const setUser = useAuthStore((state) => state.auth.setUser)
  const configQuery = useQuery({
    queryKey: ['redeem-code', 'config'],
    queryFn: getRedemptionConfig,
  })
  const redemptionMutation = useMutation({ mutationFn: redeemCode })

  const handleRedeem = async (code: string): Promise<boolean> => {
    try {
      const response = await redemptionMutation.mutateAsync(code)
      if (!response.success || typeof response.data !== 'number') {
        toast.error(response.message || t('Redemption failed'))
        return false
      }

      toast.success(
        t('Redemption successful! Added: {{quota}}', {
          quota: formatQuota(response.data),
        })
      )

      const selfResponse = await getSelf()
      if (selfResponse.success && selfResponse.data) {
        setUser(selfResponse.data as AuthUser)
      }
      return true
    } catch {
      toast.error(t('Redemption failed'))
      return false
    }
  }

  const config = configQuery.data?.data

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Redeem Code')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='mx-auto w-full max-w-2xl'>
          <RedeemCodeCard
            enabled={config?.enable_redemption !== false}
            loading={configQuery.isLoading}
            redeeming={redemptionMutation.isPending}
            topupLink={config?.topup_link}
            onRedeem={handleRedeem}
          />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
