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
import { expect, test } from 'vitest'

const styles = postcss.parse(
  readFileSync('src/features/plans/plans.css', 'utf8')
)

test('plans inherit the global palette instead of masking preset and dark-mode changes', () => {
  const overrides: string[] = []
  styles.walkDecls((declaration) => {
    if (
      /^--(background|foreground|card|muted|accent|primary|border|radius)(-|$)/.test(
        declaration.prop
      )
    ) {
      overrides.push(declaration.toString())
    }
    if (/#[\da-f]{3,8}\b|\b(?:white|black)\b/i.test(declaration.value)) {
      overrides.push(declaration.toString())
    }
  })
  expect(overrides).toEqual([])
})

test('plans typography and corners respect global font and radius preferences', () => {
  const fixedPreferences: string[] = []
  styles.walkDecls((declaration) => {
    if (
      declaration.prop === 'font-family' &&
      !/inherit|var\(--font-body\)/.test(declaration.value)
    ) {
      fixedPreferences.push(declaration.toString())
    }
    if (
      declaration.prop === 'border-radius' &&
      /(?<![\d.])[1-9]\d*(?:\.\d+)?px/.test(declaration.value)
    ) {
      fixedPreferences.push(declaration.toString())
    }
  })
  expect(fixedPreferences).toEqual([])
})

test('section navigation derives inset corners from the outer theme radius and gap', () => {
  const radii: Record<string, string> = {}
  styles.walkRules((rule) => {
    if (
      rule.selector === '.section-switch' ||
      rule.selector === '.section-switch a'
    ) {
      rule.walkDecls('border-radius', (declaration) => {
        radii[rule.selector] = declaration.value
      })
    }
  })
  expect(radii['.section-switch']).toBe('var(--radius)')
  expect(radii['.section-switch a']).toBe(
    'max(0px, calc(var(--radius) - var(--plans-switch-inset)))'
  )
})
