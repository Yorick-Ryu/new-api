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
import { Plus } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

import {
  SettingsFormGrid,
  SettingsSwitchRow,
} from '../components/settings-form-layout'
import { newMatchGroup, type BanRule } from './lib/schema'
import { MatchGroupEditor } from './match-group-editor'

export function RuleEditor(props: {
  rule: BanRule
  onChange: (rule: BanRule) => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  const change = (patch: Partial<BanRule>) =>
    props.onChange({ ...props.rule, ...patch })
  return (
    <fieldset disabled={props.disabled} className='min-w-0 space-y-6'>
      <SettingsSwitchRow>
        <Label htmlFor={`${id}-enabled`}>{t('Enable rule')}</Label>
        <Switch
          id={`${id}-enabled`}
          checked={props.rule.enabled}
          disabled={props.disabled}
          onCheckedChange={(enabled) => change({ enabled })}
        />
      </SettingsSwitchRow>
      <SettingsFormGrid>
        <Field>
          <FieldLabel htmlFor={`${id}-name`}>{t('Rule name')}</FieldLabel>
          <Input
            id={`${id}-name`}
            maxLength={200}
            value={props.rule.name}
            onChange={(event) => change({ name: event.target.value })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-reason`}>{t('Ban reason')}</FieldLabel>
          <Input
            id={`${id}-reason`}
            maxLength={500}
            value={props.rule.reason}
            onChange={(event) => change({ reason: event.target.value })}
          />
        </Field>
      </SettingsFormGrid>
      <div className='space-y-4'>
        <p className='text-muted-foreground text-sm'>
          {t(
            'Each rule has its own conditions. Any matching method below triggers this rule.'
          )}
        </p>
        {props.rule.match_groups.map((group, index) => (
          <MatchGroupEditor
            key={group.id}
            group={group}
            index={index}
            disabled={props.disabled}
            canRemove={props.rule.match_groups.length > 1}
            onChange={(updated) =>
              change({
                match_groups: props.rule.match_groups.map((g, i) =>
                  i === index ? updated : g
                ),
              })
            }
            onRemove={() =>
              change({
                match_groups: props.rule.match_groups.filter(
                  (_, i) => i !== index
                ),
              })
            }
          />
        ))}
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={props.disabled || props.rule.match_groups.length >= 16}
          onClick={() =>
            change({
              match_groups: [...props.rule.match_groups, newMatchGroup()],
            })
          }
        >
          <Plus data-icon='inline-start' />
          {t('Add matching method')}
        </Button>
      </div>
      <SettingsFormGrid>
        <Field>
          <FieldLabel htmlFor={`${id}-channels`}>
            {t('Channel IDs (comma separated; empty means all)')}
          </FieldLabel>
          <Input
            id={`${id}-channels`}
            defaultValue={props.rule.channels.join(', ')}
            onChange={(event) =>
              change({
                channels: event.target.value.trim()
                  ? event.target.value.split(',').map((v) => Number(v.trim()))
                  : [],
              })
            }
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-models`}>
            {t('Models (comma separated; empty means all)')}
          </FieldLabel>
          <Input
            id={`${id}-models`}
            defaultValue={props.rule.models.join(', ')}
            onChange={(event) =>
              change({
                models: event.target.value.trim()
                  ? event.target.value.split(',').map((v) => v.trim())
                  : [],
              })
            }
          />
        </Field>
      </SettingsFormGrid>
    </fieldset>
  )
}
