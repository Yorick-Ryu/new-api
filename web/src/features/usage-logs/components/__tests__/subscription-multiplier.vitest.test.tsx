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
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it } from 'vitest'

import { formatLogQuota } from '@/lib/format'

import { usageLogSchema, type UsageLog } from '../../data/schema'
import { useCommonLogsColumns } from '../columns/common-logs-columns'
import { DetailsDialog } from '../dialogs/details-dialog'
import { LogCostDisplay } from '../log-cost-display'
import { UsageLogsProvider } from '../usage-logs-provider'

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
afterEach(cleanup)

function LogList(props: { log: UsageLog }) {
  const columns = useCommonLogsColumns(false).filter(
    (column) =>
      'accessorKey' in column &&
      ['token_name', 'quota'].includes(column.accessorKey as string)
  )
  const table = useReactTable({
    data: [props.log],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })
  return (
    <table>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id}>
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

it('shows the group name and subscription label without ratio suffixes in the log list', () => {
  const log = usageLogSchema.parse({
    id: 1,
    user_id: 1,
    created_at: 1789144580,
    type: 2,
    content: '',
    group: 'default',
    token_name: 'test-token',
    other: JSON.stringify({
      billing_source: 'subscription',
      group_ratio: 2,
      subscription_group_ratio: 2,
    }),
  })
  render(
    <I18nextProvider i18n={i18n}>
      <UsageLogsProvider>
        <LogList log={log} />
      </UsageLogsProvider>
    </I18nextProvider>
  )
  expect(screen.getByText('default')).toBeTruthy()
  expect(screen.getByText('Subscription')).toBeTruthy()
  expect(screen.getByRole('row').textContent).not.toMatch(/2[x×]/)
})

it('shows a plain subscription badge and the actual deducted quota for legacy multipliers', async () => {
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
  expect(screen.queryByText('Subscription 2×')).toBeNull()
  await user.hover(screen.getByText('Subscription'))
  const tooltip = await screen.findByText(
    `Deducted by subscription: ${formatLogQuota(250)}`
  )
  expect(tooltip.textContent).toContain(formatLogQuota(250))
})

it.each([1, 2, 0.5])(
  'keeps the subscription badge plain for an override of %s',
  (ratio) => {
    render(
      <I18nextProvider i18n={i18n}>
        <LogCostDisplay
          quota={100}
          other={{
            billing_source: 'subscription',
            subscription_group_ratio: ratio,
            subscription_consumed: 100,
          }}
        />
      </I18nextProvider>
    )
    expect(screen.getByText('Subscription')).toBeTruthy()
    expect(screen.queryByText(`Subscription ${ratio}×`)).toBeNull()
  }
)

it.each([
  { group: 1, override: 2 },
  { group: 3, override: 0.5 },
  { group: 0, override: 2 },
])(
  'shows original group $group separately from subscription consumption $override',
  (ratios) => {
    const log = usageLogSchema.parse({
      id: 1,
      user_id: 1,
      created_at: 1789144580,
      type: 2,
      content: '',
      quota: 1074,
      other: JSON.stringify({
        billing_source: 'subscription',
        group_ratio: ratios.override,
        subscription_group_ratio: ratios.override,
        subscription_original_group_ratio: ratios.group,
        subscription_consumed: 1074,
      }),
    })
    render(
      <I18nextProvider i18n={i18n}>
        <DetailsDialog log={log} isAdmin={false} open onOpenChange={() => {}} />
      </I18nextProvider>
    )
    expect(
      screen.getByText('Group Ratio').parentElement?.textContent
    ).toContain(`${ratios.group.toFixed(4)}x`)
    expect(
      screen.getByText('Consumption multiplier').parentElement?.textContent
    ).toContain(`${ratios.override}×`)
    expect(screen.queryByText('Override group ratio')).toBeNull()
    expect(
      screen.getByText('Final Consumed').parentElement?.textContent
    ).toContain(formatLogQuota(1074))
  }
)

it('does not present a historical subscription override as the original group ratio when its snapshot is absent', () => {
  const log = usageLogSchema.parse({
    id: 1,
    user_id: 1,
    created_at: 1789144580,
    type: 2,
    content: '',
    other: JSON.stringify({
      billing_source: 'subscription',
      group_ratio: 2,
      subscription_group_ratio: 2,
    }),
  })
  render(
    <I18nextProvider i18n={i18n}>
      <DetailsDialog log={log} isAdmin={false} open onOpenChange={() => {}} />
    </I18nextProvider>
  )
  expect(screen.queryByText('Group Ratio')).toBeNull()
  expect(
    screen.getByText('Consumption multiplier').parentElement?.textContent
  ).toContain('2×')
})
