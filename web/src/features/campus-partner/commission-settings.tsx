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
import { zodResolver } from '@hookform/resolvers/zod'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { StaticDataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
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
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import { useCampusAction, type CampaignConfig } from './api'
import { campusAmountTypography, campusTierNameKeys } from './constants'

// Parse decimal cash/percent values into integer hundredths without float rounding.
function decimalUnits(value: string): number {
  if (!/^\d{1,14}(\.\d{1,2})?$/.test(value)) return Number.NaN
  const [whole, fraction = ''] = value.split('.')
  const units = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  return units <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(units) : Number.NaN
}

export function CampusTierSettings(props: { config: CampaignConfig }) {
  const { t } = useTranslation()
  const amount = z
    .string()
    .refine(
      (v) => Number.isSafeInteger(decimalUnits(v)),
      t('Enter a valid amount with at most two decimal places')
    )
  const rate = z.string().refine((v) => {
    const units = decimalUnits(v)
    return Number.isSafeInteger(units) && units <= 10000
  }, t('Enter a percentage from 0 to 100 with at most two decimal places'))
  const schema = z
    .object({
      tiers: z
        .array(
          z.object({
            name: z
              .string()
              .trim()
              .refine(
                (value) => [...value].length <= 80,
                t('Tier names must be at most 80 characters')
              ),
            floor: amount,
            rate,
          })
        )
        .min(1)
        .max(50),
    })
    .superRefine((values, ctx) => {
      values.tiers.forEach((tier, index) => {
        const floor = decimalUnits(tier.floor)
        const previous = index
          ? decimalUnits(values.tiers[index - 1].floor)
          : Number.NaN
        if (
          Number.isSafeInteger(floor) &&
          ((index === 0 && floor !== 0) ||
            (index > 0 && Number.isSafeInteger(previous) && floor <= previous))
        ) {
          ctx.addIssue({
            code: 'custom',
            path: ['tiers', index, 'floor'],
            message: t('Tier boundaries must increase from zero'),
          })
        }
      })
    })
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      tiers: props.config.tiers.map((tier) => ({
        name: tier.name || '',
        floor: String(tier.floor_cents / 100),
        rate: String(tier.rate_bps / 100),
      })),
    },
  })
  const rows = useFieldArray({ control: form.control, name: 'tiers' })
  const values = useWatch({ control: form.control, name: 'tiers' })
  const save = useCampusAction(async (tiers: CampaignConfig['tiers']) => {
    const response = await api.put('/api/campus/admin/tiers', {
      tiers,
      tier_revision: props.config.tier_revision,
    })
    return requireServerSuccess(response.data)
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Top-up commission tiers')}</CardTitle>
        <CardDescription>
          {t(
            'Ranges include the lower bound and exclude the upper bound. Adjacent boundaries update together. The first range starts at zero; the final range has no upper limit. Save to apply changes to future settlements.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            className='space-y-4'
            onSubmit={form.handleSubmit((values) =>
              save.mutate(
                values.tiers.map((tier) => ({
                  ...(tier.name ? { name: tier.name } : {}),
                  floor_cents: decimalUnits(tier.floor),
                  rate_bps: decimalUnits(tier.rate),
                })),
                {
                  onSuccess: () => toast.success(t('Commission tiers updated')),
                }
              )
            )}
          >
            <fieldset disabled={save.isPending} className='min-w-0 space-y-4'>
              <StaticDataTable
                data={rows.fields}
                getRowKey={(row) => row.id}
                tableProps={{ 'aria-label': t('Top-up commission tiers') }}
                tableClassName='[&_tbody>tr]:h-12'
                columns={[
                  {
                    id: 'tier',
                    header: t('Tier'),
                    className: 'w-24',
                    cell: (_row, index) =>
                      t('Tier {{level}}', { level: index + 1 }),
                  },
                  {
                    id: 'name',
                    header: t('Tier name'),
                    className: 'w-48',
                    cell: (_row, index) => (
                      <FormField
                        control={form.control}
                        name={`tiers.${index}.name`}
                        render={({ field }) => (
                          <FormItem className='gap-1'>
                            <FormLabel className='sr-only'>
                              {t('Tier {{level}} name', {
                                level: index + 1,
                              })}
                            </FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder={
                                  campusTierNameKeys[index]
                                    ? t(campusTierNameKeys[index])
                                    : t('Tier {{level}}', { level: index + 1 })
                                }
                              />
                            </FormControl>
                            <FormMessage className='whitespace-normal' />
                          </FormItem>
                        )}
                      />
                    ),
                  },
                  {
                    id: 'range',
                    header: t('Cumulative paid sales range (CNY)'),
                    cell: (_row, index) => (
                      <div className='flex items-start gap-2'>
                        <FormField
                          control={form.control}
                          name={`tiers.${index}.floor`}
                          render={({ field }) => (
                            <FormItem className='w-28 shrink-0 gap-1'>
                              <FormLabel className='sr-only'>
                                {t('Tier {{level}} lower bound (CNY)', {
                                  level: index + 1,
                                })}
                              </FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  inputMode='decimal'
                                  className={campusAmountTypography}
                                  readOnly={index === 0}
                                  tabIndex={index === 0 ? -1 : undefined}
                                />
                              </FormControl>
                              <FormMessage className='whitespace-normal' />
                            </FormItem>
                          )}
                        />
                        <span className='flex h-8 items-center'>
                          ≤ {t('Amount')}
                        </span>
                        {index + 1 < rows.fields.length && (
                          <>
                            <span className='flex h-8 items-center'>&lt;</span>
                            <FormField
                              control={form.control}
                              name={`tiers.${index + 1}.floor`}
                              render={({ field }) => (
                                <FormItem className='w-28 shrink-0 gap-1'>
                                  <FormLabel className='sr-only'>
                                    {t('Tier {{level}} upper bound (CNY)', {
                                      level: index + 1,
                                    })}
                                  </FormLabel>
                                  <FormControl>
                                    <Input
                                      {...field}
                                      inputMode='decimal'
                                      className={campusAmountTypography}
                                    />
                                  </FormControl>
                                  <FormMessage className='whitespace-normal' />
                                </FormItem>
                              )}
                            />
                          </>
                        )}
                      </div>
                    ),
                  },
                  {
                    id: 'rate',
                    header: <>{t('Commission')} (%)</>,
                    className: 'w-40',
                    cell: (_row, index) => (
                      <FormField
                        control={form.control}
                        name={`tiers.${index}.rate`}
                        render={({ field }) => (
                          <FormItem className='gap-1'>
                            <FormLabel className='sr-only'>
                              {t('Tier {{level}} commission (%)', {
                                level: index + 1,
                              })}
                            </FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                inputMode='decimal'
                                className={campusAmountTypography}
                              />
                            </FormControl>
                            <FormMessage className='whitespace-normal' />
                          </FormItem>
                        )}
                      />
                    ),
                  },
                  {
                    id: 'actions',
                    header: t('Actions'),
                    className: 'w-20 text-right',
                    cell: (_row, index) => (
                      <div className='flex justify-end'>
                        <Button
                          type='button'
                          variant='destructive'
                          size='sm'
                          disabled={rows.fields.length === 1}
                          aria-label={t('Remove tier {{level}}', {
                            level: index + 1,
                          })}
                          onClick={() => {
                            if (index === 0) form.setValue('tiers.1.floor', '0')
                            rows.remove(index)
                          }}
                        >
                          {t('Delete')}
                        </Button>
                      </div>
                    ),
                  },
                ]}
              />
              <div className='flex flex-wrap gap-2'>
                <Button
                  type='button'
                  variant='outline'
                  disabled={rows.fields.length >= 50}
                  onClick={() =>
                    rows.append({
                      name: '',
                      floor: '',
                      rate: values.at(-1)?.rate || '0',
                    })
                  }
                >
                  {t('Add tier')}
                </Button>
                <Button type='submit' disabled={save.isPending}>
                  {t('Save commission tiers')}
                </Button>
              </div>
            </fieldset>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}

export function CampusPlanSettings(props: { config: CampaignConfig }) {
  const { t } = useTranslation()
  const schema = z
    .object({
      plans: z
        .array(
          z.object({
            plan: z
              .string()
              .refine(
                (value) =>
                  props.config.plan_options.some(
                    (plan) => String(plan.id) === value
                  ),
                t('Select a subscription plan')
              ),
            rate: z.string().refine((value) => {
              const units = decimalUnits(value)
              return Number.isSafeInteger(units) && units <= 10000
            }, t('Enter a percentage from 0 to 100 with at most two decimal places')),
          })
        )
        .max(100),
    })
    .superRefine((values, ctx) => {
      const seen = new Set<string>()
      values.plans.forEach((plan, index) => {
        if (seen.has(plan.plan)) {
          ctx.addIssue({
            code: 'custom',
            path: ['plans', index, 'plan'],
            message: t('Each subscription plan can only be selected once'),
          })
        }
        seen.add(plan.plan)
      })
    })
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      plans: props.config.plan_rates.map((plan) => ({
        plan: String(plan.plan_id),
        rate: String(plan.rate_bps / 100),
      })),
    },
  })
  const rows = useFieldArray({ control: form.control, name: 'plans' })
  const values = useWatch({ control: form.control, name: 'plans' })
  const planOptions = props.config.plan_options.map((plan) => ({
    value: String(plan.id),
    label: `${plan.title} · #${plan.id}${!plan.enabled ? ` · ${t('Disabled')}` : ''}`,
  }))
  const save = useCampusAction(async (plans: CampaignConfig['plan_rates']) => {
    const response = await api.put('/api/campus/admin/plan-rates', {
      plan_rates: plans,
      plan_revision: props.config.plan_revision,
    })
    return requireServerSuccess(response.data)
  })
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Subscription commissions')}</CardTitle>
        <CardDescription>
          {t(
            'Select participating plans and set each commission rate. Only verified external payments qualify. Changes apply to future settlements; existing commissions stay unchanged.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            className='space-y-4'
            onSubmit={form.handleSubmit((values) =>
              save.mutate(
                values.plans.map((plan) => ({
                  plan_id: Number(plan.plan),
                  rate_bps: decimalUnits(plan.rate),
                })),
                {
                  onSuccess: () =>
                    toast.success(
                      t('Subscription commission settings updated')
                    ),
                }
              )
            )}
          >
            <fieldset disabled={save.isPending} className='min-w-0 space-y-4'>
              <StaticDataTable
                data={rows.fields}
                getRowKey={(row) => row.id}
                tableProps={{ 'aria-label': t('Subscription commissions') }}
                tableClassName='min-w-[28rem] table-fixed'
                emptyContent={t(
                  'No subscription plans participate in commission yet.'
                )}
                columns={[
                  {
                    id: 'plan',
                    header: t('Plan'),
                    className: 'w-1/2',
                    cellClassName: 'p-3 align-top',
                    cell: (_row, index) => (
                      <FormField
                        control={form.control}
                        name={`plans.${index}.plan`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className='sr-only'>
                              {t('Subscription plan {{number}}', {
                                number: index + 1,
                              })}
                            </FormLabel>
                            <Select
                              items={planOptions}
                              name={field.name}
                              value={field.value || null}
                              onValueChange={field.onChange}
                              disabled={save.isPending}
                            >
                              <FormControl>
                                <SelectTrigger
                                  ref={field.ref}
                                  onBlur={field.onBlur}
                                  className='w-full'
                                >
                                  <SelectValue
                                    placeholder={t(
                                      'Select a subscription plan'
                                    )}
                                  />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent alignItemWithTrigger={false}>
                                <SelectGroup>
                                  {planOptions.map((plan) => (
                                    <SelectItem
                                      key={plan.value}
                                      value={plan.value}
                                      disabled={values.some(
                                        (row, rowIndex) =>
                                          rowIndex !== index &&
                                          row.plan === plan.value
                                      )}
                                    >
                                      {plan.label}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ),
                  },
                  {
                    id: 'rate',
                    header: `${t('Subscription commission rates')} (%)`,
                    className: 'whitespace-normal',
                    cellClassName: 'p-3 align-top',
                    cell: (_row, index) => (
                      <FormField
                        control={form.control}
                        name={`plans.${index}.rate`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className='sr-only'>
                              {t('Subscription commission {{number}} (%)', {
                                number: index + 1,
                              })}
                            </FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                inputMode='decimal'
                                className={campusAmountTypography}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ),
                  },
                  {
                    id: 'actions',
                    header: t('Actions'),
                    className: 'w-20 text-right',
                    cellClassName: 'p-3 text-right align-top',
                    cell: (_row, index) => (
                      <Button
                        type='button'
                        variant='destructive'
                        aria-label={t('Remove subscription plan {{number}}', {
                          number: index + 1,
                        })}
                        onClick={() => rows.remove(index)}
                      >
                        {t('Delete')}
                      </Button>
                    ),
                  },
                ]}
              />
              <div className='flex flex-wrap gap-2'>
                <Button
                  type='button'
                  variant='outline'
                  disabled={
                    rows.fields.length >=
                    Math.min(100, props.config.plan_options.length)
                  }
                  onClick={() => rows.append({ plan: '', rate: '0' })}
                >
                  {t('Add subscription plan')}
                </Button>
                <Button type='submit' disabled={save.isPending}>
                  {t('Save subscription commissions')}
                </Button>
              </div>
            </fieldset>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
