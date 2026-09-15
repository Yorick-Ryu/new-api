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
import { afterEach, expect, it } from 'vitest'

import {
  buildGitHubOAuthUrl,
  buildDiscordOAuthUrl,
  buildOIDCOAuthUrl,
  buildLinuxDOOAuthUrl,
} from '../oauth'
import {
  getAPIAddress,
  getBusinessOrigin,
  isAddressOrigin,
} from '../site-address'

const status = {
  api_address: 'https://api.example.com',
  server_address: 'https://legacy.example.com',
  site_address: 'https://example.com',
  site_address_configured: true,
  site_allowed_origins: [
    'https://example.com',
    'https://www.example.com',
    'https://novapi.cn',
  ],
}
afterEach(() => window.localStorage.clear())

it('keeps API setup separate from the business site and accepts legacy status responses', () => {
  expect(getAPIAddress(status)).toBe('https://api.example.com')
  expect(
    getAPIAddress({ ...status, site_address: 'https://new-site.example' })
  ).toBe('https://api.example.com')
  expect(
    getAPIAddress({ data: { server_address: 'https://legacy.example.com/' } })
  ).toBe('https://legacy.example.com')
  expect(getAPIAddress(null, 'https://fallback.example')).toBe(
    'https://fallback.example'
  )
})
it('preserves explicitly allowed business sites and rejects API or lookalike origins', () => {
  for (const origin of status.site_allowed_origins) {
    expect(getBusinessOrigin(status, origin)).toBe(origin)
  }
  for (const origin of [
    'https://api.example.com',
    'https://www.example.com.evil.test',
    'https://www.example.com:8443',
    'http://www.example.com',
  ]) {
    expect(getBusinessOrigin(status, origin)).toBe('https://example.com')
  }
  expect(
    getBusinessOrigin(
      { server_address: 'https://api.example.com' },
      'https://legacy-site.example'
    )
  ).toBe('https://legacy-site.example')
})
it('uses the configured business origin consistently in all built-in authorization URLs', () => {
  window.localStorage.setItem('status', JSON.stringify(status))
  const urls = [
    ['github', buildGitHubOAuthUrl('client', 'state')],
    ['discord', buildDiscordOAuthUrl('client', 'state')],
    [
      'oidc',
      buildOIDCOAuthUrl(
        'https://identity.example/authorize',
        'client',
        'state'
      ),
    ],
    ['linuxdo', buildLinuxDOOAuthUrl('client', 'state')],
  ]
  for (const [provider, value] of urls) {
    const url = new URL(value)
    expect(url.searchParams.get('redirect_uri')).toBe(
      `https://example.com/oauth/${provider}`
    )
    expect(url.searchParams.get('state')).toBe('state')
  }
})
it('validates origins rather than accepting paths or embedded credentials', () => {
  for (const value of ['', 'https://example.com/', 'http://localhost:3000']) {
    expect(isAddressOrigin(value)).toBe(true)
  }
  for (const value of [
    'https://example.com/v1',
    'https://user:pass@example.com',
    'https://example.com?q=1',
    'https://example.com#hash',
    'https://*.example.com',
    'javascript:alert(1)',
  ]) {
    expect(isAddressOrigin(value)).toBe(false)
  }
})
