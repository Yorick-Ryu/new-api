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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

import { resetPlanSubscriptions } from '../../api'
import { formatQuotaWindowPeriod, parseQuotaWindows } from '../../lib'
import { useSubscriptions } from '../subscriptions-provider'

export function ResetSubscriptionsDialog() {
  const { t } = useTranslation()
  const { open, setOpen, currentRow, triggerRefresh } = useSubscriptions()
  const [advanceResetTime, setAdvanceResetTime] = useState(true)
  const [resetWindow, setResetWindow] = useState('primary')
  const [resetting, setResetting] = useState(false)
  const isOpen = open === 'reset-subscriptions'
  const plan = currentRow?.plan
  const planLabel = plan?.title || (plan?.id ? `#${plan.id}` : '-')
  const quotaWindows = plan ? parseQuotaWindows(plan) : []
  const canAdvanceResetTime = resetWindow === 'primary' || resetWindow === 'all'

  useEffect(() => {
    if (isOpen) {
      setAdvanceResetTime(true)
      setResetWindow('primary')
    }
  }, [isOpen])

  const handleConfirm = async () => {
    if (!plan?.id) return
    setResetting(true)
    try {
      const res = await resetPlanSubscriptions(plan.id, {
        advance_reset_time: canAdvanceResetTime && advanceResetTime,
        reset_window: resetWindow,
      })
      if (res.success) {
        toast.success(
          t('Reset {{count}} active subscriptions', {
            count: res.data?.reset_count || 0,
          })
        )
        triggerRefresh()
        setOpen(null)
      }
    } catch {
      toast.error(t('Operation failed'))
    } finally {
      setResetting(false)
    }
  }

  return (
    <ConfirmDialog
      open={isOpen}
      onOpenChange={(nextOpen) => !nextOpen && setOpen(null)}
      title={t('Reset subscription quota')}
      desc={t('Reset all active subscriptions under {{plan}}?', {
        plan: planLabel,
      })}
      confirmText={t('Reset quota')}
      handleConfirm={handleConfirm}
      disabled={!plan?.id}
      isLoading={resetting}
    >
      <div className='space-y-3'>
        <div className='space-y-1.5'>
          <label className='text-sm font-medium'>{t('Quota window')}</label>
          <Select
            value={resetWindow}
            onValueChange={(value) => value !== null && setResetWindow(value)}
            items={[
              { value: 'primary', label: t('Main quota') },
              ...(quotaWindows.length > 0
                ? [{ value: 'all', label: t('All quota windows') }]
                : []),
              ...quotaWindows.map((window) => ({
                value: window.key,
                label: `${window.name} · ${formatQuotaWindowPeriod(window, t)}`,
              })),
            ]}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectGroup>
                <SelectItem value='primary'>{t('Main quota')}</SelectItem>
                {quotaWindows.length > 0 && (
                  <SelectItem value='all'>{t('All quota windows')}</SelectItem>
                )}
                {quotaWindows.map((window) => (
                  <SelectItem key={window.key} value={window.key}>
                    {window.name} · {formatQuotaWindowPeriod(window, t)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <label className='flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm'>
          <span>{t('Advance next reset time')}</span>
          <Switch
            checked={canAdvanceResetTime && advanceResetTime}
            disabled={!canAdvanceResetTime}
            onCheckedChange={(checked) => setAdvanceResetTime(!!checked)}
            aria-label={t('Advance next reset time')}
          />
        </label>
      </div>
    </ConfirmDialog>
  )
}
