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

import type { Channel } from '../../types'
import {
  buildSettingJSON,
  CHANNEL_FORM_DEFAULT_VALUES,
  transformChannelToFormDefaults,
  transformFormDataToCreatePayload,
} from '../channel-form'
import {
  normalizeResponsesTransport,
  supportsResponsesWebSocket,
} from '../responses-websocket'

function channel(type: number, settings = '{}'): Channel {
  return {
    id: 1,
    type,
    key: '',
    status: 1,
    name: 'native',
    created_time: 0,
    test_time: 0,
    response_time: 0,
    other: '',
    balance: 0,
    balance_updated_time: 0,
    models: 'gpt-test',
    group: 'default',
    used_quota: 0,
    other_info: '',
    remark: '',
    max_input_tokens: 0,
    settings,
    channel_info: {
      is_multi_key: false,
      multi_key_size: 0,
      multi_key_polling_index: 0,
      multi_key_mode: 'random',
    },
  }
}

describe('Responses WebSocket settings', () => {
  it.each([58, 59, 60])(
    'requires an explicit opt-in for channel type %i and preserves it after saving',
    (type) => {
      expect(supportsResponsesWebSocket(type)).toBe(true)
      expect(
        transformChannelToFormDefaults(channel(type)).responses_transport
      ).toBe('http')
      const payload = transformFormDataToCreatePayload({
        ...CHANNEL_FORM_DEFAULT_VALUES,
        type,
        name: 'native',
        key: 'fixture',
        models: 'gpt-test',
        responses_transport: 'both',
        settings: '{"custom_flag":"keep"}',
      })
      const settings = String(payload.channel.settings)
      expect(JSON.parse(settings)).toMatchObject({
        responses_websocket_enabled: true,
        custom_flag: 'keep',
      })
      expect(
        transformChannelToFormDefaults(channel(type, settings))
          .responses_transport
      ).toBe('both')
      expect(
        transformChannelToFormDefaults(
          channel(
            type,
            '{"responses_http_enabled":false,"responses_websocket_enabled":true}'
          )
        ).responses_transport
      ).toBe('websocket')
      expect(
        transformChannelToFormDefaults(
          channel(type, '{"responses_websocket_enabled":false}')
        ).responses_transport
      ).toBe('http')
    }
  )

  it.each([1, 57])(
    'keeps legacy channel type %i enabled when the setting is absent',
    (type) => {
      expect(
        transformChannelToFormDefaults(channel(type)).responses_transport
      ).toBe('both')
    }
  )

  it('does not advertise WebSocket on providers outside the backend allowlist', () => {
    expect(supportsResponsesWebSocket(14)).toBe(false)
    expect(
      transformChannelToFormDefaults(
        channel(14, '{"responses_websocket_enabled":true}')
      ).responses_transport
    ).toBe('http')
  })
})

it('drops only unsupported WS when the channel type changes', () => {
  expect(normalizeResponsesTransport(14, undefined)).toBe('http')
  expect(normalizeResponsesTransport(14, 'both')).toBe('http')
  expect(normalizeResponsesTransport(14, 'websocket')).toBe('none')
  expect(normalizeResponsesTransport(60, 'both')).toBe('both')
})

it.each([58, 59, 60])(
  'preserves the effective WebSocket opt-in across both settings fields for type %i',
  (type) => {
    const fromLegacy = transformChannelToFormDefaults(
      channel(type, '{"responses_websocket_enabled":true}')
    )
    expect(fromLegacy.responses_websocket_enabled).toBe(true)
    expect(fromLegacy.responses_transport).toBe('both')
    expect(
      JSON.parse(buildSettingJSON(fromLegacy)).responses_websocket_enabled
    ).toBe(true)

    const fromUpstream = transformChannelToFormDefaults({
      ...channel(type),
      setting: '{"responses_websocket_enabled":true}',
    })
    expect(fromUpstream.responses_transport).toBe('both')
    expect(
      JSON.parse(
        String(transformFormDataToCreatePayload(fromUpstream).channel.settings)
      ).responses_websocket_enabled
    ).toBe(true)

    const explicitlyDisabled = transformChannelToFormDefaults({
      ...channel(type, '{"responses_websocket_enabled":true}'),
      setting: '{"responses_websocket_enabled":false}',
    })
    expect(explicitlyDisabled.responses_websocket_enabled).toBe(false)
    const legacyDisabled = transformChannelToFormDefaults({
      ...channel(type, '{"responses_websocket_enabled":false}'),
      setting: '{"responses_websocket_enabled":true}',
    })
    expect(legacyDisabled.responses_transport).toBe('http')
  }
)
