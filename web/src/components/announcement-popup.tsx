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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { RichContent } from '@/components/rich-content'
import { Button } from '@/components/ui/button'
import type { AnnouncementItem } from '@/features/dashboard/types'
import { useStatus } from '@/hooks/use-status'
import { formatDateTimeObject } from '@/lib/time'
import { useAuthStore } from '@/stores/auth-store'

type AnnouncementPopupProps = {
  announcement: AnnouncementItem
  onAcknowledge: () => void
}

export function AnnouncementPopup(props: AnnouncementPopupProps) {
  const { t } = useTranslation()
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onAcknowledge()
      }}
      title={t('Important announcement')}
      description={
        props.announcement.publishDate
          ? `${t('Published:')} ${formatDateTimeObject(new Date(props.announcement.publishDate))}`
          : undefined
      }
      contentClassName='sm:max-w-xl'
      bodyClassName='space-y-4 break-words'
      footer={
        <Button onClick={props.onAcknowledge}>{t('I understand')}</Button>
      }
    >
      <RichContent breaks content={props.announcement.content} />
      {props.announcement.extra && (
        <RichContent
          breaks
          content={props.announcement.extra}
          className='text-muted-foreground border-t pt-4'
        />
      )}
    </Dialog>
  )
}

function UserAnnouncementReminder(props: {
  userId: number
  announcements: AnnouncementItem[]
}) {
  const storageKey = `announcement-popup-read:${props.userId}`
  const [acknowledged, setAcknowledged] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem(storageKey) || '[]'
      )
      return Array.isArray(saved) &&
        saved.every((item) => typeof item === 'string')
        ? saved
        : []
    } catch {
      return []
    }
  })
  const pending = props.announcements
    .filter((item) => {
      if (item?.popup !== true || !item.content?.trim()) return false
      const publishedAt = Date.parse(item.publishDate || '')
      return Number.isFinite(publishedAt) && publishedAt <= Date.now()
    })
    .sort(
      (a, b) =>
        Date.parse(b.publishDate || '') - Date.parse(a.publishDate || '')
    )
    .map((announcement) => ({
      announcement,
      revision: JSON.stringify([
        announcement.id,
        announcement.publishDate,
        announcement.content,
        announcement.extra || '',
      ]),
    }))
    .find((item) => !acknowledged.includes(item.revision))

  if (!pending) return null

  const acknowledge = () => {
    const next = [...acknowledged, pending.revision]
    setAcknowledged(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      // Still dismiss for this visit when browser storage is unavailable.
    }
  }

  return (
    <AnnouncementPopup
      key={pending.revision}
      announcement={pending.announcement}
      onAcknowledge={acknowledge}
    />
  )
}

export function AnnouncementReminder() {
  const userId = useAuthStore((state) => state.auth.user?.id)
  const { status, loading, error, isPlaceholderData } = useStatus()
  if (
    !userId ||
    loading ||
    error ||
    isPlaceholderData ||
    !status?.announcements_enabled
  ) {
    return null
  }
  return (
    <UserAnnouncementReminder
      key={userId}
      userId={userId}
      announcements={
        Array.isArray(status.announcements)
          ? (status.announcements as AnnouncementItem[])
          : []
      }
    />
  )
}
