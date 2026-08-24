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
import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'

import { Window } from 'happy-dom'

import type { PlanRecord } from '../../../types'

const domWindow = new Window()
const domGlobals = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'HTMLElement',
  'HTMLButtonElement',
  'SVGElement',
  'Node',
  'Element',
  'Event',
  'MouseEvent',
  'PointerEvent',
  'KeyboardEvent',
  'FocusEvent',
  'CustomEvent',
  'MutationObserver',
  'ResizeObserver',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
] as const

for (const key of domGlobals) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: domWindow[key],
  })
}

const mediaQuery = domWindow.matchMedia('(max-width: 640px)')
Object.defineProperty(mediaQuery, 'matches', {
  configurable: true,
  value: false,
})
Object.defineProperty(domWindow, 'matchMedia', {
  configurable: true,
  value: () => mediaQuery,
})

const { act, useEffect } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } =
  await import('@tanstack/react-query')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { SubscriptionsProvider, useSubscriptions } =
  await import('../../subscriptions-provider')
const { ResetSubscriptionsDialog } =
  await import('../reset-subscriptions-dialog')

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})

const planRecord: PlanRecord = {
  plan: {
    id: 1,
    title: 'Dual window',
    price_amount: 10,
    currency: 'USD',
    duration_unit: 'month',
    duration_value: 1,
    quota_reset_period: 'never',
    enabled: true,
    sort_order: 0,
    allow_balance_pay: true,
    allow_wallet_overflow: true,
    max_purchase_per_user: 0,
    total_amount: 10_000,
    quota_windows: JSON.stringify([
      {
        key: 'weekly',
        name: 'Weekly window',
        period_unit: 'week',
        period_value: 1,
        amount_total: 1000,
      },
    ]),
  },
}

function OpenResetDialog() {
  const subscriptions = useSubscriptions()

  useEffect(() => {
    subscriptions.setCurrentRow(planRecord)
    subscriptions.setOpen('reset-subscriptions')
  }, [subscriptions])

  return <ResetSubscriptionsDialog />
}

function findSelectItem(label: string): HTMLElement {
  const item = [
    ...document.querySelectorAll<HTMLElement>('[data-slot="select-item"]'),
  ].find((candidate) => candidate.textContent?.includes(label))
  assert.ok(item)
  return item
}

describe('reset subscription quota window selection', () => {
  after(() => {
    domWindow.close()
  })

  test('disables schedule advancement for a specific rolling window and enables it for all windows', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    queryClient.setQueryData(['system-options'], { data: [] })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <I18nextProvider i18n={i18n}>
            <SubscriptionsProvider>
              <OpenResetDialog />
            </SubscriptionsProvider>
          </I18nextProvider>
        </QueryClientProvider>
      )
    })
    const advanceSwitch = document.querySelector<HTMLElement>(
      '[data-slot="switch"]'
    )
    const selectTrigger = document.querySelector<HTMLButtonElement>(
      'button[data-slot="select-trigger"]'
    )
    assert.ok(advanceSwitch)
    assert.ok(selectTrigger)
    assert.equal(advanceSwitch.hasAttribute('data-disabled'), false)

    await act(async () => selectTrigger.click())
    await act(async () => findSelectItem('Weekly window').click())
    assert.equal(advanceSwitch.hasAttribute('data-disabled'), true)

    await act(async () => selectTrigger.click())
    await act(async () => findSelectItem('All quota windows').click())
    assert.equal(advanceSwitch.hasAttribute('data-disabled'), false)

    await act(async () => root.unmount())
    container.remove()
    queryClient.clear()
  })
})
