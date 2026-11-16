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
import { readFileSync } from 'node:fs'

import i18next from 'i18next'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { DEFAULT_LOGO, resolveSiteName } from '@/lib/constants'
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
  test('configured New API remains authoritative after cached and fresh reads', () => {
    applySystemBranding({ system_name: 'New API', logo: '/logo.png' })
    applySystemBranding({ system_name: 'New API', logo: '/logo.png' })
    expect(document.title).toBe('New API')
    expect(document.querySelectorAll('link[rel="icon"]')).toHaveLength(1)
    expect(document.querySelector('link[rel="icon"]')).toHaveAttribute(
      'href',
      '/logo.png'
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

describe('localized site brand', () => {
  test.each([
    ['zhCN', '小北科研API'],
    ['zhTW', '小北科研API'],
    ['en', 'Bei API'],
    ['fr', 'Bei API'],
    ['ru', 'Bei API'],
    ['ja', 'Bei API'],
    ['vi', 'Bei API'],
  ])('uses the localized site name for %s', (language, expected) => {
    expect(resolveSiteName('', language)).toBe(expected)
    expect(resolveSiteName('   ', language)).toBe(expected)
    expect(resolveSiteName(undefined, language)).toBe(expected)
    for (const configured of ['New API', 'Bei API', '小北科研API']) {
      expect(resolveSiteName(configured, language)).toBe(configured)
    }
    expect(resolveSiteName('Agent Research API', language)).toBe(
      'Agent Research API'
    )
  })
  test('switching between Chinese and English updates the tab name', async () => {
    try {
      await i18next.changeLanguage('zhCN')
      applySystemBranding({ system_name: '', logo: '/logo.png' })
      expect(document.title).toBe('小北科研API')
      await i18next.changeLanguage('en')
      applySystemBranding({ system_name: '', logo: '/logo.png' })
      expect(document.title).toBe('Bei API')
    } finally {
      await i18next.changeLanguage('en')
    }
  })
})

describe('pre-boot configured tab branding', () => {
  test.each([
    ['New API', 'zhCN', 'New API'],
    ['Research Lab', 'zhCN', 'Research Lab'],
    ['', 'zhCN', '小北科研API'],
    ['', 'en', 'Bei API'],
  ])('respects cached %s in %s', (name, language, expected) => {
    const previousStatus = localStorage.getItem('status')
    const previousLanguage = localStorage.getItem('i18nextLng')
    try {
      localStorage.setItem('status', JSON.stringify({ system_name: name }))
      localStorage.setItem('i18nextLng', language)
      const html = readFileSync('index.html', 'utf8')
      const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
      const brandScript = scripts[1]?.[1]
      if (!brandScript) throw new Error('Missing branding boot script')
      new Function(brandScript)()
      expect(document.title).toBe(expected)
    } finally {
      if (previousStatus === null) localStorage.removeItem('status')
      else localStorage.setItem('status', previousStatus)
      if (previousLanguage === null) localStorage.removeItem('i18nextLng')
      else localStorage.setItem('i18nextLng', previousLanguage)
    }
  })
})
