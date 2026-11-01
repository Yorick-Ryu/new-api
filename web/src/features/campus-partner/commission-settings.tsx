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
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { toIntlLocale } from '@/i18n/languages'
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import { cash, useCampusAction, type CampaignConfig } from './api'

// Parse decimal cash/percent values into integer hundredths without float rounding.
function decimalUnits(value: string): number {
  if (!/^\d{1,14}(\.\d{1,2})?$/.test(value)) return Number.NaN
  const [whole, fraction = ''] = value.split('.')
  const units = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  return units <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(units) : Number.NaN
}

export function CampusTierSettings(props: { config: CampaignConfig }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
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
        .array(z.object({ floor: amount, rate }))
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
            'Ranges start at zero and connect automatically. The final tier has no upper limit. Changes apply to future settlements; existing commissions stay unchanged.'
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
              {rows.fields.map((row, index) => (
                <fieldset
                  key={row.id}
                  className='min-w-0 rounded-lg border p-4'
                >
                  <legend className='px-1 text-sm font-medium'>
                    {t('Tier {{level}}', { level: index + 1 })}
                  </legend>
                  <div className='grid items-start gap-4 sm:grid-cols-3'>
                    <div className='space-y-2'>
                      <p className='text-sm font-medium'>
                        {t('Minimum sales (CNY)')}
                      </p>
                      <p className='text-sm tabular-nums'>
                        {Number.isNaN(decimalUnits(values[index]?.floor ?? ''))
                          ? '—'
                          : cash(decimalUnits(values[index].floor), locale)}
                      </p>
                    </div>
                    {index + 1 < rows.fields.length ? (
                      <FormField
                        control={form.control}
                        name={`tiers.${index + 1}.floor`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              {t('Tier {{level}} upper bound (CNY)', {
                                level: index + 1,
                              })}
                            </FormLabel>
                            <FormControl>
                              <Input {...field} inputMode='decimal' />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ) : (
                      <div className='space-y-2'>
                        <p className='text-sm font-medium'>
                          {t('Upper bound (exclusive)')}
                        </p>
                        <p className='text-sm'>{t('Unlimited')}</p>
                      </div>
                    )}
                    <FormField
                      control={form.control}
                      name={`tiers.${index}.rate`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {t('Tier {{level}} commission (%)', {
                              level: index + 1,
                            })}
                          </FormLabel>
                          <FormControl>
                            <Input {...field} inputMode='decimal' />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className='mt-3 flex justify-end'>
                    <Button
                      type='button'
                      variant='ghost'
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
                </fieldset>
              ))}
              <div className='flex flex-wrap gap-2'>
                <Button
                  type='button'
                  variant='outline'
                  disabled={rows.fields.length >= 50}
                  onClick={() =>
                    rows.append({ floor: '', rate: values.at(-1)?.rate || '0' })
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
              {rows.fields.length === 0 && (
                <p className='text-muted-foreground text-sm'>
                  {t('No subscription plans participate in commission yet.')}
                </p>
              )}
              {rows.fields.map((row, index) => (
                <div
                  key={row.id}
                  className='grid items-start gap-4 rounded-lg border p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]'
                >
                  <FormField
                    control={form.control}
                    name={`plans.${index}.plan`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t('Subscription plan {{number}}', {
                            number: index + 1,
                          })}
                        </FormLabel>
                        <FormControl>
                          <NativeSelect {...field} className='w-full'>
                            <NativeSelectOption value=''>
                              {t('Select a subscription plan')}
                            </NativeSelectOption>
                            {props.config.plan_options.map((plan) => (
                              <NativeSelectOption
                                key={plan.id}
                                value={String(plan.id)}
                                disabled={values.some(
                                  (row, rowIndex) =>
                                    rowIndex !== index &&
                                    row.plan === String(plan.id)
                                )}
                              >
                                {plan.title} · #{plan.id}
                                {!plan.enabled ? ` · ${t('Disabled')}` : ''}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`plans.${index}.rate`}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {t('Subscription commission {{number}} (%)', {
                            number: index + 1,
                          })}
                        </FormLabel>
                        <FormControl>
                          <Input {...field} inputMode='decimal' />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    className='sm:mt-6'
                    type='button'
                    variant='ghost'
                    aria-label={t('Remove subscription plan {{number}}', {
                      number: index + 1,
                    })}
                    onClick={() => rows.remove(index)}
                  >
                    {t('Delete')}
                  </Button>
                </div>
              ))}
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
