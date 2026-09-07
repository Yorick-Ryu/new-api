import { cleanup, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, expect, it } from 'vitest'

import { ModelStatus } from '../components/model-status'

const i18n = createInstance()
await i18n.init({ lng: 'en', resources: { en: { translation: {} } } })
afterEach(cleanup)
function mount(name: string, icon?: string) {
  render(
    <I18nextProvider i18n={i18n}>
      <ModelStatus
        model={{
          model_name: name,
          icon,
          series: [],
          success_rate: null,
          avg_ttft_ms: null,
          avg_tps: null,
          avg_latency_ms: null,
        }}
        start={0}
        end={1800}
        step={1800}
        hours={24}
      />
    </I18nextProvider>
  )
}
it.each([
  ['grok-4.6', 'Grok'],
  ['DeepSeek-V4-Pro', 'DeepSeek'],
  ['GLM-5.2', 'Zhipu'],
  ['MiniMax-M2.5', 'Minimax'],
  ['LongCat-2.0', 'LongCat'],
])('shows the brand icon for %s without configured metadata', (name, title) => {
  mount(name)
  expect(screen.getByTitle(title)).toBeTruthy()
})
it('preserves an explicitly configured icon over the model-name fallback', () => {
  mount('grok-4.6', 'OpenAI')
  expect(screen.getByTitle('OpenAI')).toBeTruthy()
  expect(screen.queryByTitle('Grok')).toBeNull()
})
