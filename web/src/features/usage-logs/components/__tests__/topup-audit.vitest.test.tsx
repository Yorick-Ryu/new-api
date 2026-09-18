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
// @vitest-environment happy-dom
import { cleanup, render as renderUI, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it } from 'vitest'

import { usageLogSchema } from '../../data/schema'
import { DetailsDialog } from '../dialogs/details-dialog'

const queryClients: QueryClient[] = []
function render(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['status'], {})
  client.setQueryData(['pricing'], { success: true, data: [], vendors: [] })
  queryClients.push(client)
  return renderUI(ui, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  })
}
afterEach(() => {
  queryClients.splice(0).forEach((client) => client.clear())
})

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
afterEach(cleanup)

const missingAuditMessage =
  'No audit information was recorded for this transaction. Missing details cannot be recovered from this log.'

it.each(['purchase', 'renewal'])(
  'shows the standard top-up audit fields for a subscription %s',
  (operation) => {
    const log = usageLogSchema.parse({
      id: 1,
      user_id: 1,
      created_at: 1789300000,
      type: 1,
      content: `Subscription ${operation} succeeded`,
      other: JSON.stringify({
        admin_info: {
          payment_method: 'alipay',
          callback_payment_method: 'epay',
          caller_ip: '203.0.113.10',
          server_ip: '192.168.1.2',
          node_name: 'test-node',
          version: 'test-version',
        },
      }),
    })
    render(
      <I18nextProvider i18n={i18n}>
        <DetailsDialog
          open
          onOpenChange={() => {}}
          log={log}
          isAdmin
          isRoot={false}
        />
      </I18nextProvider>
    )
    expect(screen.getByText('Top-up Audit Info')).toBeTruthy()
    for (const value of [
      'alipay',
      'epay',
      '203.0.113.10',
      '192.168.1.2',
      'test-node',
      'test-version',
    ]) {
      expect(screen.getByText(value)).toBeTruthy()
    }
    expect(screen.queryByText(missingAuditMessage)).toBeNull()
  }
)

it('describes missing transaction audit data without claiming that the record is old', () => {
  const log = usageLogSchema.parse({
    id: 1,
    user_id: 1,
    created_at: 1789300000,
    type: 1,
    content: 'Subscription purchase succeeded',
    other: '',
  })
  render(
    <I18nextProvider i18n={i18n}>
      <DetailsDialog
        open
        onOpenChange={() => {}}
        log={log}
        isAdmin
        isRoot={false}
      />
    </I18nextProvider>
  )
  expect(screen.getByText(missingAuditMessage)).toBeTruthy()
  expect(screen.queryByText(/This historical record predates/)).toBeNull()
})

it('hides transaction audit fields from non-admin users', () => {
  const log = usageLogSchema.parse({
    id: 1,
    user_id: 1,
    created_at: 1789300000,
    type: 1,
    content: 'Subscription purchase succeeded',
    other: JSON.stringify({
      admin_info: { server_ip: '192.168.1.2', caller_ip: '203.0.113.10' },
    }),
  })
  render(
    <I18nextProvider i18n={i18n}>
      <DetailsDialog
        open
        onOpenChange={() => {}}
        log={log}
        isAdmin={false}
        isRoot={false}
      />
    </I18nextProvider>
  )
  expect(screen.queryByText('Top-up Audit Info')).toBeNull()
  expect(screen.queryByText('192.168.1.2')).toBeNull()
  expect(screen.queryByText('203.0.113.10')).toBeNull()
})
