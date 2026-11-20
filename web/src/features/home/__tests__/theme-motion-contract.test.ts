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

import postcss from 'postcss'
import { describe, expect, test } from 'vitest'

describe('BeiAPI homepage theme and motion stylesheet contracts', () => {
  const homeCss = readFileSync('src/styles/beiapi-home.css', 'utf8')
  const homeStyles = postcss.parse(homeCss)

  test('inherits NewAPI theme typography without overriding --font-ui-sans', () => {
    let fontFamily = ''
    let overridesUiSans = false
    homeStyles.walkRules('.beiapi-home', (rule) => {
      rule.walkDecls('font-family', (decl) => {
        fontFamily = decl.value
      })
      rule.walkDecls('--font-ui-sans', () => {
        overridesUiSans = true
      })
    })
    expect(fontFamily).toBe('inherit')
    expect(overridesUiSans).toBe(false)
  })

  test('avoids global 0.01ms reduced-motion overrides and gates scroll-driven motion on no-preference + @supports', () => {
    expect(homeCss).not.toContain('0.01ms')
    let hasViewTimelineGuard = false
    let hasScrollTimelineGuard = false
    homeStyles.walkAtRules('media', (media) => {
      if (!media.params.includes('prefers-reduced-motion: no-preference')) {
        return
      }
      media.walkAtRules('supports', (supports) => {
        if (
          supports.params.includes('animation-timeline: view()') &&
          supports.params.includes('animation-range: entry')
        ) {
          hasViewTimelineGuard = true
        }
        if (supports.params.includes('animation-timeline: scroll()')) {
          hasScrollTimelineGuard = true
        }
      })
    })
    expect(hasViewTimelineGuard).toBe(true)
    expect(hasScrollTimelineGuard).toBe(true)
  })

  test('keeps ordinary info cards stationary without hover lift or scale rules', () => {
    const infoCardHoverSelectors = [
      '.hero-service-item:hover',
      '.step:hover',
      '.price-fact:hover',
      '.signup-reward:hover',
      '.reward-path:hover',
    ]
    for (const selector of infoCardHoverSelectors) {
      expect(homeCss).not.toContain(selector)
    }
  })

  test('never mixes neutral colors in oklch inside homepage styles', () => {
    const hubCss = readFileSync('src/styles/research-hub.css', 'utf8')
    expect(homeCss).not.toContain('color-mix(in oklch')
    expect(hubCss).not.toContain('color-mix(in oklch')
  })
})
