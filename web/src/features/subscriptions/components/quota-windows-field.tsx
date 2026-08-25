/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import type { TFunction } from 'i18next'
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getCurrencyLabel } from '@/lib/currency'

import type { PlanFormValues } from '../lib'

const periodUnits = ['hour', 'day', 'week', 'month'] as const

function getPeriodUnitLabel(unit: (typeof periodUnits)[number], t: TFunction) {
  switch (unit) {
    case 'hour':
      return t('hours')
    case 'day':
      return t('days')
    case 'week':
      return t('weeks')
    case 'month':
      return t('months')
  }
}

export function QuotaWindowsField() {
  const { t } = useTranslation()
  const currencyLabel = getCurrencyLabel()
  const form = useFormContext<PlanFormValues>()
  const windows = useFieldArray({
    control: form.control,
    name: 'quota_windows',
  })

  const addWindow = () => {
    const existingKeys = new Set(
      form.getValues('quota_windows').map((window) => window.key)
    )
    let index = 1
    while (existingKeys.has(`window_${index}`)) {
      index += 1
    }
    windows.append({
      key: `window_${index}`,
      name: index === 1 ? t('5-hour window') : t('Weekly window'),
      period_unit: index === 1 ? 'hour' : 'week',
      period_value: index === 1 ? 5 : 1,
      amount_total: 0,
    })
  }

  return (
    <div className='space-y-3'>
      <div className='flex items-start justify-between gap-3'>
        <div>
          <FormLabel>{t('Additional quota windows')}</FormLabel>
          <FormDescription>
            {t(
              'Each request consumes the main quota and every additional window. Reaching any limit stops subscription usage.'
            )}
            <span className='mt-1 block'>
              {t(
                'Additional windows reset on rolling periods anchored to the subscription start time.'
              )}
            </span>
          </FormDescription>
        </div>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={windows.fields.length >= 2}
          onClick={addWindow}
        >
          <Plus className='mr-1 h-4 w-4' />
          {t('Add window')}
        </Button>
      </div>

      {windows.fields.map((window, index) => (
        <div
          key={window.id}
          className='grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-2'
        >
          <FormField
            control={form.control}
            name={`quota_windows.${index}.name`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Window name')}</FormLabel>
                <FormControl>
                  <Input {...field} maxLength={64} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name={`quota_windows.${index}.amount_total`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t('Quota ({{currency}})', { currency: currencyLabel })}
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type='number'
                    min={1}
                    step={1}
                    onChange={(event) =>
                      field.onChange(Number.parseFloat(event.target.value) || 0)
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name={`quota_windows.${index}.period_value`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Period value')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type='number'
                    min={1}
                    step={1}
                    onChange={(event) =>
                      field.onChange(
                        Number.parseInt(event.target.value, 10) || 0
                      )
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className='flex items-end gap-2'>
            <FormField
              control={form.control}
              name={`quota_windows.${index}.period_unit`}
              render={({ field }) => (
                <FormItem className='flex-1'>
                  <FormLabel>{t('Period unit')}</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    items={periodUnits.map((unit) => ({
                      value: unit,
                      label: getPeriodUnitLabel(unit, t),
                    }))}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent alignItemWithTrigger={false}>
                      <SelectGroup>
                        {periodUnits.map((unit) => (
                          <SelectItem key={unit} value={unit}>
                            {getPeriodUnitLabel(unit, t)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type='button'
              variant='outline'
              size='icon'
              aria-label={t('Delete window')}
              onClick={() => windows.remove(index)}
            >
              <Trash2 className='h-4 w-4' />
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}
