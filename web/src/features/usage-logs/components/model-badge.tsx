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
import { AlertTriangle, Route } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'

import type { LogOtherData } from '../types'

interface ModelBadgeProps {
  modelName: string
  actualModel?: string
  responseModel?: LogOtherData['response_model']
  className?: string
}

interface ModelProvider {
  icon: string
  label: string
}

function resolveModelProvider(modelName: string): ModelProvider | null {
  const model = modelName.toLowerCase()
  const hasAny = (keywords: string[]) =>
    keywords.some((keyword) => model.includes(keyword))

  if (
    hasAny([
      'gpt-',
      'chatgpt-',
      'text-embedding-',
      'omni-moderation',
      'dall-e',
      'whisper',
      'tts-',
    ]) ||
    /\bo[134](?:-|$)/.test(model)
  ) {
    return { icon: 'OpenAI.Color', label: 'OpenAI' }
  }
  if (hasAny(['claude-', 'anthropic'])) {
    return { icon: 'Claude.Color', label: 'Claude' }
  }
  if (hasAny(['gemini-', 'learnlm-'])) {
    return { icon: 'Gemini.Color', label: 'Gemini' }
  }
  if (hasAny(['grok-', 'xai-'])) {
    return { icon: 'Grok.Color', label: 'Grok' }
  }
  if (hasAny(['deepseek-'])) {
    return { icon: 'DeepSeek.Color', label: 'DeepSeek' }
  }
  if (hasAny(['qwen', 'qwq-'])) {
    return { icon: 'Qwen.Color', label: 'Qwen' }
  }
  if (hasAny(['doubao-', 'volcengine'])) {
    return { icon: 'Doubao.Color', label: 'Doubao' }
  }
  if (hasAny(['moonshot-', 'kimi-'])) {
    return { icon: 'Moonshot.Color', label: 'Moonshot' }
  }
  if (hasAny(['minimax', 'abab'])) {
    return { icon: 'Minimax.Color', label: 'MiniMax' }
  }
  if (hasAny(['glm-', 'chatglm', 'cogview', 'cogvideo'])) {
    return { icon: 'Zhipu.Color', label: 'Zhipu' }
  }
  if (hasAny(['mimo-'])) {
    return { icon: 'XiaomiMiMo', label: 'MiMo' }
  }
  if (hasAny(['ernie'])) {
    return { icon: 'Wenxin.Color', label: 'Baidu' }
  }
  if (hasAny(['spark'])) {
    return { icon: 'Spark.Color', label: 'iFlyTek' }
  }
  if (hasAny(['hunyuan'])) {
    return { icon: 'Hunyuan.Color', label: 'Tencent' }
  }
  if (hasAny(['baichuan'])) {
    return { icon: 'Baichuan.Color', label: 'Baichuan' }
  }
  if (hasAny(['internlm'])) {
    return { icon: 'InternLM.Color', label: 'InternLM' }
  }
  if (hasAny(['step-'])) {
    return { icon: 'Stepfun.Color', label: 'StepFun' }
  }
  if (hasAny(['yi-'])) {
    return { icon: 'Yi.Color', label: 'Yi' }
  }
  if (hasAny(['mistral-', 'mixtral-'])) {
    return { icon: 'Mistral.Color', label: 'Mistral' }
  }
  if (hasAny(['llama-', 'meta-'])) {
    return { icon: 'Meta.Color', label: 'Meta' }
  }
  if (hasAny(['command-', 'cohere-'])) {
    return { icon: 'Cohere.Color', label: 'Cohere' }
  }

  return null
}

