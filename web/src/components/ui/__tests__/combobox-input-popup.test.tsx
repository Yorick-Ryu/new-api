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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { Dialog } from '@/components/dialog'

import { ComboboxInput } from '../combobox-input'

function ModelDialog() {
  const [open, setOpen] = useState(true)
  const [value, setValue] = useState('')
  return (
    <Dialog open={open} onOpenChange={setOpen} title='Choose a model'>
      <ComboboxInput
        aria-label='Model'
        options={[
          { value: 'alpha', label: 'Alpha' },
          { value: 'beta', label: 'Beta' },
        ]}
        value={value}
        onValueChange={setValue}
        openOnFocus={false}
        popupClassName='blur-sm'
      />
    </Dialog>
  )
}

describe('combobox input popup in a dialog', () => {
  it('escapes the translated, overflow-clipped dialog and selecting an option keeps the dialog open', async () => {
    render(<ModelDialog />)
    const user = userEvent.setup()
    const dialog = screen.getByRole('dialog', { name: 'Choose a model' })
    const input = within(dialog).getByRole('combobox', { name: 'Model' })
    await waitFor(() => expect(input).toHaveFocus())

    await user.click(input)
    const listbox = await screen.findByRole('listbox')
    expect(dialog).not.toContainElement(listbox)
    expect(input).toHaveFocus()
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(input).toHaveAttribute('aria-controls', listbox.id)
    expect(listbox.closest('.blur-sm')).not.toBeNull()

    await user.click(screen.getByRole('option', { name: 'Beta' }))
    await waitFor(() => expect(input).toHaveValue('Beta'))
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).toHaveFocus()
    expect(dialog).toBeVisible()
  })

  it('filters and selects with the keyboard, and Escape closes only the options', async () => {
    render(<ModelDialog />)
    const user = userEvent.setup()
    const input = screen.getByRole('combobox', { name: 'Model' })
    await waitFor(() => expect(input).toHaveFocus())

    await user.type(input, 'bet')
    expect(screen.getByRole('option', { name: 'Beta' })).toBeVisible()
    expect(screen.queryByRole('option', { name: 'Alpha' })).toBeNull()
    await user.keyboard('{ArrowDown}')
    expect(input).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: 'Beta' }).id
    )
    await user.keyboard('{Enter}')
    expect(input).toHaveValue('Beta')
    expect(input).toHaveAttribute('aria-expanded', 'false')

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: 'Beta' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await user.keyboard('{Escape}')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).toHaveValue('Beta')
    expect(screen.getByRole('dialog', { name: 'Choose a model' })).toBeVisible()
  })
})

describe('editable combobox popup', () => {
  it('commits a custom value and dismisses suggestions when clicking outside', async () => {
    const change = vi.fn()
    render(
      <>
        <ComboboxInput
          aria-label='Model'
          options={[{ value: 'alpha', label: 'Alpha' }]}
          onValueChange={change}
          allowCustomValue
        />
        <button type='button'>Outside</button>
      </>
    )
    const user = userEvent.setup()
    const input = screen.getByRole('combobox', { name: 'Model' })

    await user.type(input, 'custom-model')
    expect(screen.getByText('Press Enter to use "custom-model"')).toBeVisible()
    await user.keyboard('{Enter}')
    expect(change).toHaveBeenLastCalledWith('custom-model')
    expect(input).toHaveAttribute('aria-expanded', 'false')

    await user.click(input)
    expect(screen.getByRole('option', { name: 'Alpha' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Outside' }))
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
