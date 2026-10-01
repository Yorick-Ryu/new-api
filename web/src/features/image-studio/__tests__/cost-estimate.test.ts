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

import type { PricingData, PricingModel } from '@/features/pricing/types'

import { estimateImageCost } from '../lib/cost-estimate'

const input = { model: 'gpt-image-2', size: '1024x1024', quality: 'low', n: 1 }

function pricing(model: Partial<PricingModel> = {}, group = 1): PricingData {
  return {
    success: true,
    data: [
      {
        id: 1,
        model_name: 'gpt-image-2',
        quota_type: 0,
        model_ratio: 0,
        completion_ratio: 0,
        enable_groups: ['default'],
        billing_mode: 'tiered_expr',
        billing_expr:
          'tier("standard", p * 5 + cr * 1.25 + img * 8 + img_cr * 2 + c * 30)',
        ...model,
      },
    ],
    vendors: [],
    group_ratio: { default: group },
    usable_group: {},
    supported_endpoint: {},
    auto_groups: [],
  }
}

describe('image output cost estimates', () => {
  it.each([
    ['1024x1024', 'low', 196],
    ['1024x1024', 'medium', 1756],
    ['1024x1024', 'high', 7024],
    ['1536x864', 'low', 120],
    ['1536x864', 'medium', 1078],
    ['1536x864', 'high', 4312],
    ['864x1536', 'high', 4312],
    ['3840x2160', 'high', 13342],
  ])(
    'uses the official %s %s output-token calculation',
    (size, quality, tokens) => {
      expect(estimateImageCost({ ...input, size, quality }, pricing())).toEqual(
        {
          minUSD: (Number(tokens) * 30) / 1000000,
          maxUSD: (Number(tokens) * 30) / 1000000,
          scope: 'output',
          automatic: false,
        }
      )
    }
  )

  it.each([
    ['1536x624', 72],
    ['1536x720', 100],
  ])('uses half-even grid rounding at the %s tie', (size, tokens) => {
    expect(estimateImageCost({ ...input, size }, pricing())?.minUSD).toBe(
      (tokens * 30) / 1000000
    )
  })

  it('multiplies output tokens by the image count and effective group ratio exactly once', () => {
    const estimate = estimateImageCost({ ...input, n: 4 }, pricing({}, 2))
    expect(estimate?.minUSD).toBeCloseTo(0.04704)
    expect(estimate?.maxUSD).toBeCloseTo(0.04704)
  })

  it.each([
    ['low', 54, 659],
    ['medium', 514, 5930],
    ['high', 2061, 23719],
  ])(
    'covers every valid size when %s output size is automatic',
    (quality, min, max) => {
      expect(
        estimateImageCost({ ...input, size: '', quality }, pricing())
      ).toEqual({
        minUSD: (Number(min) * 30) / 1000000,
        maxUSD: (Number(max) * 30) / 1000000,
        scope: 'output',
        automatic: true,
      })
    }
  )

  it('ranges across supported qualities for a fixed size and across both automatic choices', () => {
    expect(
      estimateImageCost({ ...input, quality: '' }, pricing())
    ).toMatchObject({
      minUSD: 0.00588,
      maxUSD: 0.21072,
      automatic: true,
    })
    expect(
      estimateImageCost({ ...input, size: '', quality: '', n: 4 }, pricing())
    ).toMatchObject({
      minUSD: 0.00648,
      maxUSD: 2.84628,
      automatic: true,
    })
  })

  it('reuses automatic usage bounds while reflecting changed administrator prices and group ratios', () => {
    estimateImageCost({ ...input, size: '', quality: '' }, pricing())
    const changed = pricing({ billing_expr: 'tier("output", c * 10)' }, 2)
    expect(
      estimateImageCost({ ...input, size: '', quality: '' }, changed)?.maxUSD
    ).toBeCloseTo(0.47438)
  })

  it('supports an explicitly priced GPT Image 2 date alias without borrowing another catalog entry', () => {
    const model = 'gpt-image-2-2026-04-21'
    expect(
      estimateImageCost({ ...input, model }, pricing({ model_name: model }))
        ?.minUSD
    ).toBe(0.00588)
    expect(estimateImageCost({ ...input, model }, pricing())).toBeNull()
    expect(
      estimateImageCost(
        { ...input, model: 'gpt-image-2.5-sunburst' },
        pricing({ model_name: 'gpt-image-2.5-sunburst' })
      )
    ).toBeNull()
  })

  it('accepts an equal c and img_o price but never invents or combines their token counts', () => {
    expect(
      estimateImageCost(
        input,
        pricing({ billing_expr: 'tier("output", c * 30 + img_o * 30)' })
      )?.minUSD
    ).toBe(0.00588)
    expect(
      estimateImageCost(
        input,
        pricing({ billing_expr: 'tier("output", c * 30 + img_o * 40)' })
      )
    ).toBeNull()
    expect(
      estimateImageCost(
        input,
        pricing({ billing_expr: 'tier("output", img_o * 30)' })
      )
    ).toBeNull()
  })

  it.each([
    'tier("custom", c * c)',
    'c < 1000 ? tier("small", c * 1) : tier("large", c * 30)',
    'tier("custom", c * 30) * image_count',
    'tier("custom", c * 30) * 2',
    'tier("custom", c * 30) * (param("quality") == "high" ? 2 : 1)',
    'tier("custom", c * -30)',
    'not a valid expression',
  ])('returns unavailable for unsupported output pricing: %s', (expression) => {
    expect(
      estimateImageCost(input, pricing({ billing_expr: expression }))
    ).toBeNull()
  })

  it.each([
    { n: 0 },
    { n: 5 },
    { n: 1.5 },
    { quality: 'ultra' },
    { size: '624x1024' },
    { size: '1024x1025' },
    { size: '4096x1536' },
    { size: '3840x2176' },
    { size: '3088x1024' },
    { size: '-16x1024' },
  ])('does not price invalid image settings: %j', (invalid) => {
    expect(estimateImageCost({ ...input, ...invalid }, pricing())).toBeNull()
  })
})

