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
import i18next from 'i18next'

import { DEFAULT_LOGO, resolveSiteName } from '@/lib/constants'
import { mapStatusDataToConfig, type StatusData } from '@/lib/status-query'

export function applyFaviconToDom(url: string) {
  if (typeof document === 'undefined' || !url) return
  try {
    const next = new URL(url, window.location.href).href
    const existing =
      document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')
    if (existing.length === 1 && existing[0].href === next) return
    const link = document.createElement('link')
    link.rel = 'icon'
    link.href = url
    existing.forEach((l) => l.remove())
    document.head.appendChild(link)
  } catch {
    // Ignore malformed URLs
  }
}

/** Keep tab branding consistent with the normalized UI configuration. */
export function applySystemBranding(
  status: StatusData | null | undefined
): void {
  if (typeof document === 'undefined') return
  const config = mapStatusDataToConfig(status)
  const name = resolveSiteName(
    config.systemName,
    i18next.language || navigator.language
  )
  document.title = name
  document.querySelector('meta[name="title"]')?.setAttribute('content', name)
  applyFaviconToDom(config.logo || DEFAULT_LOGO)
}
