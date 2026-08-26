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

const domWindow = new Window()
const domGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLButtonElement',
  'HTMLInputElement',
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
const { RedeemCodeCard } = await import('../redeem-code-card')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: {
    en: {
      translation: {
        'Redeem Code': 'Redeem Code',
        'Redeem codes for account credit': 'Redeem codes for account credit',
        'Redemption Code': 'Redemption Code',
        'Enter your redemption code': 'Enter your redemption code',
        Redeem: 'Redeem',
        'Redemption codes are disabled until the administrator confirms compliance terms.':
          'Redemption codes are disabled until the administrator confirms compliance terms.',
      },
    },
  },
})

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

function createHarness(
  props: Partial<React.ComponentProps<typeof RedeemCodeCard>> = {}
) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const calls: string[] = []
  const onRedeem = async (code: string) => {
    calls.push(code)
    return true
  }

  return {
    container,
    root,
    calls,
    element: (
      <I18nextProvider i18n={i18n}>
        <RedeemCodeCard
          enabled
          redeeming={false}
          onRedeem={onRedeem}
          {...props}
        />
      </I18nextProvider>
    ),
  }
}

describe('personal redemption form', () => {
  after(() => {
    domWindow.close()
  })

  test('keeps submission disabled until a code is entered, then trims and clears a successful code', async () => {
    const harness = createHarness()
    await act(async () => harness.root.render(harness.element))

    const input =
      harness.container.querySelector<HTMLInputElement>('#redeem-code-input')
    const button = harness.container.querySelector<HTMLButtonElement>(
      'button[type="submit"]'
    )
    assert.ok(input)
    assert.ok(button)
    assert.equal(button.disabled, true)

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        domWindow.HTMLInputElement.prototype,
        'value'
      )?.set
      assert.ok(valueSetter)
      valueSetter.call(input, '  CREDIT-123  ')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    assert.equal(button.disabled, false)

    await act(async () => button.click())
    assert.deepEqual(harness.calls, ['CREDIT-123'])
    assert.equal(input.value, '')

    await act(async () => harness.root.unmount())
    harness.container.remove()
  })

  test('shows the compliance notice instead of an input when redemption is disabled', async () => {
    const harness = createHarness({ enabled: false })
    await act(async () => harness.root.render(harness.element))

    assert.equal(harness.container.querySelector('#redeem-code-input'), null)
    assert.equal(
      harness.container.querySelector('[role="alert"]') != null,
      true
    )

    await act(async () => harness.root.unmount())
    harness.container.remove()
  })
})