function ModelBadgeContent(props: ModelBadgeProps & { copyable?: boolean }) {
  const provider = resolveModelProvider(props.modelName)

  return (
    <StatusBadge
      copyText={props.modelName}
      copyable={props.copyable}
      size='sm'
      showDot={!provider}
      autoColor={provider ? undefined : props.modelName}
      className={cn(
        'border-border/60 bg-muted/30 h-6 max-w-none gap-1.5 rounded-md border px-2 [font-family:var(--font-body)]',
        provider && 'text-foreground',
        props.className
      )}
    >
      <span className='flex max-w-none items-center gap-1.5'>
        {provider && (
          <span
            className='flex h-[18px] w-[18px] shrink-0 items-center justify-center'
            title={provider.label}
            aria-label={provider.label}
          >
            {getLobeIcon(provider.icon, 18)}
          </span>
        )}
        <span className='whitespace-nowrap'>{props.modelName}</span>
      </span>
    </StatusBadge>
  )
}

export function ModelBadge(props: ModelBadgeProps) {
  const { t } = useTranslation()
  const observation = props.responseModel
  const hasDetails =
    !!props.actualModel ||
    !!(
      observation &&
      (observation.mismatch ||
        observation.returned_model !== observation.requested_model ||
        (observation.upstream_model &&
          observation.upstream_model !== observation.requested_model))
    )

  if (!hasDetails) {
    return <ModelBadgeContent {...props} />
  }

  const warning = observation?.mismatch
    ? t('Response model: {{model}}', { model: observation.returned_model })
    : ''

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type='button'
            aria-label={`${t('Model')}: ${props.modelName}${warning ? `, ${warning}` : ''}`}
            className='inline-flex max-w-full min-w-0 flex-wrap items-center gap-1 text-left'
          />
        }
      >
        <ModelBadgeContent {...props} copyable={false} />
        {warning ? (
          <StatusBadge
            icon={AlertTriangle}
            label={warning}
            variant='warning'
            copyable={false}
          />
        ) : (
          props.actualModel && (
            <Route
              className='text-muted-foreground size-3 shrink-0'
              aria-hidden='true'
            />
          )
        )}
      </PopoverTrigger>
      <PopoverContent className='w-96 max-w-[calc(100vw-2rem)]'>
        {observation ? (
          <ResponseModelDetails observation={observation} />
        ) : (
          <div className='space-y-2'>
            <div className='flex items-start justify-between gap-3'>
              <span className='text-muted-foreground text-xs'>
                {t('Request Model:')}
              </span>
              <span className='min-w-0 font-mono text-xs font-medium [overflow-wrap:anywhere]'>
                {props.modelName}
              </span>
            </div>
            <div className='flex items-start justify-between gap-3'>
              <span className='text-muted-foreground text-xs'>
                {t('Actual Model:')}
              </span>
              <span className='min-w-0 font-mono text-xs font-medium [overflow-wrap:anywhere]'>
                {props.actualModel}
              </span>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function ResponseModelDetails(props: {
  observation: NonNullable<LogOtherData['response_model']>
}) {
  const { t } = useTranslation()
  const rows = [
    { label: t('Request Model'), value: props.observation.requested_model },
    {
      label: t('Upstream Model'),
      value:
        props.observation.upstream_model || props.observation.requested_model,
    },
    { label: t('Response Model'), value: props.observation.returned_model },
  ]
  return (
    <div className='min-w-0 space-y-2'>
      {props.observation.mismatch && (
        <StatusBadge
          icon={AlertTriangle}
          label={t('Response model: {{model}}', {
            model: props.observation.returned_model,
          })}
          variant='warning'
          copyable={false}
        />
      )}
      <dl className='space-y-2 text-xs'>
        {rows.map((row) => (
          <div
            key={row.label}
            className='flex items-start justify-between gap-3'
          >
            <dt className='text-muted-foreground shrink-0'>{row.label}</dt>
            <dd className='min-w-0 text-right font-mono font-medium [overflow-wrap:anywhere]'>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      {props.observation.mismatch && (
        <p className='text-muted-foreground text-xs'>
          {t(
            'The upstream returned a model name different from both the requested and upstream models. Aliases or dated versions may also cause this; this warning alone does not prove model substitution.'
          )}
        </p>
      )}
    </div>
  )
}
