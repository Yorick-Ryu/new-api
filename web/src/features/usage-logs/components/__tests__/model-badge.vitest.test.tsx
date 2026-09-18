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
// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it } from 'vitest'

import { ModelBadge } from '../model-badge'

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
afterEach(cleanup)

it('opens requested, mapped and returned model details from the warning with the keyboard', async () => {
  const user = userEvent.setup()
  render(
    <I18nextProvider i18n={i18n}>
      <ModelBadge
        modelName='requested'
        actualModel='mapped'
        responseModel={{
          requested_model: 'requested',
          upstream_model: 'mapped',
          returned_model: 'returned',
          mismatch: true,
        }}
      />
    </I18nextProvider>
  )
  const trigger = screen.getByRole('button', {
    name: 'Model: requested, Response model: returned',
  })
  expect(screen.getByText('Response model: returned')).toBeTruthy()
  trigger.focus()
  await user.keyboard('{Enter}')
  const dialog = await screen.findByRole('dialog')
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  for (const text of [
    'Request Model',
    'Upstream Model',
    'Response Model',
    'requested',
    'mapped',
    'returned',
  ]) {
    expect(within(dialog).getByText(text)).toBeTruthy()
  }
  expect(
    within(dialog).getByText(/does not prove model substitution/)
  ).toBeTruthy()
  await user.keyboard('{Escape}')
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
})

it('shows a dated model difference in details without a mismatch warning', async () => {
  const user = userEvent.setup()
  render(
    <I18nextProvider i18n={i18n}>
      <ModelBadge
        modelName='requested'
        responseModel={{
          requested_model: 'requested',
          upstream_model: 'requested',
          returned_model: 'requested-2026-09-01',
          mismatch: false,
        }}
      />
    </I18nextProvider>
  )
  expect(screen.queryByText(/^Response model:/)).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Model: requested' }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('requested-2026-09-01')).toBeTruthy()
  expect(
    within(dialog).queryByText(/does not prove model substitution/)
  ).toBeNull()
})

it('keeps legacy model mapping details when older logs lack response metadata', async () => {
  const user = userEvent.setup()
  render(
    <I18nextProvider i18n={i18n}>
      <ModelBadge modelName='requested' actualModel='mapped' />
    </I18nextProvider>
  )
  await user.click(screen.getByRole('button', { name: 'Model: requested' }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('mapped')).toBeTruthy()
  expect(within(dialog).queryByText('Response Model')).toBeNull()
})

it('keeps unchanged model badges copyable without a redundant details trigger', () => {
  render(
    <I18nextProvider i18n={i18n}>
      <ModelBadge
        modelName='requested'
        responseModel={{
          requested_model: 'requested',
          upstream_model: 'requested',
          returned_model: 'requested',
          mismatch: false,
        }}
      />
    </I18nextProvider>
  )
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.getByTitle('Click to copy: requested')).toBeTruthy()
})
