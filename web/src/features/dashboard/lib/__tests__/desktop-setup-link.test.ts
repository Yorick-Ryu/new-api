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
import { describe, expect, it } from 'vitest'

import { buildDesktopSetupLink } from '../desktop-setup-link'

describe('Claude Desktop setup links', () => {
  it('uses a separate route and preset with an Anthropic base URL', () => {
    const link = new URL(
      buildDesktopSetupLink(
        'https://gateway.example/api/v1',
        'sk-fixture-not-real-key',
        'claude-fable-5-2',
        'claude-desktop'
      )
    )
    expect(link.pathname).toBe('/claude-desktop')
    expect(link.searchParams.get('preset')).toBe('claude-desktop-v1')
    expect(link.searchParams.get('base_url')).toBe(
      'https://gateway.example/api'
    )
  })
  it.each(['deepseek-flash', 'gpt-6-astra', 'claude-sonnet-alias'])(
    'rejects unsupported desktop model %s',
    (model) => {
      expect(() =>
        buildDesktopSetupLink(
          'https://gateway.example',
          'sk-fixture-not-real-key',
          model,
          'claude-desktop'
        )
      ).toThrow('Invalid model')
    }
  )
  it('rejects non-HTTPS endpoints before a credential can be delivered', () => {
    expect(() =>
      buildDesktopSetupLink(
        'http://gateway.example',
        'sk-fixture-not-real-key',
        'claude-sonnet-5-5',
        'claude-desktop'
      )
    ).toThrow('HTTPS gateway address is not configured.')
  })
})
