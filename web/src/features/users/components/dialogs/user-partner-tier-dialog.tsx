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
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import {
  beijingDate,
  campusGet,
  cash,
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

type Props = { user: { id: number; username: string }; onClose: () => void }

export function UserPartnerTierDialog(props: Props) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const query = useQuery({
    queryKey: ['campus', 'member-tier', props.user.id],
    queryFn: () => campusGet<MemberTier>(`admin/members/${props.user.id}/tier`),
    meta: { errorToast: false },
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) props.onClose()
      }}
      title={t('Manage partner')}
      description={`${props.user.username} · #${props.user.id}`}
      contentClassName='sm:max-w-lg'
    >
      {query.isPending && <LoadingState />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      {query.isSuccess && !query.data.joined && (
        <EmptyState title={t('This user has not joined the partner program')} />
      )}
      {query.isSuccess && query.data.joined && (
        <PartnerTierForm
          key={`${props.user.id}-${query.data.revision}-${query.data.config_revision}`}
          {...props}
          onSavingChange={setSaving}
          data={query.data}
        />
      )}
    </Dialog>
  )
}

function PartnerTierForm(
  props: Props & { data: MemberTier; onSavingChange: (saving: boolean) => void }
) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const client = useQueryClient()
  const [pending, setPending] = useState<PartnerTierValues | null>(null)
  const form = useForm<PartnerTierValues>({
    resolver: zodResolver(partnerTierSchema),
    defaultValues: { level: props.data.override, reason: '' },
  })
  const level = form.watch('level')
  const selected = level === 0 ? props.data.automatic.level : level
  const label = (value: number) => {
    const rule = props.data.tiers[value - 1]
    return `${t('Lv.{{level}}', { level: value })} · ${rule?.name || t(campusTierNameKeys[value - 1] || 'Lv.{{level}}', { level: value })} · ${formatNumber((rule?.rate_bps || 0) / 100, locale)}%`
  }
  const save = useMutation({
    mutationFn: async (values: PartnerTierValues) => {
      const response = await api.put(
        `/api/campus/admin/members/${props.user.id}/tier`,
        {
          ...values,
          revision: props.data.revision,
          config_revision: props.data.config_revision,
        }
      )
      return requireServerSuccess(response.data)
    },
    onSuccess: () => {
      toast.success(t('Partner level updated'))
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
        <form onSubmit={form.handleSubmit(setPending)} className='space-y-4'>
          <div className='space-y-2 text-sm'>
            <p>
              {t('Current partner level')}: {label(props.data.effective.level)}
            </p>
            <Badge variant='secondary'>
              {props.data.override ? t('Assigned level') : t('Automatic level')}
            </Badge>
            <p>
              {t('Friends cumulative top-ups')}:{' '}
              {cash(props.data.performance_cents, locale)}
            </p>
          </div>
          <FormField
            control={form.control}
            name='level'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Partner level')}</FormLabel>
                <FormControl>
                  <NativeSelect
                    {...field}
                    onChange={(event) =>
                      field.onChange(Number(event.target.value))
                    }
                    className='w-full'
                    disabled={save.isPending}
                  >
                    <NativeSelectOption value={0}>
                      {t('Automatic level')}
                    </NativeSelectOption>
                    {props.data.tiers.map((tier, index) => (
                      <NativeSelectOption
                        key={tier.floor_cents}
                        value={index + 1}
                      >
                        {label(index + 1)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <p className='text-muted-foreground text-sm'>
            {t('Effective after saving')}: {label(selected)}
          </p>
          <p className='text-muted-foreground text-sm'>
            {t(
              'Assigned levels remain fixed until changed or restored to automatic. Only future settlements are affected; actual performance, historical commissions and subscription rates stay unchanged.'
            )}
          </p>
          <FormField
            control={form.control}
            name='reason'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Reason')}</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    maxLength={500}
                    disabled={save.isPending}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className='flex justify-end gap-2'>
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
              disabled={save.isPending || level === props.data.override}
            >
              {t('Save changes')}
            </Button>
          </div>
        </form>
      </Form>
      {props.data.changes.length > 0 && (
        <section className='mt-4 text-sm'>
          <h3 className='font-medium'>{t('Recent level changes')}</h3>
          <ul className='mt-2 space-y-3'>
            {props.data.changes.map((change) => (
              <li key={change.id} className='space-y-1 break-words'>
                <p>
                  {t('Lv.{{level}}', { level: change.previous_level })} →{' '}
                  {t('Lv.{{level}}', { level: change.level })} ·{' '}
                  {change.override ? t('Assigned level') : t('Automatic level')}
                </p>
                <p className='text-muted-foreground'>
                  {beijingDate(change.created_at, locale)} · {t('Operator')} #
                  {change.actor_id}
                </p>
                <p>{change.reason}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !save.isPending) setPending(null)
        }}
        title={t('Confirm partner level change')}
        desc={`${props.user.username} (#${props.user.id}): ${label(props.data.effective.level)} → ${label(selected)} · ${level === 0 ? t('Automatic level') : t('Assigned level')}`}
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
