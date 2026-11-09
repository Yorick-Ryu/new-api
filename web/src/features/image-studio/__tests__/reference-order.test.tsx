import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { ImageReferenceOrder } from '../components/image-reference-order'
import type { ImageReference } from '../components/image-references'

const references: ImageReference[] = [
  { id: 'first', name: 'First', url: 'blob:first' },
  { id: 'second', name: 'Second', url: 'blob:second' },
  { id: 'third', name: 'Third', url: 'blob:third' },
]
function References() {
  const [value, setValue] = useState(references)
  return (
    <ImageReferenceOrder value={value} disabled={false} onChange={setValue} />
  )
}
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('reorders with arrow keys, preserves focus and stops at the first position', () => {
  render(<References />)
  const second = screen.getByRole('button', { name: 'Image Preview: Second' })
  second.focus()
  fireEvent.keyDown(second, { key: 'ArrowLeft' })
  expect(
    screen.getAllByRole('img').map((image) => image.getAttribute('alt'))
  ).toEqual(['Second', 'First', 'Third'])
  expect(second).toHaveFocus()
  fireEvent.keyDown(second, { key: 'ArrowLeft' })
  expect(screen.getAllByRole('img')[0]).toHaveAttribute('alt', 'Second')
  fireEvent.keyDown(second, { key: 'ArrowRight' })
  expect(
    screen.getAllByRole('img').map((image) => image.getAttribute('alt'))
  ).toEqual(['First', 'Second', 'Third'])
  fireEvent.click(second)
  expect(within(screen.getByRole('dialog')).getByRole('img')).toHaveAttribute(
    'alt',
    'Second'
  )
})

it.each([true, false])(
  'does not reorder a disabled or single image list (disabled: %s)',
  (disabled) => {
    const change = vi.fn()
    render(
      <ImageReferenceOrder
        value={disabled ? references : references.slice(0, 1)}
        disabled={disabled}
        onChange={change}
      />
    )
    const first = screen.getByRole('button', { name: 'Image Preview: First' })
    expect(first).not.toHaveAttribute('aria-keyshortcuts')
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(change).not.toHaveBeenCalled()
  }
)

it.each(['mouse', 'touch'])(
  'drags a thumbnail with %s without opening its preview',
  async (pointerType) => {
    class BrowserPointerEvent extends MouseEvent {
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init)
        Object.defineProperties(this, {
          pageX: { value: init.clientX ?? 0 },
          pageY: { value: init.clientY ?? 0 },
          pointerType: { value: init.pointerType ?? 'mouse' },
          isPrimary: { value: true },
        })
      }
    }
    vi.stubGlobal('PointerEvent', BrowserPointerEvent)
    vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        if (
          this.parentElement?.getAttribute('aria-label') === 'Reference images'
        ) {
          const index = [...this.parentElement.children].indexOf(this)
          return new DOMRect(index * 68, 0, 56, 56)
        }
        return new DOMRect(0, 0, 300, 60)
      }
    )
    render(<References />)
    const second = screen.getByRole('button', { name: 'Image Preview: Second' })
    await act(async () => {
      await new Promise(requestAnimationFrame)
    })
    fireEvent.pointerDown(second, {
      clientX: 90,
      clientY: 20,
      buttons: 1,
      pointerType,
    })
    fireEvent.pointerMove(window, {
      clientX: 70,
      clientY: 20,
      buttons: 1,
      pointerType,
    })
    await act(async () => {
      await new Promise(requestAnimationFrame)
    })
    fireEvent.pointerMove(window, {
      clientX: 10,
      clientY: 20,
      buttons: 1,
      pointerType,
    })
    await waitFor(() =>
      expect(screen.getAllByRole('img')[0]).toHaveAttribute('alt', 'Second')
    )
    fireEvent.pointerUp(window, { clientX: 10, clientY: 20, pointerType })
    fireEvent.click(second, { detail: 1 })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.pointerDown(second, {
      clientX: 10,
      clientY: 20,
      buttons: 1,
      pointerType,
    })
    fireEvent.pointerUp(window, { clientX: 10, clientY: 20, pointerType })
    fireEvent.click(second, { detail: 1 })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  }
)
