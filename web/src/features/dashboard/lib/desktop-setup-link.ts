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
export class InvalidDesktopSetupUrlError extends Error {
  constructor() {
    super('HTTPS gateway address is not configured.')
  }
}

export function buildDesktopSetupLink(
  baseUrl: string,
  apiKey: string,
  model: string
): string {
  let endpoint: URL
  try {
    endpoint = new URL(baseUrl.trim())
  } catch {
    throw new InvalidDesktopSetupUrlError()
  }
  if (
    baseUrl.length > 2048 ||
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new InvalidDesktopSetupUrlError()
  }
  const pathname = endpoint.pathname.replace(/\/+$/, '')
  endpoint.pathname = pathname.endsWith('/v1') ? pathname : `${pathname}/v1`
  const key = apiKey.startsWith('sk-') ? apiKey : `sk-${apiKey}`
  if (!/^sk-[A-Za-z0-9_-]{12,512}$/.test(key) || key === 'sk-your-api-key') {
    throw new Error('Invalid API key')
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(model)) {
    throw new Error('Invalid model')
  }
  const link = new URL('codexbei://configure/codex')
  link.searchParams.set('base_url', endpoint.href.replace(/\/$/, ''))
  link.searchParams.set('api_key', key)
  link.searchParams.set('model', model)
  link.searchParams.set('preset', 'codexbei-v1')
  return link.href
}
