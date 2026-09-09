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
import { getApiKeys } from '@/features/keys/api'

// Inspect every page before deciding to create a new key. A failed lookup must
// never be treated as an empty list. Desktop IP allowlists cannot be verified here.
export async function findCodexSetupKey(
  model: string,
  isCurrent: () => boolean
): Promise<number | null> {
  let scanned = 0
  for (let page = 1; ; page += 1) {
    if (!isCurrent()) throw new Error('Setup cancelled')
    const result = await getApiKeys({ p: page, size: 100 })
    if (!isCurrent()) throw new Error('Setup cancelled')
    if (
      !result.success ||
      !result.data ||
      !Array.isArray(result.data.items) ||
      !Number.isInteger(result.data.total) ||
      result.data.total < 0
    ) {
      throw new Error('Could not inspect existing keys')
    }
    const now = Math.floor(Date.now() / 1000)
    const match = result.data.items.find(
      (key) =>
        key.id > 0 &&
        key.status === 1 &&
        key.group === 'default' &&
        (key.expired_time === -1 || key.expired_time > now) &&
        (key.unlimited_quota === true || key.remain_quota > 0) &&
        !(key.allow_ips ?? '').trim() &&
        (key.model_limits_enabled === false ||
          (key.model_limits_enabled === true &&
            (key.model_limits ?? '').split(',').includes(model)))
    )
    if (match) return match.id
    scanned += result.data.items.length
    if (scanned >= result.data.total) return null
    if (!result.data.items.length) throw new Error('Incomplete key list')
  }
}
