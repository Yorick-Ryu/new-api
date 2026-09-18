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
// OpenAI and Codex retain their existing implicit WS support.
export function responsesWebSocketDefaultEnabled(channelType: number): boolean {
  return channelType === 1 || channelType === 57
}

export function supportsResponsesWebSocket(channelType: number): boolean {
  return [1, 57, 58, 59, 60].includes(channelType)
}

export function normalizeResponsesTransport(
  channelType: number,
  transport: 'both' | 'http' | 'websocket' | 'none' = 'both'
): 'both' | 'http' | 'websocket' | 'none' {
  if (supportsResponsesWebSocket(channelType)) return transport
  return transport === 'both' || transport === 'http' ? 'http' : 'none'
}
