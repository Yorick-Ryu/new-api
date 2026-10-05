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
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { getUserModels } from '../api'

afterEach(() => vi.restoreAllMocks())

it('requests the playground catalog for the selected group and preserves its order', async () => {
  const request = vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: ['z-chat', 'a-chat'] },
  })

  expect(await getUserModels('default')).toEqual([
    { label: 'z-chat', value: 'z-chat' },
    { label: 'a-chat', value: 'a-chat' },
  ])
  expect(request).toHaveBeenCalledWith('/api/user/models', {
    params: { group: 'default', purpose: 'playground' },
  })
})
