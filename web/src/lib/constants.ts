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
import beiapiLogo from '@/assets/brand/beiapi.svg'

/**
 * Application-wide constants
 */

// System Configuration Defaults
export const DEFAULT_SYSTEM_NAME = 'Bei API'
export const DEFAULT_LOGO = beiapiLogo

// Configured names are authoritative; only an empty setting uses the locale default.
export function resolveSiteName(
  name: string | undefined,
  language: string
): string {
  if (name?.trim()) return name
  return language.toLowerCase().startsWith('zh')
    ? '小北科研API'
    : DEFAULT_SYSTEM_NAME
}

// LocalStorage Keys
export const STORAGE_KEYS = {
  SYSTEM_NAME: 'system_name',
  LOGO: 'logo',
  FOOTER_HTML: 'footer_html',
} as const
