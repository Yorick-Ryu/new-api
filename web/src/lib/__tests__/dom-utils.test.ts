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
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { DEFAULT_LOGO } from '@/lib/constants'
import { applySystemBranding } from '@/lib/dom-utils'

let originalHead: string
beforeEach(() => {
  originalHead = document.head.innerHTML
  document.head.innerHTML =
    '<title>New API</title><meta name="title" content="New API"><link rel="icon" href="/favicon.ico">'
})
afterEach(() => {
  document.head.innerHTML = originalHead
})

describe('tab branding', () => {
  test('a cold start with no cached status uses the Bei API name and bundled favicon', () => {
    applySystemBranding(null)
    expect(document.title).toBe('Bei API')
    expect(document.querySelector('meta[name="title"]')).toHaveAttribute(
      'content',
      'Bei API'
    )
    expect(document.querySelector('link[rel="icon"]')).toHaveAttribute(
      'href',
      DEFAULT_LOGO
    )
  })
  test('cached and refreshed upstream defaults cannot restore the old name or favicon', () => {
    applySystemBranding({ system_name: 'New API', logo: '/logo.png' })
    applySystemBranding({ system_name: 'New API', logo: '/logo.png' })
    expect(document.title).toBe('Bei API')
    expect(document.querySelectorAll('link[rel="icon"]')).toHaveLength(1)
    expect(document.querySelector('link[rel="icon"]')).toHaveAttribute(
      'href',
      DEFAULT_LOGO
    )
  })
  test('a configured agent name and logo remain in control after refresh', () => {
    applySystemBranding({
      system_name: 'Agent Research API',
      logo: 'https://agent.example/logo.svg',
    })
    expect(document.title).toBe('Agent Research API')
    expect(document.querySelector('meta[name="title"]')).toHaveAttribute(
      'content',
      'Agent Research API'
    )
    expect(document.querySelector('link[rel="icon"]')).toHaveAttribute(
      'href',
      'https://agent.example/logo.svg'
    )
  })
})
