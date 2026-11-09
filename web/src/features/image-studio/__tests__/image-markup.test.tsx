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
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { ImageMarkup } from '../components/image-markup'

const context = {
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  ellipse: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  drawImage: vi.fn(),
}
const reference = { id: 'source', name: 'First reference', url: 'blob:source' }
beforeEach(() => {
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'markup-test', role: 1 })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    (callback) => callback(new Blob(['png'], { type: 'image/png' }))
  )
})
afterEach(() => {
  cleanup()
  useAuthStore.getState().auth.setUser(null)
  vi.restoreAllMocks()
  vi.clearAllMocks()
})
async function openCanvas(width = 400, height = 300) {
  fireEvent.click(screen.getByRole('button', { name: 'Mark areas to edit' }))
  const image = await screen.findByRole('img', { name: 'First reference' })
  Object.defineProperties(image, {
    naturalWidth: { value: width },
    naturalHeight: { value: height },
  })
  fireEvent.load(image)
  return screen.getByRole('img', { name: 'Image markup canvas' })
}
describe('Image markup', () => {
  it('exports a separate overlay and normalized original after keyboard drawing, undo and clear', async () => {
    const apply = vi.fn()
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValueOnce({
        data: { success: true, data: { id: 'normalized-source' } },
      })
      .mockResolvedValueOnce({
        data: { success: true, data: { id: 'overlay' } },
      })
    render(
      <ImageMarkup
        reference={reference}
        value={null}
        disabled={false}
        onBusyChange={vi.fn()}
        onApply={apply}
        onClear={vi.fn()}
      />
    )
    const canvas = await openCanvas()
    expect(screen.getByRole('button', { name: 'Apply markup' })).toBeDisabled()
    fireEvent.keyDown(canvas, { key: 'ArrowRight' })
    fireEvent.keyDown(canvas, { key: ' ' })
    expect(screen.getByRole('button', { name: 'Apply markup' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByRole('button', { name: 'Apply markup' })).toBeDisabled()
    fireEvent.keyDown(canvas, { key: ' ' })
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByRole('button', { name: 'Apply markup' })).toBeDisabled()
    fireEvent.keyDown(canvas, { key: ' ' })
    fireEvent.click(screen.getByRole('button', { name: 'Apply markup' }))
    await waitFor(() =>
      expect(apply).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'normalized-source',
          name: reference.name,
          blob: expect.any(Blob),
        }),
        expect.objectContaining({
          id: 'overlay',
          strokes: [expect.objectContaining({ circle: true })],
        })
      )
    )
    expect(post).toHaveBeenCalledTimes(2)
    for (const call of post.mock.calls) {
      expect(call[0]).toBe('/api/image-studio/references')
      expect(((call[1] as FormData).get('image') as File).type).toBe(
        'image/png'
      )
    }
    expect(context.drawImage).toHaveBeenCalledTimes(1)
  })
  it('draws on the correctly scaled source coordinates with pointer input', async () => {
    render(
      <ImageMarkup
        reference={reference}
        value={null}
        disabled={false}
        onBusyChange={vi.fn()}
        onApply={vi.fn()}
        onClear={vi.fn()}
      />
    )
    const canvas = await openCanvas()
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 150,
      width: 200,
      height: 150,
      toJSON: () => ({}),
    })
    canvas.setPointerCapture = vi.fn()
    fireEvent.pointerDown(canvas, {
      pointerId: 1,
      button: 0,
      clientX: 20,
      clientY: 30,
    })
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 80, clientY: 90 })
    fireEvent.pointerUp(canvas, { pointerId: 1 })
    expect(screen.getByRole('button', { name: 'Apply markup' })).toBeEnabled()
    expect(context.ellipse).toHaveBeenLastCalledWith(
      100,
      120,
      60,
      60,
      0,
      0,
      Math.PI * 2
    )
  })

  it('keeps the original selection and editor when upload fails', async () => {
    const apply = vi.fn()
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({
        data: { success: false, message: 'Upload unavailable' },
      })
    render(
      <ImageMarkup
        reference={reference}
        value={null}
        disabled={false}
        onBusyChange={vi.fn()}
        onApply={apply}
        onClear={vi.fn()}
      />
    )
    const canvas = await openCanvas()
    fireEvent.keyDown(canvas, { key: ' ' })
    fireEvent.click(screen.getByRole('button', { name: 'Apply markup' }))
    await waitFor(() => expect(post).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Apply markup' })).toBeEnabled()
    )
    expect(apply).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
  it('rejects oversized images before drawing or uploading', async () => {
    const post = vi.spyOn(api, 'post')
    render(
      <ImageMarkup
        reference={reference}
        value={null}
        disabled={false}
        onBusyChange={vi.fn()}
        onApply={vi.fn()}
        onClear={vi.fn()}
      />
    )
    await openCanvas(5000, 5000)
    expect(
      screen.getByText('Markup images must have at most 16,777,216 pixels')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply markup' })).toBeDisabled()
    expect(post).not.toHaveBeenCalled()
  })
  it('disables editing and removal while the parent submits', () => {
    render(
      <ImageMarkup
        reference={reference}
        value={{ id: 'markup', strokes: [] }}
        disabled
        onBusyChange={vi.fn()}
        onApply={vi.fn()}
        onClear={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Edit markup' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove markup' })).toBeDisabled()
  })
})
