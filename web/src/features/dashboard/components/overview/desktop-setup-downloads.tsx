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
import { Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { FaApple, FaWindows } from 'react-icons/fa6'

import { buttonVariants } from '@/components/ui/button'

import type { SetupDownload } from './desktop-setup-dialog'

export function DesktopSetupDownloads({
  downloads,
}: {
  downloads: SetupDownload[]
}) {
  const { t } = useTranslation()
  const platforms = [
    {
      label: 'macOS Apple Silicon',
      title: 'macOS',
      chip: t('Apple chip'),
      detail: 'M1 / M2 / M3 / M4 / M5',
      icon: FaApple,
    },
    {
      label: 'Windows x64',
      title: 'Windows',
      chip: 'Intel / AMD',
      detail: 'x64 (x86-64)',
      icon: FaWindows,
    },
  ]
  const otherDownloads = downloads.filter(
    (download) =>
      !platforms.some((platform) => platform.label === download.label)
  )

  if (!downloads.length) {
    return (
      <p className='text-muted-foreground text-sm'>
        {t('Installers are not published yet.')}
      </p>
    )
  }

  return (
    <div className='space-y-4'>
      <div className='grid grid-cols-1 gap-3 min-[400px]:grid-cols-2'>
        {platforms.map((platform) => {
          const download = downloads.find(
            (item) => item.label === platform.label
          )
          if (!download) return null
          const Icon = platform.icon
          return (
            <div
              key={platform.label}
              className='bg-muted/30 flex min-w-0 flex-col rounded-xl border p-4'
            >
              <Icon aria-hidden='true' className='mb-4 size-7' />
              <h3 className='text-base font-semibold'>{platform.title}</h3>
              <p className='mt-1 text-sm'>{platform.chip}</p>
              <p className='text-muted-foreground mt-1 text-xs'>
                {platform.detail}
              </p>
              <a
                className={buttonVariants({
                  className: 'mt-5 w-full',
                  size: 'lg',
                })}
                aria-label={download.label}
                href={download.url}
                target='_blank'
                rel='noopener noreferrer'
              >
                <Download aria-hidden='true' className='size-4' />
                {t('Download')}
              </a>
            </div>
          )
        })}
      </div>
      {otherDownloads.length > 0 && (
        <div
          role='group'
          aria-label={t('Other architectures')}
          className='text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-2 pt-1 text-xs'
        >
          <span>{t('Other architectures')}:</span>
          {otherDownloads.map((download, index) => (
            <span
              key={download.label}
              className='inline-flex items-center gap-2'
            >
              {index > 0 && <span aria-hidden='true'>·</span>}
              <a
                className='hover:text-foreground focus-visible:ring-ring rounded whitespace-nowrap underline-offset-4 outline-none hover:underline focus-visible:ring-2'
                href={download.url}
                target='_blank'
                rel='noopener noreferrer'
              >
                {download.label}
              </a>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
