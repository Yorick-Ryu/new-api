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
import { supportsResponsesWebSocket } from '../responses-websocket'

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

describe('official Responses WebSocket setting', () => {
  it.each([1, 3, 57, 58, 59, 60, 61])(
    'uses the official field first and falls back to the retired field for channel %i',
    (type) => {
      for (const [legacy, official, enabled] of [
        [undefined, undefined, type === 1 || type === 57],
        [true, undefined, true],
        [false, undefined, false],
        [false, true, true],
        [true, false, false],
      ] as const) {
        const values = transformChannelToFormDefaults({
          ...channel(
            type,
            JSON.stringify({
              responses_http_enabled: false,
              responses_websocket_enabled: legacy,
            })
          ),
          setting: JSON.stringify({ responses_websocket_enabled: official }),
        })
        expect(values.responses_websocket_enabled).toBe(enabled)
        expect(values).not.toHaveProperty('responses_transport')
      }
    }
  )

  it.each([false, true])(
    'saves official switch %s without retired transport restrictions',
    (enabled) => {
      const values = {
        ...CHANNEL_FORM_DEFAULT_VALUES,
        type: 1,
        name: 'native',
        key: 'fixture',
        models: 'gpt-test',
        responses_websocket_enabled: enabled,
        settings:
          '{"responses_http_enabled":false,"responses_websocket_enabled":false,"custom_flag":"keep"}',
      }
      const payload = transformFormDataToCreatePayload(values).channel
      expect(
        JSON.parse(String(payload.setting)).responses_websocket_enabled
      ).toBe(enabled)
      expect(JSON.parse(String(payload.settings))).not.toHaveProperty(
        'responses_http_enabled'
      )
      expect(JSON.parse(String(payload.settings))).not.toHaveProperty(
        'responses_websocket_enabled'
      )
      expect(JSON.parse(String(payload.settings)).custom_flag).toBe('keep')
      expect(
        transformChannelToFormDefaults({
          ...channel(1, String(payload.settings)),
          setting: String(payload.setting),
        }).responses_websocket_enabled
      ).toBe(enabled)
      expect(
        JSON.parse(buildSettingJSON(values)).responses_websocket_enabled
      ).toBe(enabled)
    }
  )

  it('does not enable unsupported providers', () => {
    expect(supportsResponsesWebSocket(14)).toBe(false)
    const values = transformChannelToFormDefaults({
      ...channel(14),
      setting: '{"responses_websocket_enabled":true}',
    })
    expect(values.responses_websocket_enabled).toBe(false)
    expect(
      JSON.parse(buildSettingJSON(values)).responses_websocket_enabled
    ).toBe(false)
  })
})
