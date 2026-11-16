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
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { FloatingSupport } from '..'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('the standalone compact launcher explains its icon and opens support by keyboard', async () => {
  const user = userEvent.setup()
  render(<FloatingSupport />)
  const trigger = screen.getByRole('button', {
    name: 'After-sales support: scan to contact Bei on WeChat',
  })
  expect(trigger).toHaveTextContent(/^$/)
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.hover(trigger)
  expect(await screen.findByText('After-sales support')).toBeVisible()
  await user.unhover(trigger)
  trigger.focus()
  await user.keyboard('{Enter}')
  expect(
    await screen.findByRole('dialog', {
      name: 'Contact Bei · Consultation and support',
    })
  ).toBeVisible()
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await user.keyboard('{Escape}')
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  expect(trigger).toHaveFocus()
})

test('the launcher avoids its page footer and disconnects observation on unmount', () => {
  let notify: IntersectionObserverCallback | undefined
  const disconnect = vi.fn()
  const observe = vi.fn()
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        notify = callback
      }
      observe = observe
      disconnect = disconnect
    }
  )
  const view = render(
    <div>
      <FloatingSupport />
      <footer>Page footer</footer>
    </div>
  )
  const trigger = screen.getByRole('button', {
    name: 'After-sales support: scan to contact Bei on WeChat',
  })
  expect(observe).toHaveBeenCalledWith(screen.getByRole('contentinfo'))
  act(() =>
    notify?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver
    )
  )
  expect(trigger).not.toBeVisible()
  act(() =>
    notify?.(
      [{ isIntersecting: false } as IntersectionObserverEntry],
      {} as IntersectionObserver
    )
  )
  expect(trigger).toBeVisible()
  view.unmount()
  expect(disconnect).toHaveBeenCalledOnce()
})
