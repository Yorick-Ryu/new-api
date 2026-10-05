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
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import type { Message } from '../../../types'
import { MessageActions } from '../message-actions'

it('omits editing from assistant buttons and mobile menu while keeping other actions', async () => {
  const user = userEvent.setup()
  render(
    <MessageActions
      message={{
        key: 'answer',
        from: 'assistant',
        versions: [{ id: 'v1', content: 'AI answer' }],
      }}
      onEdit={vi.fn()}
      onRegenerate={vi.fn()}
      onDelete={vi.fn()}
      onToggleSource={vi.fn()}
    />
  )
  expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Open menu' }))
  const menu = screen.getByRole('menu')
  expect(
    within(menu).queryByRole('menuitem', { name: 'Edit' })
  ).not.toBeInTheDocument()
  expect(
    within(menu).getByRole('menuitem', { name: 'Delete' })
  ).toBeInTheDocument()
})

it('keeps editing user messages by keyboard and in the mobile menu', async () => {
  const user = userEvent.setup()
  const onEdit = vi.fn()
  const message: Message = {
    key: 'question',
    from: 'user',
    versions: [{ id: 'v1', content: 'My question' }],
  }
  const view = render(<MessageActions message={message} onEdit={onEdit} />)
  screen.getByRole('button', { name: 'Edit' }).focus()
  await user.keyboard('{Enter}')
  expect(onEdit).toHaveBeenCalledWith(message)
  await user.click(screen.getByRole('button', { name: 'Open menu' }))
  await user.click(screen.getByRole('menuitem', { name: 'Edit' }))
  expect(onEdit).toHaveBeenCalledTimes(2)
  view.rerender(
    <MessageActions message={message} onEdit={onEdit} isGenerating />
  )
  expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled()
})
