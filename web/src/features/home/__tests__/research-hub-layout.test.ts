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

test('narrow layouts place the brand between two task rows without changing their reading order', () => {
  const styles = postcss.parse(
    readFileSync('src/styles/research-hub.css', 'utf8')
  )
  const areas: Record<string, string> = {}
  let rows = ''
  styles.walkAtRules('container', (container) => {
    if (container.params !== '(max-width: 520px)') return
    container.walkRules((rule) => {
      rule.walkDecls('grid-area', (declaration) => {
        areas[rule.selector] = declaration.value
      })
      rule.walkDecls('grid-template-rows', (declaration) => {
        rows = declaration.value
      })
    })
  })
  expect(rows).toBe('1fr auto 1fr')
  expect(areas['.beiapi-home .research-hub-brand']).toBe('2 / 1 / 3 / 3')
  expect(areas['.beiapi-home .research-hub-tools']).toBe('1 / 1')
  expect(areas['.beiapi-home .research-hub-writing']).toBe('1 / 2')
  expect(areas['.beiapi-home .research-hub-literature']).toBe('3 / 1')
  expect(areas['.beiapi-home .research-hub-code']).toBe('3 / 2')
})
