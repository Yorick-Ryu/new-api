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

import { SORT_OPTIONS } from '../../constants'
import type { PricingModel } from '../../types'
import { filterAndSortModels, sortModels } from '../filters'

const models: PricingModel[] = [
  {
    id: 1,
    model_name: 'alpha',
    display_order: 2,
    quota_type: 0,
    model_ratio: 2,
    completion_ratio: 1,
    enable_groups: ['a'],
  },
  {
    id: 2,
    model_name: 'beta',
    quota_type: 0,
    model_ratio: 3,
    completion_ratio: 1,
    enable_groups: ['b'],
  },
  {
    id: 3,
    model_name: 'zeta',
    display_order: 1,
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 1,
    enable_groups: ['a'],
  },
  {
    id: 4,
    model_name: 'delta',
    quota_type: 0,
    model_ratio: 4,
    completion_ratio: 1,
    enable_groups: ['a'],
  },
]

describe('Marketplace display order', () => {
  it('places saved models first and new models in name order without mutating input', () => {
    expect(
      sortModels(models, SORT_OPTIONS.RECOMMENDED).map((m) => m.model_name)
    ).toEqual(['zeta', 'alpha', 'beta', 'delta'])
    expect(models.map((m) => m.model_name)).toEqual([
      'alpha',
      'beta',
      'zeta',
      'delta',
    ])
  })
  it('keeps manual order when filtering by group', () => {
    expect(
      filterAndSortModels(models, {
        search: '',
        vendor: 'all',
        group: 'a',
        quotaType: 'all',
        endpointType: 'all',
        tag: 'all',
        sortBy: SORT_OPTIONS.RECOMMENDED,
      }).map((m) => m.model_name)
    ).toEqual(['zeta', 'alpha', 'delta'])
  })
  it('honors explicit name and price sorting', () => {
    expect(
      sortModels(models, SORT_OPTIONS.NAME).map((m) => m.model_name)
    ).toEqual(['alpha', 'beta', 'delta', 'zeta'])
    expect(
      sortModels(models, SORT_OPTIONS.PRICE_HIGH).map((m) => m.model_name)
    ).toEqual(['delta', 'beta', 'alpha', 'zeta'])
  })
  it('falls back to names when no order exists and handles empty input', () => {
    expect(
      sortModels(
        models.map((m) => ({ ...m, display_order: undefined })),
        SORT_OPTIONS.RECOMMENDED
      ).map((m) => m.model_name)
    ).toEqual(['alpha', 'beta', 'delta', 'zeta'])
    expect(sortModels([], SORT_OPTIONS.RECOMMENDED)).toEqual([])
  })
})
