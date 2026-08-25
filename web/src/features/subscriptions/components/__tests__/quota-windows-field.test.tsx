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

import type { PlanFormValues } from '../../lib/plan-form'

const domWindow = new Window()
const domGlobals = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'HTMLElement',
  'HTMLButtonElement',
  'HTMLInputElement',
  'SVGElement',
  'Node',
  'Element',
  'Event',
  'PointerEvent',
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
const { FormProvider, useForm, useWatch } = await import('react-hook-form')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { PLAN_FORM_DEFAULTS } = await import('../../lib/plan-form')
const { QuotaWindowsField } = await import('../quota-windows-field')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})

const reactTestGlobals = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactTestGlobals.IS_REACT_ACT_ENVIRONMENT = true

function Harness() {
  const form = useForm<PlanFormValues>({ defaultValues: PLAN_FORM_DEFAULTS })
  const quotaWindows = useWatch({
    control: form.control,
    name: 'quota_windows',
  })

  return (
    <I18nextProvider i18n={i18n}>
      <FormProvider {...form}>
        <QuotaWindowsField />
        <output data-testid='quota-windows-state'>
          {JSON.stringify(quotaWindows)}
        </output>
      </FormProvider>
    </I18nextProvider>
  )
}

function readQuotaWindows(
  container: ParentNode
): PlanFormValues['quota_windows'] {
  const output = container.querySelector<HTMLOutputElement>(
    '[data-testid="quota-windows-state"]'
  )
  assert.ok(output)
  return JSON.parse(
    output.textContent || '[]'
  ) as PlanFormValues['quota_windows']
}

describe('subscription quota windows field', () => {
  after(() => {
    domWindow.close()
  })

  test('restricts an added window quota to positive integers', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => root.render(<Harness />))

    const addButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Add window')
    )
    assert.ok(addButton)
    await act(async () => addButton.click())

    const quotaInput = container.querySelector<HTMLInputElement>(
      'input[type="number"][min][step]'
    )
    assert.ok(quotaInput)
    assert.equal(quotaInput.min, '1')
    assert.equal(quotaInput.step, '1')

    await act(async () => root.unmount())
    container.remove()
  })

  test('adds the 5-hour and weekly defaults, enforces two windows, and reuses a free key after deletion', async () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => root.render(<Harness />))

    const addButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Add window')
    )
    assert.ok(addButton)
    assert.equal(addButton.disabled, false)

    await act(async () => addButton.click())
    assert.deepEqual(readQuotaWindows(container), [
      {
        key: 'window_1',
        name: '5-hour window',
        period_unit: 'hour',
        period_value: 5,
        amount_total: 0,
      },
    ])

    await act(async () => addButton.click())
    assert.deepEqual(
      readQuotaWindows(container).map((window) => window.key),
      ['window_1', 'window_2']
    )
    assert.equal(readQuotaWindows(container)[1].period_unit, 'week')
    assert.equal(addButton.disabled, true)

    const deleteButtons = container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="Delete window"]'
    )
    assert.equal(deleteButtons.length, 2)
    await act(async () => deleteButtons[0].click())
    assert.equal(addButton.disabled, false)

    await act(async () => addButton.click())
    assert.deepEqual(
      readQuotaWindows(container).map((window) => window.key),
      ['window_2', 'window_1']
    )
    assert.equal(addButton.disabled, true)

    await act(async () => root.unmount())
    container.remove()
  })
})
