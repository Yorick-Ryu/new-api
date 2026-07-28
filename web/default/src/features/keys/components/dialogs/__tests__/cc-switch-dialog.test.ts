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
import { describe, test } from 'node:test'

import { APP_CONFIGS } from '../cc-switch-config'

describe('CC Switch Codex request-compression import', () => {
  test('defaults the imported provider name to OpenAI so Codex can compress HTTP requests to NewAPI', () => {
    // Codex treats the OpenAI provider name as compression-capable. NewAPI
    // already accepts and decompresses these zstd request bodies, so the
    // CC Switch import must preserve this exact default name.
    assert.equal(APP_CONFIGS.codex.defaultName, 'OpenAI')
  })
})
