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
import * as z from 'zod'

export const announcementSchema = z.object({
  // Match the backend's Unicode code point count, including non-BMP characters.
  content: z
    .string()
    .min(1, 'Content is required')
    .refine((value) => [...value].length <= 500, {
      message: 'Content must be at most 500 characters',
    }),
  publishDate: z.string().min(1, 'Publish date is required'),
  type: z.enum(['default', 'ongoing', 'success', 'warning', 'error']),
  popup: z.boolean(),
  extra: z
    .string()
    .refine((value) => [...value].length <= 200, {
      message: 'Extra must be at most 200 characters',
    })
    .optional(),
})

export type AnnouncementFormValues = z.infer<typeof announcementSchema>
