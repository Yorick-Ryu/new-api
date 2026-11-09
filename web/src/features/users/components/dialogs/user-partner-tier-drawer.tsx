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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  SideDrawerSection,
  sideDrawerContentClassName,
  sideDrawerFooterClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  beijingDate,
  campusGet,
  type Overview,
  type TierRule,
} from '@/features/campus-partner/api'
import { campusTierNameKeys } from '@/features/campus-partner/constants'
import { toIntlLocale } from '@/i18n/languages'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import {
  partnerTierSchema,
  type PartnerTierValues,
} from '../../lib/partner-tier-form'

type MemberTier = {
  joined: boolean
  override: number
  revision: number
  config_revision: number
  performance_cents: number
  automatic: Overview['tier']
  effective: Overview['tier']
  tiers: TierRule[]
  changes: {
    id: number
    actor_id: number
    previous_level: number
    level: number
    override: number
    reason: string
    created_at: number
  }[]
}

type Props = {
  open: boolean
  user: { id: number; username: string }
  onClose: () => void
}

export function UserPartnerTierDrawer(props: Props) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const query = useQuery({
    queryKey: ['campus', 'member-tier', props.user.id],
    queryFn: () => campusGet<MemberTier>(`admin/members/${props.user.id}/tier`),
    meta: { errorToast: false },
    enabled: props.open,
  })
  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => {
        if (!open && !saving) props.onClose()
      }}
    >
      <SheetContent
        side='right'
        className={sideDrawerContentClassName('sm:max-w-[600px]')}
      >
        <SheetHeader className={sideDrawerHeaderClassName()}>
          <SheetTitle>{t('Manage partner')}</SheetTitle>
          <SheetDescription className='break-words'>
            {props.user.username} (#{props.user.id})
          </SheetDescription>
        </SheetHeader>
        {query.isPending && (
          <div className={sideDrawerFormClassName()}>
            <LoadingState />
          </div>
        )}
        {query.isError && (
          <div className={sideDrawerFormClassName()}>
            <ErrorState onRetry={() => void query.refetch()} />
          </div>
        )}
        {query.isSuccess && (
          <PartnerTierForm
            key={`${props.user.id}-${query.data.revision}-${query.data.config_revision}`}
            {...props}
            onSavingChange={setSaving}
            data={query.data}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function PartnerTierForm(
  props: Props & { data: MemberTier; onSavingChange: (saving: boolean) => void }
) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const client = useQueryClient()
  const formId = useId()
  const [pending, setPending] = useState<PartnerTierValues | null>(null)
  const form = useForm<PartnerTierValues>({
    resolver: zodResolver(partnerTierSchema),
    defaultValues: { level: props.data.override },
  })
  const level = form.watch('level')
  const selected = level === 0 ? props.data.automatic.level : level
  const label = (value: number, includeRate = true) => {
    if (value === 0) return t('Not joined')
    const rule = props.data.tiers[value - 1]
    const name = `${t('Lv.{{level}}', { level: value })} ${rule?.name || t(campusTierNameKeys[value - 1] || 'Lv.{{level}}', { level: value })}`
    return includeRate
      ? `${name} ${formatNumber((rule?.rate_bps || 0) / 100, locale)}%`
      : name
  }
  const options = [
    {
      value: 0,
      label: `${t('Automatic level')} (${label(props.data.automatic.level)})`,
    },
    ...props.data.tiers.map((_, index) => ({
      value: index + 1,
      label: label(index + 1),
    })),
  ]
  const save = useMutation({
    mutationFn: async (values: PartnerTierValues) => {
      const response = await api.put(
        `/api/campus/admin/members/${props.user.id}/tier`,
        {
          ...values,
          enroll: !props.data.joined,
          revision: props.data.revision,
          config_revision: props.data.config_revision,
        }
      )
      return requireServerSuccess(response.data)
    },
    onSuccess: () => {
      toast.success(
        t(props.data.joined ? 'Partner level updated' : 'Partner activated')
      )
      props.onClose()
      void client.invalidateQueries({ queryKey: ['campus'] })
    },
    onError: (error) => {
      handleServerError(error)
      setPending(null)
    },
    onSettled: () => props.onSavingChange(false),
  })
  return (
    <>
      <Form {...form}>
        <form
          id={formId}
          onSubmit={form.handleSubmit(setPending)}
          className={sideDrawerFormClassName()}
        >
          <SideDrawerSection>
            <dl className='grid gap-4 sm:grid-cols-2'>
              <div>
                <dt className='text-muted-foreground text-xs'>
                  {t('Current partner level')}
                </dt>
                <dd className='mt-1 text-sm'>
                  {label(
                    props.data.joined ? props.data.effective.level : 0,
                    false
                  )}
                </dd>
              </div>
              {props.data.joined && (
                <div>
                  <dt className='text-muted-foreground text-xs'>
                    {t('Current partner commission rate')}
                  </dt>
                  <dd className='mt-1 text-sm tabular-nums'>
                    {formatNumber(props.data.effective.rate_percent, locale)}%
                  </dd>
                </div>
              )}
            </dl>
          </SideDrawerSection>
          <SideDrawerSection>
            <FormField
              control={form.control}
              name='level'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Partner level')}</FormLabel>
                  <Select
                    items={options}
                    value={field.value}
                    onValueChange={(value) =>
                      value !== null && field.onChange(value)
                    }
                    disabled={save.isPending}
                  >
                    <FormControl>
                      <SelectTrigger
                        ref={field.ref}
                        onBlur={field.onBlur}
                        className='w-full'
                      >
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent alignItemWithTrigger={false}>
                      {options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SideDrawerSection>
          {props.data.changes.length > 0 && (
            <SideDrawerSection>
              <h3 className='text-sm font-medium'>
                {t('Recent level changes')}
              </h3>
              <ul className='space-y-3 text-sm'>
                {props.data.changes.map((change) => (
                  <li key={change.id} className='space-y-1 break-words'>
                    <p>
                      {change.previous_level === 0
                        ? t('Not joined')
                        : t('Lv.{{level}}', {
                            level: change.previous_level,
                          })}{' '}
                      → {t('Lv.{{level}}', { level: change.level })}{' '}
                      {change.override
                        ? t('Assigned level')
                        : t('Automatic level')}
                    </p>
                    <p className='text-muted-foreground'>
                      {beijingDate(change.created_at, locale)} {t('Operator')} #
                      {change.actor_id}
                    </p>
                    {change.reason && <p>{change.reason}</p>}
                  </li>
                ))}
              </ul>
            </SideDrawerSection>
          )}
        </form>
      </Form>
      <SheetFooter className={sideDrawerFooterClassName()}>
        <Button
          type='button'
          variant='outline'
          disabled={save.isPending}
          onClick={props.onClose}
        >
          {t('Cancel')}
        </Button>
        <Button
          type='submit'
          form={formId}
          disabled={
            save.isPending ||
            (props.data.joined && level === props.data.override)
          }
        >
          {t(props.data.joined ? 'Save changes' : 'Activate partner')}
        </Button>
      </SheetFooter>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !save.isPending) setPending(null)
        }}
        title={t(
          props.data.joined
            ? 'Confirm partner level change'
            : 'Confirm partner activation'
        )}
        desc={`${props.user.username} (#${props.user.id}): ${label(props.data.joined ? props.data.effective.level : 0, false)} → ${label(selected)} (${level === 0 ? t('Automatic level') : t('Assigned level')})`}
        confirmText={t('Confirm')}
        isLoading={save.isPending}
        handleConfirm={() => {
          if (!pending || save.isPending) return
          props.onSavingChange(true)
          save.mutate(pending)
        }}
      />
    </>
  )
}
