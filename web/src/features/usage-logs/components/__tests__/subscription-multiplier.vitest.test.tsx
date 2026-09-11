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
import { afterEach, expect, it } from 'vitest'

import { formatLogQuota } from '@/lib/format'

import { LogCostDisplay } from '../log-cost-display'

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
afterEach(cleanup)

it('shows the subscription multiplier and actual deducted quota instead of base cost', async () => {
  const user = userEvent.setup()
  render(
    <I18nextProvider i18n={i18n}>
      <LogCostDisplay
        quota={125}
        other={{
          billing_source: 'subscription',
          subscription_model_multiplier: 2,
          subscription_consumed: 250,
        }}
      />
    </I18nextProvider>
  )
  await user.hover(screen.getByText('Subscription 2×'))
  const tooltip = await screen.findByText(
    `Deducted by subscription: ${formatLogQuota(250)}`
  )
  expect(tooltip.textContent).toContain(formatLogQuota(250))
})
