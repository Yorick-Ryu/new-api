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
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it } from 'vitest'

import zh from '@/i18n/locales/zh.json'

import { usageLogSchema, type UsageLog } from '../../data/schema'
import { useCommonLogsColumns } from '../columns/common-logs-columns'
import { DetailsDialog } from '../dialogs/details-dialog'
import { UsageLogsMobileList } from '../usage-logs-mobile-card'
import { UsageLogsProvider } from '../usage-logs-provider'

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: {} }, zh } })
afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

function LogList(props: { log: UsageLog; mobile: boolean }) {
  const columns = useCommonLogsColumns(false).filter(
    (column) =>
      'accessorKey' in column &&
      ['model_name', 'created_at'].includes(column.accessorKey as string)
  )
  const table = useReactTable({
    data: [props.log],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })
  if (props.mobile) {
    return <UsageLogsMobileList table={table} logCategory='common' />
  }
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

function responseModelLog(): UsageLog {
  return usageLogSchema.parse({
    id: 1,
    user_id: 1,
    created_at: 1789690000,
    type: 2,
    content: '',
    model_name: 'requested',
    prompt_tokens: 2,
    completion_tokens: 3,
    quota: 20,
    other: JSON.stringify({
      model_ratio: 1,
      group_ratio: 1,
      completion_ratio: 1,
      is_model_mapped: true,
      upstream_model_name: 'mapped',
      response_model: {
        requested_model: 'requested',
        upstream_model: 'mapped',
        returned_model: 'returned',
        mismatch: true,
      },
    }),
  })
}

it.each([false, true])(
  'exposes response-model diagnostics from the real log columns (mobile=%s)',
  async (mobile) => {
    const user = userEvent.setup()
    render(
      <I18nextProvider i18n={i18n}>
        <UsageLogsProvider>
          <LogList log={responseModelLog()} mobile={mobile} />
        </UsageLogsProvider>
      </I18nextProvider>
    )
    const trigger = screen.getByRole('button', {
      name: 'Model: requested, Response model: returned',
    })
    await user.click(trigger)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('returned')).toBeTruthy()
    expect(within(dialog).getByText('mapped')).toBeTruthy()
  }
)

it('shows translated response-model details in the existing log details dialog', async () => {
  await i18n.changeLanguage('zh')
  render(
    <I18nextProvider i18n={i18n}>
      <DetailsDialog
        log={responseModelLog()}
        isAdmin={false}
        open
        onOpenChange={() => {}}
      />
    </I18nextProvider>
  )
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('响应模型')).toBeTruthy()
  expect(within(dialog).getByText('上游请求模型')).toBeTruthy()
  expect(within(dialog).getByText('响应模型：returned')).toBeTruthy()
  expect(within(dialog).getByText('returned')).toBeTruthy()
})
