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
import { z } from 'zod'

export const conditionSchema = z
  .object({
    id: z.string().max(64).optional(),
    field: z.enum(['code', 'message', 'violations', 'http_status']),
    operator: z.enum(['equals', 'contains', 'includes']),
    value: z.string().trim().min(1).max(1000),
  })
  .superRefine((condition, ctx) => {
    let valid = condition.operator !== 'includes'
    if (condition.field === 'violations') {
      valid = condition.operator === 'includes'
    }
    if (condition.field === 'http_status') {
      valid =
        condition.operator === 'equals' && /^[1-5]\d\d$/.test(condition.value)
    }
    if (!valid) {
      ctx.addIssue({ code: 'custom', message: 'Invalid matching condition' })
    }
  })

export const matchGroupSchema = z
  .object({
    id: z.string().min(1).max(64),
    conditions: z.array(conditionSchema).min(1).max(8),
  })
  .refine((group) => group.conditions.some((c) => c.field !== 'http_status'), {
    message: 'HTTP status alone cannot trigger a ban',
    path: ['conditions'],
  })

export const ruleSchema = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().trim().min(1).max(200),
    enabled: z.boolean(),
    reason: z.string().trim().min(1).max(500),
    match_groups: z.array(matchGroupSchema).min(1).max(16),
    channels: z.array(z.number().int().positive()).max(100),
    models: z.array(z.string().trim().min(1).max(200)).max(100),
  })
  .refine(
    (rule) =>
      new Set(rule.match_groups.map((group) => group.id)).size ===
      rule.match_groups.length,
    {
      message: 'Matching method IDs must be unique',
      path: ['match_groups'],
    }
  )

export const settingsSchema = z
  .object({
    version: z.string().min(1).max(64),
    mode: z.enum(['off', 'observe', 'ban']),
    rules: z.array(ruleSchema).max(64),
  })
  .refine(
    (settings) =>
      new Set(settings.rules.map((r) => r.id)).size === settings.rules.length,
    {
      message: 'Rule IDs must be unique',
      path: ['rules'],
    }
  )

export type BanSettings = z.infer<typeof settingsSchema>
export type BanRule = z.infer<typeof ruleSchema>
export type BanCondition = z.infer<typeof conditionSchema>
export type BanMatchGroup = z.infer<typeof matchGroupSchema>

export function newMatchGroup(): BanMatchGroup {
  return {
    id: crypto.randomUUID(),
    conditions: [
      { id: crypto.randomUUID(), field: 'code', operator: 'equals', value: '' },
    ],
  }
}

export function newRule(): BanRule {
  return {
    id: crypto.randomUUID(),
    name: '',
    enabled: true,
    reason: '',
    channels: [],
    models: [],
    match_groups: [newMatchGroup()],
  }
}