describe('configured image request prices', () => {
  it('lets fixed expressions own the quantity multiplier instead of multiplying n again', () => {
    const expression = 'tier("image", fixed(0.02)) * image_count'
    expect(
      estimateImageCost(
        { ...input, n: 4 },
        pricing({ billing_expr: expression }, 2)
      )
    ).toMatchObject({
      minUSD: 0.16,
      maxUSD: 0.16,
      scope: 'request',
    })
    expect(
      estimateImageCost(
        { ...input, n: 4 },
        pricing({ billing_expr: 'tier("request", fixed(0.02))' }, 2)
      )?.minUSD
    ).toBe(0.04)
  })

  it('evaluates known scalar request conditions using the worker auto defaults', () => {
    const expression =
      'param("size") == "auto" && param("quality") == "auto" ? tier("auto", fixed(0.1)) * image_count : tier("manual", fixed(0.02)) * image_count'
    expect(
      estimateImageCost(
        { ...input, size: '', quality: '', n: 2 },
        pricing({ billing_expr: expression })
      )?.minUSD
    ).toBe(0.2)
    expect(
      estimateImageCost(
        { ...input, n: 2 },
        pricing({ billing_expr: expression })
      )?.minUSD
    ).toBe(0.04)
  })

  it.each([
    'header("x-rate") == "cheap" ? tier("cheap", fixed(0.01)) : tier("base", fixed(1))',
    'param("prompt") == "" ? tier("cheap", fixed(0.01)) : tier("base", fixed(1))',
    'len < 1000 ? tier("cheap", fixed(0.01)) : tier("base", fixed(1))',
  ])(
    'does not guess a fixed-price branch with missing context: %s',
    (expression) => {
      expect(
        estimateImageCost(input, pricing({ billing_expr: expression }))
      ).toBeNull()
    }
  )

  it('supports legacy GPT Image fixed prices while excluding legacy token and DALL-E multipliers', () => {
    const fixed = { billing_mode: 'ratio', quota_type: 1, model_price: 0.07 }
    const estimate = estimateImageCost({ ...input, n: 3 }, pricing(fixed, 2))
    expect(estimate?.minUSD).toBeCloseTo(0.42)
    expect(estimate?.maxUSD).toBeCloseTo(0.42)
    expect(estimate?.scope).toBe('request')
    expect(
      estimateImageCost(input, pricing({ ...fixed, quota_type: 0 }))
    ).toBeNull()
    expect(
      estimateImageCost(input, pricing({ ...fixed, billing_mode: 'unknown' }))
    ).toBeNull()
    expect(
      estimateImageCost(
        { ...input, model: 'dall-e-3' },
        pricing({ ...fixed, model_name: 'dall-e-3' })
      )
    ).toBeNull()
  })
})

describe('pricing availability and zero values', () => {
  it('retains explicit zero prices and a zero effective default-group ratio', () => {
    expect(
      estimateImageCost(input, pricing({ billing_expr: 'tier("free", c * 0)' }))
        ?.minUSD
    ).toBe(0)
    expect(
      estimateImageCost(
        input,
        pricing({ billing_expr: 'tier("free", fixed(0))' })
      )?.minUSD
    ).toBe(0)
    expect(
      estimateImageCost(
        input,
        pricing({ billing_mode: 'ratio', quota_type: 1, model_price: 0 })
      )?.minUSD
    ).toBe(0)
    expect(estimateImageCost(input, pricing({}, 0))?.minUSD).toBe(0)
  })

  it('requires current-user default-group pricing and exact enabled model metadata', () => {
    expect(
      estimateImageCost(input, { ...pricing(), success: false })
    ).toBeNull()
    expect(estimateImageCost(input, { ...pricing(), data: [] })).toBeNull()
    expect(
      estimateImageCost(input, { ...pricing(), group_ratio: {} })
    ).toBeNull()
    expect(
      estimateImageCost(input, {
        ...pricing(),
        group_ratio: undefined,
      } as unknown as PricingData)
    ).toBeNull()
    expect(
      estimateImageCost(input, pricing({ enable_groups: ['vip'] }))
    ).toBeNull()
    expect(estimateImageCost(input, pricing({ billing_expr: '' }))).toBeNull()
    expect(
      estimateImageCost(
        input,
        pricing({
          billing_mode: 'ratio',
          quota_type: 1,
          model_price: undefined,
        })
      )
    ).toBeNull()
  })

  it.each([-1, Infinity, Number.NaN])(
    'rejects an invalid group multiplier or fixed price: %s',
    (value) => {
      expect(estimateImageCost(input, pricing({}, value))).toBeNull()
      expect(
        estimateImageCost(
          input,
          pricing({ billing_mode: 'ratio', quota_type: 1, model_price: value })
        )
      ).toBeNull()
    }
  )

  it('returns unavailable when valid individual prices would overflow the final amount', () => {
    expect(
      estimateImageCost(
        { ...input, n: 4 },
        pricing(
          {
            billing_mode: 'ratio',
            quota_type: 1,
            model_price: Number.MAX_VALUE,
          },
          Number.MAX_VALUE
        )
      )
    ).toBeNull()
  })
})
