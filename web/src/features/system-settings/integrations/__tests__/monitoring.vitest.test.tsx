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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it } from 'vitest'

import { MonitoringSettingsSection } from '../monitoring-settings-section'

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
})
it('only offers collection buckets fine enough for half-hour status intervals', async () => {
  const client = new QueryClient()
  clients.push(client)
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MonitoringSettingsSection
          defaultValues={{
            QuotaRemindThreshold: '1000',
            'perf_metrics_setting.enabled': true,
            'perf_metrics_setting.flush_interval': 15,
            'perf_metrics_setting.bucket_time': '30min',
            'perf_metrics_setting.retention_days': 30,
          }}
        />
      </QueryClientProvider>
    </I18nextProvider>
  )
  const bucket = screen.getByRole('combobox', { name: 'Aggregation bucket' })
  expect(bucket.textContent).toContain('30 minutes')
  await userEvent.click(bucket)
  expect(
    (await screen.findAllByRole('option')).map((option) => option.textContent)
  ).toEqual(['1 minute', '5 minutes', '30 minutes'])
  expect(screen.queryByRole('option', { name: '1 hour' })).toBeNull()
  await userEvent.click(screen.getByRole('option', { name: '5 minutes' }))
  expect(bucket.textContent).toContain('5 minutes')
})
