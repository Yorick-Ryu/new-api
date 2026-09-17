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
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Download } from 'lucide-react'
import { afterEach, expect, it, vi } from 'vitest'

import { StartStepItem } from '../overview-dashboard'

afterEach(cleanup)

it('keeps each status marker centered in its own card track and preserves step actions', async () => {
  const onClick = vi.fn()
  const { container } = render(
    <ol>
      {[0, 1, 2].map((index) => (
        <StartStepItem
          key={index}
          index={index}
          isLast={index === 2}
          step={{
            title: `Step ${index + 1}`,
            description: 'Download and configure',
            icon: Download,
            completed: index === 0,
            onClick,
          }}
        />
      ))}
    </ol>
  )
  const tracks = [...container.querySelectorAll('[data-slot="step-track"]')]
  expect(tracks).toHaveLength(3)
  for (const track of tracks) {
    // A full-height track centers against the card, independently of row spacing.
    expect(track.classList.contains('self-stretch')).toBe(true)
    expect(track.classList.contains('items-center')).toBe(true)
    expect(track.querySelector('[data-slot="step-marker"]')).not.toBeNull()
  }
  expect(
    tracks.map(
      (track) => track.querySelectorAll(':scope > [aria-hidden="true"]').length
    )
  ).toEqual([1, 2, 1])
  await userEvent.click(screen.getByRole('button', { name: /Step 2/ }))
  expect(onClick).toHaveBeenCalledOnce()
})
