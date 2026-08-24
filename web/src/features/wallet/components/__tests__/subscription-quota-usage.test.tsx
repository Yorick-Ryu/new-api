/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or (at your
option) any later version.

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

import zh from '@/i18n/locales/zh.json'

const domWindow = new Window()
const domGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'SVGElement',
  'Node',
  'Element',
  'Event',
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

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { SubscriptionQuotaUsage } = await import('../subscription-quota-usage')

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'zh',
  resources: { zh },
})

describe('subscription quota usage', () => {
  after(() => {
    domWindow.close()
  })

  test('renders primary and additional windows with the same usage layout', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <I18nextProvider i18n={i18n}>
          <SubscriptionQuotaUsage
            label='5 小时额度'
            amountUsed={0}
            amountTotal={10_000_000}
            nextResetTime={1_788_000_000}
            isActive
          />
          <SubscriptionQuotaUsage
            label='每周额度'
            amountUsed={0}
            amountTotal={150_000_000}
            nextResetTime={1_788_604_800}
            isActive
          />
        </I18nextProvider>
      )
    })

    const rows = container.querySelectorAll(
      '[data-slot="subscription-quota-usage"]'
    )
    assert.equal(rows.length, 2)
    assert.match(rows[0].textContent || '', /5 小时额度.*0%/s)
    assert.match(rows[1].textContent || '', /每周额度.*0%/s)
    assert.doesNotMatch(rows[1].textContent || '', /1 周/)
    assert.match(rows[0].textContent || '', /下次重置/)
    assert.doesNotMatch(container.textContent || '', /下一次重置/)
    assert.equal(rows[1].classList.contains('border-t'), false)
    assert.equal(container.querySelectorAll('[role="progressbar"]').length, 2)

    await act(async () => root.unmount())
    container.remove()
  })
})
