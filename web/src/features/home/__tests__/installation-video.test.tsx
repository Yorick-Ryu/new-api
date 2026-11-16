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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { InstallationVideo } from '../components/installation-video'

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})

describe('installation video chapters', () => {
  test('clicking a chapter before metadata seeks after loading without eager preloading', async () => {
    const user = userEvent.setup()
    render(<InstallationVideo />)
    const video = document.querySelector('video') as HTMLVideoElement
    expect(video).toHaveAttribute('preload', 'none')
    await user.click(
      screen.getByRole('button', {
        name: 'Jump to 39.5 seconds: configure the API',
      })
    )
    fireEvent.loadedMetadata(video)
    expect(video.currentTime).toBe(39.5)
    fireEvent.timeUpdate(video)
    expect(
      screen.getByRole('button', {
        name: 'Jump to 39.5 seconds: configure the API',
      })
    ).toHaveAttribute('aria-current', 'true')
  })
  test('a later chapter click while loading wins over an earlier click', async () => {
    const user = userEvent.setup()
    render(<InstallationVideo />)
    await user.click(
      screen.getByRole('button', {
        name: 'Jump to 3.5 seconds: download and installation',
      })
    )
    await user.click(
      screen.getByRole('button', { name: 'Jump to 53.5 seconds: get started' })
    )
    const video = document.querySelector('video') as HTMLVideoElement
    fireEvent.loadedMetadata(video)
    expect(video.currentTime).toBe(53.5)
  })
  test('an unavailable video shows a working direct-file fallback', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(
      new Error('Media unavailable')
    )
    const user = userEvent.setup()
    render(<InstallationVideo />)
    await user.click(
      screen.getByRole('button', {
        name: 'Jump to 3.5 seconds: download and installation',
      })
    )
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(
      screen.getByRole('link', { name: 'Open the video separately' })
    ).toHaveAttribute('href', 'https://assets.beiapi.cn/videos/codexbei-4k.mp4')
  })
  test('a browser play-permission denial focuses native video controls', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(
      new DOMException('Gesture required', 'NotAllowedError')
    )
    const user = userEvent.setup()
    render(<InstallationVideo />)
    const video = document.querySelector('video') as HTMLVideoElement
    video.tabIndex = 0
    await user.click(
      screen.getByRole('button', {
        name: 'Jump to 3.5 seconds: download and installation',
      })
    )
    await waitFor(() => expect(video).toHaveFocus())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
