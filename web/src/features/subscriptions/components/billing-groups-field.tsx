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
import type { UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { MultiSelect } from '@/components/multi-select'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Switch } from '@/components/ui/switch'

import type { PlanFormValues } from '../lib/plan-form'

export function BillingGroupsField(props: {
  form: UseFormReturn<PlanFormValues>
  groups: string[]
}) {
  const { t } = useTranslation()
  const restricted = props.form.watch('restrict_groups')
  return (
    <div className='flex flex-col gap-3'>
      <FormField
        control={props.form.control}
        name='restrict_groups'
        render={({ field }) => (
          <FormItem className='flex flex-row items-center justify-between gap-3'>
            <div className='flex flex-col gap-1'>
              <FormLabel>{t('Restrict subscription billing groups')}</FormLabel>
              <FormDescription>
                {t(
                  'Only selected groups can use this plan. Other groups use wallet balance. Applies to existing subscriptions on future requests.'
                )}
              </FormDescription>
            </div>
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
          </FormItem>
        )}
      />
      {restricted ? (
        <FormField
          control={props.form.control}
          name='billing_groups'
          render={({ field }) => (
            <FormItem>
              <FormLabel required>{t('Applicable Groups')}</FormLabel>
              <FormControl>
                <MultiSelect
                  options={props.groups
                    .filter((group) => group !== 'auto')
                    .map((group) => ({ label: group, value: group }))}
                  selected={field.value}
                  onChange={field.onChange}
                  placeholder={t('Select groups')}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : (
        <p className='text-muted-foreground text-sm'>
          {t('All accessible groups')}
        </p>
      )}
    </div>
  )
}
