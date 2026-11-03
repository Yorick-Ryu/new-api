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
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { campusGet, campusPost, invitationCode, useCampusAction } from './api'

export function CampusFields(props: {
  fields: {
    name: string
    label: string
    value?: string
    type?: string
    placeholder?: string
    className?: string
    optional?: boolean
  }[]
  submit: string
  pending: boolean
  onSubmit: (values: Record<string, string>) => void
}) {
  const { t } = useTranslation()
  const form = useForm<Record<string, string>>({
    resolver: zodResolver(
      z
        .record(z.string(), z.string().trim().max(2000))
        .superRefine((values, context) => {
          for (const field of props.fields) {
            if (!field.optional && !values[field.name]?.trim()) {
              context.addIssue({
                code: 'custom',
                path: [field.name],
                message: t('Required'),
              })
            }
            if (
              field.label === 'Alipay account' &&
              (values[field.name].length > 128 ||
                !/^(1[3-9][0-9]{9}|\+[1-9][0-9]{6,14}|[^\s@]+@[^\s@.]+(\.[^\s@.]+)+)$/.test(
                  values[field.name]
                ))
            ) {
              context.addIssue({
                code: 'custom',
                path: [field.name],
                message: t(
                  'Enter a valid Alipay phone number or email address'
                ),
              })
            }
          }
        })
    ),
    defaultValues: Object.fromEntries(
      props.fields.map((field) => [field.name, field.value || ''])
    ),
  })
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(props.onSubmit)} className='grid gap-4'>
        {props.fields.map((field) => (
          <FormField
            key={field.name}
            control={form.control}
            name={field.name}
            render={({ field: input }) => (
              <FormItem>
                <FormLabel>{t(field.label)}</FormLabel>
                <FormControl>
                  <Input
                    {...input}
                    type={field.type || 'text'}
                    className={field.className}
                    placeholder={
                      field.placeholder ? t(field.placeholder) : undefined
                    }
                    autoComplete='off'
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
        <Button type='submit' disabled={props.pending}>
          {props.pending ? t('Processing...') : t(props.submit)}
        </Button>
      </form>
    </Form>
  )
}
export function InvitationField(props: { registration?: boolean }) {
  const { t } = useTranslation()
  const [code, setCode] = useState(() =>
    (
      new URLSearchParams(window.location.search).get('campus') ||
      invitationCode()
    )
      .trim()
      .toUpperCase()
  )
  const [confirm, setConfirm] = useState(false)
  const invitation = useQuery({
    queryKey: ['campus', 'invite', code],
    queryFn: () =>
      campusGet<{ inviter: string }>(`invite/${encodeURIComponent(code)}`),
    enabled: /^[A-Z0-9]{6}$/.test(code),
    retry: false,
    meta: { errorToast: false },
  })
  const bind = useCampusAction(() => campusPost('self/bind', { code }))
  // The submitted invitation is server-validated and persisted in OAuth state.
  // Updating storage here also covers an untouched code arriving in a link.
  useEffect(() => {
    if (props.registration) sessionStorage.setItem('campus-invitation', code)
  }, [props.registration, code])
  let message = t(
    'Get a personal 5% off top-up coupon when you bind an invitation.'
  )
  if (code) {
    message = t('Enter a 6-character invitation code (A–Z, 0–9).')
    if (invitation.isFetching) message = t('Checking invitation...')
    else if (invitation.isError) {
      message = t('Unable to validate this code. Correct it or try again.')
    } else if (invitation.data) {
      message = t('Invited by {{name}}', { name: invitation.data.inviter })
    }
  }
  return (
    <div className='space-y-3 rounded-xl border p-4'>
      <Label htmlFor='campus-invitation'>
        {t('Campus invitation code (optional)')}
      </Label>
      <Input
        id='campus-invitation'
        value={code}
        maxLength={6}
        placeholder='K7MN2R'
        autoCapitalize='characters'
        autoComplete='off'
        spellCheck={false}
        onChange={(event) => setCode(event.target.value.trim().toUpperCase())}
      />
      <p className='text-muted-foreground text-xs' aria-live='polite'>
        {message}
      </p>
      {!props.registration && (
        <Button
          disabled={!invitation.data || invitation.isFetching || bind.isPending}
          onClick={() => setConfirm(true)}
        >
          {t('Bind invitation')}
        </Button>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('Confirm invitation')}
        desc={t(
          'Binding cannot be changed. Only available before your first successful payment. You cannot invite yourself or invite each other.'
        )}
        isLoading={bind.isPending}
        handleConfirm={() =>
          bind.mutate(undefined, { onSuccess: () => setConfirm(false) })
        }
      />
    </div>
  )
}
