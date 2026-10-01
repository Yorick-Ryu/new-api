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
import { readTokenTierChain } from '@/features/pricing/lib/billing-expression/display'
import { compileBillingExpression } from '@/features/pricing/lib/billing-expression/parser'
import { evaluateBillingExpression } from '@/features/pricing/lib/billing-expression/runtime'
import {
  visitExpression,
  type CompiledBillingExpression,
} from '@/features/pricing/lib/billing-expression/types'
import type { PricingData } from '@/features/pricing/types'

import type { ImageInput } from '../api'

type EstimateInput = Pick<ImageInput, 'model' | 'size' | 'quality' | 'n'>
export type ImageCostEstimate = {
  minUSD: number
  maxUSD: number
  scope: 'output' | 'request'
  automatic: boolean
}
type TokenRange = { min: number; max: number }
type ImageQuality = 'low' | 'medium' | 'high'
const qualityGrids: Record<ImageQuality, number> = {
  low: 16,
  medium: 48,
  high: 96,
}
const qualities = Object.keys(qualityGrids) as ImageQuality[]
let automaticSizeTokens: Record<ImageQuality, TokenRange> | undefined

function validAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function automatic(value: string): boolean {
  return value === '' || value === 'auto'
}

function validSize(width: number, height: number): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width > 0 &&
    height > 0 &&
    width <= 3840 &&
    height <= 3840 &&
    width % 16 === 0 &&
    height % 16 === 0 &&
    width * height >= 655360 &&
    width * height <= 8294400 &&
    Math.max(width, height) <= 3 * Math.min(width, height)
  )
}

// OpenAI's public GPT Image 2 calculator: output tokens only, with half-even
// grid rounding. Prices remain the current administrator-configured prices.
// https://developers.openai.com/api/docs/guides/image-generation
// https://developers.openai.com/_astro/GptImageTokenCalculator.react.D3SP3zrk.js
function outputTokens(
  width: number,
  height: number,
  quality: ImageQuality
): number {
  const longGrid = qualityGrids[quality]
  const shortGrid =
    longGrid / (Math.max(width, height) / Math.min(width, height))
  const lower = Math.floor(shortGrid)
  const rounded =
    shortGrid - lower === 0.5 ? lower + (lower % 2) : Math.round(shortGrid)
  return Math.ceil((longGrid * rounded * (2000000 + width * height)) / 4000000)
}

function allSizeTokens(): Record<ImageQuality, TokenRange> {
  if (automaticSizeTokens) return automaticSizeTokens
  const ranges: Record<ImageQuality, TokenRange> = {
    low: { min: Infinity, max: 0 },
    medium: { min: Infinity, max: 0 },
    high: { min: Infinity, max: 0 },
  }
  for (let width = 16; width <= 3840; width += 16) {
    for (let height = 16; height <= 3840; height += 16) {
      if (!validSize(width, height)) continue
      for (const quality of qualities) {
        const count = outputTokens(width, height, quality)
        ranges[quality].min = Math.min(ranges[quality].min, count)
        ranges[quality].max = Math.max(ranges[quality].max, count)
      }
    }
  }
  automaticSizeTokens = ranges
  return ranges
}

function imageTokenRange(input: EstimateInput): TokenRange | null {
  const selected = automatic(input.quality)
    ? qualities
    : qualities.filter((quality) => quality === input.quality)
  if (selected.length === 0) return null
  let ranges: TokenRange[]
  if (automatic(input.size)) {
    const sizes = allSizeTokens()
    ranges = selected.map((quality) => sizes[quality])
  } else {
    if (!/^\d+x\d+$/.test(input.size)) return null
    const [width, height] = input.size.split('x').map(Number)
    if (!validSize(width, height)) return null
    ranges = selected.map((quality) => {
      const count = outputTokens(width, height, quality)
      return { min: count, max: count }
    })
  }
  return {
    min: Math.min(...ranges.map((range) => range.min)) * input.n,
    max: Math.max(...ranges.map((range) => range.max)) * input.n,
  }
}

