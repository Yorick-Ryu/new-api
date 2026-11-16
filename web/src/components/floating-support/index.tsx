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
import { HeadsetIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useDialog } from '@/hooks/use-dialog'

interface FloatingSupportProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/** Mount beside the page footer so the compact launcher can avoid its controls. */
export function FloatingSupport(props: FloatingSupportProps) {
  const { t } = useTranslation()
  const [internalOpen, dialog] = useDialog()
  const open = props.open ?? internalOpen
  const [qrError, setQrError] = useState(false)
  const [footerVisible, setFooterVisible] = useState(false)
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const footer = hostRef.current?.parentElement?.querySelector('footer')
    if (!footer || !('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver((entries) => {
      setFooterVisible(entries.some((entry) => entry.isIntersecting))
    })
    observer.observe(footer)
    return () => observer.disconnect()
  }, [])

  const setOpen = (nextOpen: boolean) => {
    if (nextOpen) setQrError(false)
    if (props.onOpenChange) props.onOpenChange(nextOpen)
    else if (nextOpen) dialog.open()
    else dialog.close()
  }

  return (
    <div ref={hostRef} className='contents'>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant='outline'
              size='icon'
              className='fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 size-[44px] rounded-xl shadow-sm sm:right-6 [&[hidden]]:hidden'
              hidden={footerVisible}
              aria-haspopup='dialog'
              aria-expanded={open}
              aria-label={t(
                'After-sales support: scan to contact Bei on WeChat'
              )}
              onClick={() => setOpen(true)}
            >
              <HugeiconsIcon
                icon={HeadsetIcon}
                className='text-primary size-5'
                aria-hidden='true'
              />
            </Button>
          }
        />
        <TooltipContent side='left'>{t('After-sales support')}</TooltipContent>
      </Tooltip>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('Contact Bei · Consultation and support')}
        description={t(
          'Scan to contact Bei for API setup, top-ups, request errors or plan questions.'
        )}
        bodyClassName='flex flex-col gap-4'
      >
        <p className='text-muted-foreground text-sm leading-relaxed'>
          {t(
            'Mention “API support” when adding the contact and include the problem or an error screenshot. Try the left WeChat contact first; use the right backup contact if necessary.'
          )}
        </p>
        <div className='border-border overflow-hidden rounded-lg border'>
          <img
            className='h-auto w-full'
            hidden={qrError}
            src='/beiapi-home/assets/3a3296fc7db30a31.png'
            loading='lazy'
            decoding='async'
            width='983'
            height='614'
            alt={t('Bei WeChat contact QR codes')}
            onError={() => setQrError(true)}
            onLoad={() => setQrError(false)}
          />
          {qrError && (
            <p role='status' className='text-muted-foreground p-6 text-sm'>
              {t(
                'The WeChat QR codes could not be loaded. Refresh the page to retry.'
              )}
            </p>
          )}
        </div>
      </Dialog>
    </div>
  )
}
