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
import { Plus, Trash2 } from 'lucide-react'
import { useFieldArray, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'

import type { PlanFormValues } from '../lib'

export function ModelMultipliersField() {
  const { t } = useTranslation()
  const form = useFormContext<PlanFormValues>()
  const rows = useFieldArray({
    control: form.control,
    name: 'model_multipliers',
  })

  return (
    <div className='space-y-3'>
      <div className='flex items-start justify-between gap-3'>
        <div>
          <FormLabel>{t('Subscription model group overrides')}</FormLabel>
          <FormDescription>
            {t(
              'When this subscription pays for the specified model, use this value instead of the group ratio. Other models and wallet payments keep their existing group ratios.'
            )}{' '}
            {t(
              'Changes apply to new requests on existing and future subscriptions.'
            )}
          </FormDescription>
        </div>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={rows.fields.length >= 100}
          onClick={() => rows.append({ model: '', multiplier: 2 })}
        >
          <Plus className='mr-1 h-4 w-4' />
          {t('Add model')}
        </Button>
      </div>
      {rows.fields.length > 0 ? (
        <div className='space-y-3 rounded-md border p-3'>
          <div className='grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.5rem]'>
            <FormLabel>{t('Model name')}</FormLabel>
            <FormLabel>{t('Override group ratio')}</FormLabel>
            <span aria-hidden='true' />
          </div>
          {rows.fields.map((row, index) => (
            <div
              key={row.id}
              className='grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.5rem]'
            >
              <FormField
                control={form.control}
                name={`model_multipliers.${index}.model`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className='sr-only'>{t('Model name')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder='gpt-6-astra'
                        maxLength={200}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name={`model_multipliers.${index}.multiplier`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className='sr-only'>
                      {t('Override group ratio')}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type='number'
                        min={0.001}
                        max={1000}
                        step='any'
                        onChange={(event) =>
                          field.onChange(Number(event.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type='button'
                variant='outline'
                size='icon'
                aria-label={t('Remove model multiplier')}
                onClick={() => rows.remove(index)}
              >
                <Trash2 className='h-4 w-4' />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
