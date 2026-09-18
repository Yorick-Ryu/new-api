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
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it, vi } from 'vitest'

import type { BanEvent } from '../api'
import { BanRecordAction } from '../ban-record-action'

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
afterEach(cleanup)

const event: BanEvent = {
  id: 1,
  user_id: 405,
  user_status: 2,
  created_at: 1,
  request_id: '',
  channel_id: 1,
  model: '',
  version: '',
  action: 'banned',
  reason: '',
  rules: '[]',
  error_summary: '',
  http_status: 400,
  ban_lifted: false,
  can_unban: true,
  lifted_at: null,
  lifted_by: null,
}

it('keeps a lifted record closed when the same user is banned again', () => {
  render(
    <I18nextProvider i18n={i18n}>
      <BanRecordAction
        event={{ ...event, ban_lifted: true, can_unban: false }}
        pending={false}
        pendingEventId={undefined}
        onUnban={vi.fn()}
      />
      <BanRecordAction
        event={{ ...event, id: 2 }}
        pending={false}
        pendingEventId={undefined}
        onUnban={vi.fn()}
      />
    </I18nextProvider>
  )
  expect(screen.getByText('Ban lifted')).toBeTruthy()
  expect(screen.getAllByRole('button', { name: 'Lift ban' })).toHaveLength(1)
})

it('submits the selected event rather than just the user and blocks repeat clicks while pending', async () => {
  const onUnban = vi.fn()
  const user = userEvent.setup()
  const view = render(
    <I18nextProvider i18n={i18n}>
      <BanRecordAction
        event={event}
        pending={false}
        pendingEventId={undefined}
        onUnban={onUnban}
      />
    </I18nextProvider>
  )
  await user.click(screen.getByRole('button', { name: 'Lift ban' }))
  expect(onUnban).toHaveBeenCalledWith(event)
  view.rerender(
    <I18nextProvider i18n={i18n}>
      <BanRecordAction
        event={event}
        pending
        pendingEventId={1}
        onUnban={onUnban}
      />
    </I18nextProvider>
  )
  expect(
    (
      screen.getByRole('button', {
        name: 'Lifting ban...',
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
})

it('does not offer an action for an already-disabled observation or a deleted user', () => {
  render(
    <I18nextProvider i18n={i18n}>
      <BanRecordAction
        event={{ ...event, action: 'already_disabled', can_unban: false }}
        pending={false}
        pendingEventId={undefined}
        onUnban={vi.fn()}
      />
      <BanRecordAction
        event={{ ...event, user_status: null, can_unban: false }}
        pending={false}
        pendingEventId={undefined}
        onUnban={vi.fn()}
      />
    </I18nextProvider>
  )
  expect(screen.queryByRole('button')).toBeNull()
})
