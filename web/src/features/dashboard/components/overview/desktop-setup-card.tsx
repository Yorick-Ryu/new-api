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
import { Claude, OpenAI } from '@lobehub/icons'
import { Download, KeyRound, Link2, SlidersHorizontal } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import codexBeiLogo from '@/assets/brand/codexbei.svg'
import { buttonVariants } from '@/components/ui/button'

export function DesktopSetupCard() {
  const { t } = useTranslation()
  const titleId = useId()

  return (
    <section
      aria-labelledby={titleId}
      className='bg-background/75 flex min-w-0 flex-col gap-4 rounded-2xl border p-4 shadow-sm backdrop-blur'
    >
      <div className='flex items-center gap-3'>
        <img
          src={codexBeiLogo}
          alt=''
          aria-hidden='true'
          width={40}
          height={40}
          className='size-10 shrink-0'
        />
        <div className='min-w-0'>
          <h4 id={titleId} className='text-sm font-semibold'>
            CodexBei
          </h4>
          <p className='text-muted-foreground text-xs'>
            {t('For Windows and macOS')}
          </p>
        </div>
      </div>

      <p className='text-muted-foreground text-sm leading-relaxed'>
        {t(
          'Choose your model. CodexBei configures the connection and API key for you.'
        )}
      </p>

      <div
        role='img'
        aria-label={t('CodexBei setup preview')}
        className='bg-card min-w-0 overflow-hidden rounded-xl border shadow-sm'
      >
        <div aria-hidden='true'>
          <div className='bg-muted/40 flex items-center gap-2 border-b px-3 py-2'>
            <span className='flex shrink-0 gap-1'>
              <span className='bg-muted-foreground/25 size-1.5 rounded-full' />
              <span className='bg-muted-foreground/25 size-1.5 rounded-full' />
              <span className='bg-muted-foreground/25 size-1.5 rounded-full' />
            </span>
            <span className='text-muted-foreground min-w-0 text-[11px]'>
              CodexBei
            </span>
          </div>
          <div className='space-y-3 p-3'>
            <div className='flex flex-wrap gap-x-4 gap-y-2 text-xs'>
              <span className='flex items-center gap-1.5'>
                <OpenAI size={14} />
                ChatGPT
              </span>
              <span className='flex items-center gap-1.5'>
                <Claude.Color size={14} />
                Claude Code
              </span>
            </div>
            <ul className='text-muted-foreground space-y-3 border-t pt-3 text-xs'>
              <li className='flex items-center gap-2'>
                <Link2 className='size-3.5 shrink-0' />
                {t('API connection address filled automatically')}
              </li>
              <li className='flex items-center gap-2'>
                <KeyRound className='size-3.5 shrink-0' />
                {t('API key filled automatically')}
              </li>
              <li className='flex items-center gap-2'>
                <SlidersHorizontal className='size-3.5 shrink-0' />
                {t('Best configuration applied automatically')}
              </li>
            </ul>
          </div>
        </div>
      </div>

      <a
        className={buttonVariants({ size: 'sm', className: 'mt-auto w-full' })}
        href='https://codexbei.beiapi.cn/'
        target='_blank'
        rel='noopener noreferrer'
      >
        <Download data-icon='inline-start' />
        {t('Download setup tool')}
      </a>
    </section>
  )
}
