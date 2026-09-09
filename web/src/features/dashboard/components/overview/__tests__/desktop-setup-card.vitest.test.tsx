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
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'

import { DesktopSetupCard } from '../desktop-setup-card'

afterEach(cleanup)

it('links directly to the tool website and is keyboard accessible', async () => {
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en, zh } })
  render(
    <I18nextProvider i18n={i18n}>
      <DesktopSetupCard />
    </I18nextProvider>
  )

  const card = screen.getByRole('region', { name: 'CodexBei' })
  expect(within(card).getAllByRole('link')).toHaveLength(1)
  expect(
    within(card).queryByRole('button', { name: 'One-click setup' })
  ).toBeNull()
  await userEvent.tab()
  expect(document.activeElement).toBe(
    screen.getByRole('link', { name: 'Download setup tool' })
  )
  const link = screen.getByRole('link', { name: 'Download setup tool' })
  expect(link.getAttribute('href')).toBe('https://codexbei.beiapi.cn/')
  expect(link.getAttribute('target')).toBe('_blank')
  expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  expect(within(card).queryByRole('combobox')).toBeNull()
})

it('lists three automatic setup features as plain text and uses a full-width download button', async () => {
  const i18n = createInstance()
  await i18n.init({ lng: 'zh', resources: { en, zh } })
  render(
    <I18nextProvider i18n={i18n}>
      <DesktopSetupCard />
    </I18nextProvider>
  )

  expect(
    screen.getByText(
      zh.translation[
        'Choose your model. CodexBei configures the connection and API key for you.'
      ]
    )
  ).toBeTruthy()
  const preview = screen.getByRole('img', {
    name: zh.translation['CodexBei setup preview'],
  })
  expect(within(preview).getByText('Claude Code')).toBeTruthy()
  expect(within(preview).queryByText(zh.translation['Coming soon'])).toBeNull()
  expect(
    within(preview).queryByText(zh.translation['Choose a model'])
  ).toBeNull()
  const features = within(preview).getAllByRole('listitem', { hidden: true })
  expect(features.map((item) => item.textContent)).toEqual([
    zh.translation['API connection address filled automatically'],
    zh.translation['API key filled automatically'],
    zh.translation['Best configuration applied automatically'],
  ])
  for (const feature of features) {
    expect(
      [...feature.classList].some((name) => name.startsWith('rounded-'))
    ).toBe(false)
  }
  expect(
    preview.querySelector(
      'button, select, input, [role="combobox"], [tabindex]'
    )
  ).toBeNull()
  expect(
    screen
      .getByRole('region', { name: 'CodexBei' })
      .classList.contains('min-w-0')
  ).toBe(true)
  const download = screen.getByRole('link', {
    name: zh.translation['Download setup tool'],
  })
  expect(download.classList.contains('w-full')).toBe(true)
})
