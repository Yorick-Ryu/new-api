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

test('shared card hover styles keep panels stationary without adding an elevation shadow in either theme', () => {
  const stylesheet = postcss.parse(readFileSync('src/styles/index.css', 'utf8'))
  const hoverEffects: string[] = []
  stylesheet.walkRules((rule) => {
    if (
      !rule.selector.includes("[data-slot='card']") ||
      !rule.selector.includes(':hover')
    )
      return
    rule.walkDecls(
      /^(transform|translate|scale|box-shadow)$/,
      (declaration) => {
        if (declaration.value !== 'none')
          hoverEffects.push(`${rule.selector}: ${declaration.toString()}`)
      }
    )
  })
  expect(hoverEffects).toEqual([])
})
