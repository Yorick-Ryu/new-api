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
import { useMutation } from '@tanstack/react-query'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'

import { campusPost, campusSite, useCampusAction } from './api'

export function CampusReminder() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const reminder = useMutation({
    mutationFn: () => campusPost<{ show: boolean }>('self/reminder'),
    onSuccess: (data) =>
      setOpen(
        data.show &&
          !document.querySelector('[role="dialog"],[role="alertdialog"]')
      ),
    meta: { errorToast: false },
  })
  const join = useCampusAction(() => campusPost('self/join'))
  const requestReminder = reminder.mutate
  const eligible =
    campusSite() &&
    location.pathname === '/dashboard/overview' &&
    !location.searchStr
  useEffect(() => {
    if (!eligible) return
    // Give login/security dialogs priority. The backend atomically owns the
    // daily limit; refreshes and a second device cannot display it twice.
    const timer = window.setTimeout(() => {
      if (!document.querySelector('[role="dialog"],[role="alertdialog"]')) {
        requestReminder()
      }
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [eligible, requestReminder])
  return (
    <Dialog
      open={open && eligible}
      onOpenChange={setOpen}
      title={t('Campus Partner')}
      description={t(
        'Recommend friends and earn commissions on qualifying top-ups and subscriptions under the current rules. Friends receive one personal 5% off top-up coupon.'
      )}
      footer={
        <>
          <Button variant='outline' onClick={() => setOpen(false)}>
            {t('Maybe later')}
          </Button>
          <Button
            disabled={join.isPending}
            onClick={() =>
              join.mutate(undefined, {
                onSuccess: () => {
                  setOpen(false)
                  void navigate({ to: '/campus-partner' })
                },
              })
            }
          >
            {t('Get my invitation code')}
          </Button>
        </>
      }
    >
      <p className='text-muted-foreground text-sm'>
        {t(
          'Commission unlocks after 168 hours. Apply from CNY 100; approved applications are paid manually at month end.'
        )}
      </p>
    </Dialog>
  )
}
