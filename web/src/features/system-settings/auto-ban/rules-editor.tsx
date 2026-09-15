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
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { newRule, ruleSchema, type BanRule } from './lib/schema'
import { RuleEditor } from './rule-editor'

function RuleDialog(props: {
  rule: BanRule
  isNew: boolean
  onClose: () => void
  onApply: (rule: BanRule) => void
}) {
  const { t } = useTranslation()
  const id = useId()
  const form = useForm<BanRule>({
    resolver: zodResolver(ruleSchema),
    defaultValues: props.rule,
    mode: 'onChange',
  })
  const draft = useWatch({ control: form.control }) as BanRule
  const valid = ruleSchema.safeParse(draft).success
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={props.isNew ? t('Add rule') : t('Edit rule')}
      description={t(
        'Set this rule’s name and matching conditions. Changes take effect after saving the page.'
      )}
      contentClassName='sm:max-w-4xl'
      footer={
        <>
          <Button type='button' variant='outline' onClick={props.onClose}>
            {t('Cancel')}
          </Button>
          <Button type='submit' form={id} disabled={!valid}>
            {t('Apply')}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form
          id={id}
          className='space-y-4'
          onSubmit={(event) => {
            event.stopPropagation()
            void form.handleSubmit(props.onApply)(event)
          }}
        >
          <RuleEditor
            rule={draft}
            disabled={false}
            onChange={(updated) => {
              for (const key of Object.keys(updated) as (keyof BanRule)[]) {
                form.setValue(key, updated[key], {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
            }}
          />
          {!valid && (
            <p role='alert' className='text-destructive text-sm'>
              {t(
                'Complete each rule with a name, reason and valid matching conditions. HTTP status alone is not allowed.'
              )}
            </p>
          )}
        </form>
      </Form>
    </Dialog>
  )
}

export function RulesEditor(props: {
  rules: BanRule[]
  onChange: (rules: BanRule[]) => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<{
    rule: BanRule
    isNew: boolean
  } | null>(null)
  return (
    <div className='min-w-0 space-y-4'>
      <div className='flex items-center justify-between gap-3'>
        <h4 className='text-sm font-medium'>{t('Rules')}</h4>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={props.disabled || props.rules.length >= 64}
          onClick={() => setEditing({ rule: newRule(), isNew: true })}
        >
          <Plus data-icon='inline-start' />
          {t('Add rule')}
        </Button>
      </div>
      <div className='overflow-hidden rounded-lg border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('Rule name')}</TableHead>
              <TableHead>{t('Status')}</TableHead>
              <TableHead>{t('Matching conditions')}</TableHead>
              <TableHead className='text-right'>{t('Actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {props.rules.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className='text-muted-foreground h-24 text-center whitespace-normal'
                >
                  {t(
                    'No rules configured. Add a rule to match upstream failures.'
                  )}
                </TableCell>
              </TableRow>
            )}
            {props.rules.map((rule) => (
              <TableRow key={rule.id}>
                <TableCell className='max-w-64 truncate font-medium'>
                  {rule.name}
                </TableCell>
                <TableCell>
                  <Badge variant={rule.enabled ? 'secondary' : 'outline'}>
                    {rule.enabled ? t('Enabled') : t('Disabled')}
                  </Badge>
                </TableCell>
                <TableCell>
                  {t('{{count}} conditions', {
                    count: rule.match_groups.reduce(
                      (sum, group) => sum + group.conditions.length,
                      0
                    ),
                  })}
                </TableCell>
                <TableCell>
                  <div className='flex justify-end gap-1'>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-sm'
                      aria-label={t('Edit rule')}
                      disabled={props.disabled}
                      onClick={() => setEditing({ rule, isNew: false })}
                    >
                      <Pencil className='size-4' />
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon-sm'
                      aria-label={t('Delete rule')}
                      disabled={props.disabled}
                      onClick={() =>
                        props.onChange(
                          props.rules.filter((r) => r.id !== rule.id)
                        )
                      }
                    >
                      <Trash2 className='size-4' />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {editing && (
        <RuleDialog
          key={editing.rule.id}
          rule={editing.rule}
          isNew={editing.isNew}
          onClose={() => setEditing(null)}
          onApply={(updated) => {
            props.onChange(
              editing.isNew
                ? [...props.rules, updated]
                : props.rules.map((r) => (r.id === updated.id ? updated : r))
            )
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
