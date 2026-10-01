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
import {
  BarChartIcon,
  CodeSquareIcon,
  BookOpenIcon,
  MessageSquarePlusIcon,
  NotepadTextIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

type PlaygroundEmptyStateProps = {
  onSelectPrompt: (prompt: string) => void
}

export function PlaygroundEmptyState({
  onSelectPrompt,
}: PlaygroundEmptyStateProps) {
  const { t } = useTranslation()
  const starterPrompts = [
    {
      icon: BookOpenIcon,
      label: t('Read a paper'),
      prompt: t(
        'Please analyze the paper excerpt below: summarize the research question, methods, main findings, and limitations. Distinguish the authors’ claims from your interpretation, and do not invent references.\n\nPaper excerpt:\n'
      ),
    },
    {
      icon: NotepadTextIcon,
      label: t('Polish a manuscript'),
      prompt: t(
        'Please polish the manuscript passage below for clarity, logic, and academic tone. Preserve the original meaning, data, and strength of claims. Provide the revised text and explain key edits.\n\nTarget language or journal:\nPassage:\n'
      ),
    },
    {
      icon: BarChartIcon,
      label: t('Analyze research data'),
      prompt: t(
        'Please propose a reproducible analysis plan for the research question and data described below, including cleaning, statistical methods, assumptions, and visualizations. Identify missing information first; do not invent results.\n\nResearch question:\nData and variables:\n'
      ),
    },
    {
      icon: CodeSquareIcon,
      label: t('Write research code'),
      prompt: t(
        'Please help implement the research task below with reproducible code. Explain dependencies, inputs, outputs, and validation steps. Identify missing requirements before making assumptions.\n\nResearch task:\nLanguage and environment:\nInput data example:\n'
      ),
    },
  ]

  return (
    <div className='flex min-h-[min(520px,calc(100svh-18rem))] items-center justify-center px-1 py-8 md:py-12'>
      <div className='grid w-full max-w-2xl gap-5 text-center'>
        <div className='bg-muted/50 text-muted-foreground mx-auto flex size-11 items-center justify-center rounded-xl border'>
          <MessageSquarePlusIcon className='size-5' aria-hidden='true' />
        </div>

        <div className='grid gap-2'>
          <h2 className='text-xl font-semibold tracking-tight text-balance md:text-2xl'>
            {t('Start your research here')}
          </h2>
          <p className='text-muted-foreground mx-auto max-w-lg text-sm leading-6 text-balance'>
            {t(
              'Choose a research task, then add your materials and requirements before sending.'
            )}
          </p>
        </div>

        <div className='grid gap-2 sm:grid-cols-2'>
          {starterPrompts.map(({ icon: Icon, label, prompt }) => {
            return (
              <Button
                className='h-auto min-h-11 justify-start gap-2 px-3 py-2.5 text-left whitespace-normal'
                key={label}
                onClick={() => onSelectPrompt(prompt)}
                variant='outline'
              >
                <Icon className='text-muted-foreground size-4' />
                <span>{label}</span>
              </Button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
