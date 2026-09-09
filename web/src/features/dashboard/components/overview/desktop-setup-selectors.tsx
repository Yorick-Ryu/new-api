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
import { Claude, OpenAI } from '@lobehub/icons'
import { useTranslation } from 'react-i18next'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export function SetupAgentSelect(props: { disabled: boolean }) {
  const { t } = useTranslation()
  return (
    <Select value='codex' disabled={props.disabled}>
      <SelectTrigger
        id='codexbei-agent'
        aria-label='Agent'
        className='bg-background hover:bg-accent/50 w-32 shrink-0 rounded-lg px-2.5 py-1.5 shadow-xs data-[size=default]:h-9'
      >
        <SelectValue>
          <OpenAI size={16} aria-hidden='true' />
          ChatGPT
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        portalOnMobile
        align='start'
        alignItemWithTrigger={false}
        sideOffset={4}
        className='min-w-52 rounded-xl p-1'
      >
        <SelectItem value='codex' className='min-h-8 pr-8 pl-2.5'>
          <OpenAI size={16} aria-hidden='true' />
          ChatGPT
        </SelectItem>
        <SelectItem value='claude' disabled className='min-h-8 pr-8 pl-2.5'>
          <Claude.Color size={16} aria-hidden='true' />
          Claude Code · {t('Coming soon')}
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