function knownRequestContext(compiled: CompiledBillingExpression): boolean {
  if (compiled.functions.has('header')) return false
  let known = true
  visitExpression(compiled.ast, (node) => {
    if (node.kind !== 'call' || node.name !== 'param') return
    const path = node.args[0]
    if (
      path.kind !== 'literal' ||
      typeof path.value !== 'string' ||
      !['model', 'size', 'quality', 'n'].includes(path.value)
    ) {
      known = false
    }
  })
  return known
}

export function estimateImageCost(
  input: EstimateInput,
  pricing: PricingData
): ImageCostEstimate | null {
  if (!Number.isInteger(input.n) || input.n < 1 || input.n > 4) return null
  if (!pricing.success || !Array.isArray(pricing.data)) return null
  const model = pricing.data.find((entry) => entry.model_name === input.model)
  const groupRatio = pricing.group_ratio?.default
  if (!model?.enable_groups?.includes('default') || !validAmount(groupRatio)) {
    return null
  }
  const isGPTImage = input.model.startsWith('gpt-image-')
  const isGPTImage2 = /^gpt-image-2(?:-\d{4}-\d{2}-\d{2})?$/.test(input.model)
  const tokens = isGPTImage2 ? imageTokenRange(input) : null
  if (isGPTImage2 && !tokens) return null
  const isAutomatic = automatic(input.size) || automatic(input.quality)
  const result = (
    minUSD: number,
    maxUSD: number,
    scope: ImageCostEstimate['scope']
  ): ImageCostEstimate | null => {
    if (!validAmount(minUSD) || !validAmount(maxUSD)) return null
    return { minUSD, maxUSD, scope, automatic: isAutomatic }
  }

  if (model.billing_mode === 'tiered_expr') {
    if (!model.billing_expr) return null
    const compiled = compileBillingExpression(model.billing_expr)
    if (compiled.status !== 'ready') return null
    if (knownRequestContext(compiled)) {
      const body: Record<string, string | number> = {
        model: input.model,
        n: input.n,
      }
      if (input.size || isGPTImage) body.size = input.size || 'auto'
      if (input.quality || isGPTImage) body.quality = input.quality || 'auto'
      const evaluated = evaluateBillingExpression(compiled, {
        imageCount: input.n,
        request: { body },
      })
      if (
        evaluated.status === 'success' &&
        evaluated.billingUnit === 'request'
      ) {
        const cost = (evaluated.cost / 1000000) * groupRatio
        return result(cost, cost, 'request')
      }
    }
    if (!isGPTImage2 || !tokens) return null
    const tiers = readTokenTierChain(compiled.ast)
    if (
      tiers?.length !== 1 ||
      tiers[0].conditions.length > 0 ||
      tiers[0].conditionText ||
      tiers[0].imageCount ||
      tiers[0].billingUnit === 'request' ||
      compiled.requestRules.length > 0
    ) {
      return null
    }
    const prices = tiers[0].prices
    if (!Object.values(prices).every(validAmount) || !validAmount(prices.c)) {
      return null
    }
    if (prices.img_o !== undefined && prices.img_o !== prices.c) return null
    return result(
      ((tokens.min * prices.c) / 1000000) * groupRatio,
      ((tokens.max * prices.c) / 1000000) * groupRatio,
      'output'
    )
  }

  // Legacy GPT Image request pricing applies n exactly once. Its DTO has no
  // DALL·E size/quality multipliers; token-priced legacy models need usage data.
  if (model.billing_mode && model.billing_mode !== 'ratio') return null
  if (isGPTImage && model.quota_type === 1 && validAmount(model.model_price)) {
    const cost = model.model_price * input.n * groupRatio
    return result(cost, cost, 'request')
  }
  return null
}
