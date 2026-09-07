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

export const serviceStatusSettingsSchema = z.object({
  groups: z
    .array(
      z.object({
        group: z.string().min(1).max(64),
        description: z.string().optional(),
        hidden: z.boolean(),
        models: z
          .array(
            z.object({ model: z.string().min(1).max(255), hidden: z.boolean() })
          )
          .max(10000),
      })
    )
    .max(1000),
})

export type ServiceStatusSettings = z.infer<typeof serviceStatusSettingsSchema>
