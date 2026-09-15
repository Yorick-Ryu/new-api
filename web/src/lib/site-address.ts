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
type AddressStatus = {
  api_address?: unknown
  server_address?: unknown
  serverAddress?: unknown
  site_address?: unknown
  site_address_configured?: unknown
  site_allowed_origins?: unknown
  data?: AddressStatus
}

export function readAddressStatus(): AddressStatus | null {
  try {
    const raw = window.localStorage.getItem('status')
    return raw ? (JSON.parse(raw) as AddressStatus) : null
  } catch {
    return null
  }
}

function currentOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin
}

export function getAPIAddress(
  status: AddressStatus | null = readAddressStatus(),
  fallback = currentOrigin()
): string {
  const data = { ...status?.data, ...status }
  for (const value of [
    data?.api_address,
    data?.server_address,
    data?.serverAddress,
  ]) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim().replace(/\/+$/, '')
    }
  }
  return fallback.replace(/\/+$/, '')
}

export function getBusinessOrigin(
  status: AddressStatus | null = readAddressStatus(),
  origin = currentOrigin()
): string {
  const data = { ...status?.data, ...status }
  if (!data?.site_address_configured || typeof data.site_address !== 'string') {
    return origin
  }
  const site = data.site_address.replace(/\/+$/, '')
  const allowed = Array.isArray(data.site_allowed_origins)
    ? data.site_allowed_origins
    : []
  if (origin === site || allowed.includes(origin)) return origin
  return site
}

export function isAddressOrigin(value: string): boolean {
  if (!value.trim()) return true
  try {
    const url = new URL(value.trim())
    return (
      ['https:', 'http:'].includes(url.protocol) &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !url.hostname.includes('*') &&
      (url.pathname === '/' || url.pathname === '')
    )
  } catch {
    return false
  }
}
