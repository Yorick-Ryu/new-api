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

import type { Channel } from '../../types'
import {
  CHANNEL_FORM_DEFAULT_VALUES,
  transformChannelToFormDefaults,
  transformFormDataToCreatePayload,
  type ChannelFormValues,
} from '../channel-form'

function createFormValues(
  responsesTransport: ChannelFormValues['responses_transport'],
  settings = '{}'
): ChannelFormValues {
  return {
    ...CHANNEL_FORM_DEFAULT_VALUES,
    name: 'Krill',
    key: 'test-key',
    models: 'gpt-5.6-sol',
    responses_transport: responsesTransport,
    settings,
  }
}

function createChannel(settings: Record<string, unknown>): Channel {
  return {
    id: 13,
    type: 1,
    key: '',
    status: 1,
    name: 'Krill',
    created_time: 0,
    test_time: 0,
    response_time: 0,
    other: '',
    balance: 0,
    balance_updated_time: 0,
    models: 'gpt-5.6-sol',
    group: 'default',
    used_quota: 0,
    other_info: '',
    remark: '',
    max_input_tokens: 0,
    channel_info: {
      is_multi_key: false,
      multi_key_size: 0,
      multi_key_polling_index: 0,
      multi_key_mode: 'random',
    },
    settings: JSON.stringify(settings),
  }
}

describe('channel Responses transport capability', () => {
  test('serializes each transport mode without overwriting unrelated settings', () => {
    const cases = [
      ['http', true, false],
      ['websocket', false, true],
      ['none', false, false],
    ] as const

    for (const [mode, httpEnabled, webSocketEnabled] of cases) {
      const payload = transformFormDataToCreatePayload(
        createFormValues(mode, '{"custom_flag":"keep"}')
      )
      const settings = JSON.parse(String(payload.channel.settings))

      assert.equal(settings.responses_http_enabled, httpEnabled)
      assert.equal(settings.responses_websocket_enabled, webSocketEnabled)
      assert.equal(settings.custom_flag, 'keep')
    }

    const bothPayload = transformFormDataToCreatePayload(
      createFormValues(
        'both',
        '{"responses_http_enabled":false,"responses_websocket_enabled":false,"custom_flag":"keep"}'
      )
    )
    const bothSettings = JSON.parse(String(bothPayload.channel.settings))
    assert.equal('responses_http_enabled' in bothSettings, false)
    assert.equal('responses_websocket_enabled' in bothSettings, false)
    assert.equal(bothSettings.custom_flag, 'keep')
  })

  test('loads HTTP-only and WebSocket-only capabilities from saved channels', () => {
    const http = transformChannelToFormDefaults(
      createChannel({ responses_websocket_enabled: false })
    )
    const webSocket = transformChannelToFormDefaults(
      createChannel({ responses_http_enabled: false })
    )

    assert.equal(http.responses_transport, 'http')
    assert.equal(webSocket.responses_transport, 'websocket')
  })
})
