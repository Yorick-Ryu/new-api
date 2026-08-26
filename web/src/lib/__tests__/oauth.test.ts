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
import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'

import { buildGitHubOAuthUrl } from '../oauth'

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

afterEach(() => {
  if (originalWindow) {
    Object.defineProperty(globalThis, 'window', originalWindow)
    return
  }
  Reflect.deleteProperty(globalThis, 'window')
})

describe('GitHub OAuth authorization URL', () => {
  for (const origin of ['https://beiapi.cn', 'https://www.beiapi.cn']) {
    test(`uses the current page origin for ${origin}`, () => {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { location: { origin } },
      })

      const url = new URL(buildGitHubOAuthUrl('client-id', 'oauth-state'))

      assert.equal(url.origin, 'https://github.com')
      assert.equal(url.pathname, '/login/oauth/authorize')
      assert.equal(url.searchParams.get('client_id'), 'client-id')
      assert.equal(
        url.searchParams.get('redirect_uri'),
        `${origin}/oauth/github`
      )
      assert.equal(url.searchParams.get('state'), 'oauth-state')
      assert.equal(url.searchParams.get('scope'), 'user:email')
    })
  }
})
