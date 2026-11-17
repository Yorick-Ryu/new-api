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
import { Claude, ClaudeCode, OpenAI } from '@lobehub/icons'
import { useTranslation } from 'react-i18next'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import type { SetupAgent } from '../../lib/desktop-setup-link'

export function SetupAgentSelect(props: {
  disabled: boolean
  value: SetupAgent
  onValueChange: (value: SetupAgent) => void
}) {
  const { t } = useTranslation()
  let icon = <OpenAI size={16} aria-hidden='true' />
  let label = 'ChatGPT'
  if (props.value === 'claude') {
    icon = <ClaudeCode.Color size={16} aria-hidden='true' />
    label = 'Claude Code'
  } else if (props.value === 'claude-desktop') {
    icon = <Claude.Color size={16} aria-hidden='true' />
    label = t('Claude Desktop')
  }
  return (
    <Select
      value={props.value}
      disabled={props.disabled}
      onValueChange={(value) => {
        if (
          value === 'codex' ||
          value === 'claude' ||
          value === 'claude-desktop'
        ) {
          props.onValueChange(value)
        }
      }}
    >
      <SelectTrigger
        id='codexbei-agent'
        aria-label={t('Agent')}
        className='bg-background hover:bg-accent/50 w-40 shrink-0 rounded-lg px-2.5 py-1.5 shadow-xs data-[size=default]:h-9'
      >
        <SelectValue>
          {icon}
          {label}
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        portalOnMobile
        align='start'
        alignItemWithTrigger={false}
        sideOffset={4}
        className='min-w-0 rounded-xl p-1'
      >
        <SelectItem value='codex' className='min-h-8 pr-8 pl-2.5'>
          <OpenAI size={16} aria-hidden='true' />
          ChatGPT
        </SelectItem>
        <SelectItem value='claude' className='min-h-8 pr-8 pl-2.5'>
          <ClaudeCode.Color size={16} aria-hidden='true' />
          Claude Code
        </SelectItem>
        <SelectItem value='claude-desktop' className='min-h-8 pr-8 pl-2.5'>
          <Claude.Color size={16} aria-hidden='true' />
          {t('Claude Desktop')}
        </SelectItem>
      </SelectContent>
    </Select>
  )
}

export function SetupModelSelect(props: {
  value: string
  models: string[]
  disabled: boolean
  loading: boolean
  onValueChange: (value: string) => void
}) {
  const { t } = useTranslation()
  return (
    <Select
      value={props.value || null}
      disabled={props.disabled}
      onValueChange={(value) => {
        if (value) props.onValueChange(value)
      }}
    >
      <SelectTrigger
        id='codexbei-model'
        aria-label={t('Model')}
        title={props.value}
        className='bg-background hover:bg-accent/50 min-w-0 flex-1 basis-40 rounded-lg px-2.5 py-1.5 shadow-xs data-[size=default]:h-9'
      >
        <SelectValue className='min-w-0'>
          <span className='min-w-0 truncate'>
            {props.value ||
              (props.loading ? t('Loading') : t('No models available'))}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        portalOnMobile
        align='start'
        alignItemWithTrigger={false}
        sideOffset={4}
        className='max-h-64 rounded-xl p-1'
      >
        {props.models.map((item) => (
          <SelectItem
            key={item}
            value={item}
            className='min-h-8 pr-8 pl-2.5 [&_[data-slot=select-item-text]]:min-w-0 [&_[data-slot=select-item-text]]:shrink'
            title={item}
          >
            <span className='min-w-0 flex-1 truncate'>{item}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
