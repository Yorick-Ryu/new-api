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
import { useTranslation } from 'react-i18next'

import { parseModelMultipliers } from '../lib/model-multipliers'

export function ModelMultiplierSummary(props: { value?: string }) {
  const { t } = useTranslation()
  const rows = parseModelMultipliers(props.value)
  if (rows.length === 0) {
    return null
  }

  return (
    <div className='space-y-1 text-xs'>
      <p className='font-medium'>{t('Subscription model group overrides')}</p>
      {rows.map((row) => (
        <p key={row.model} className='text-muted-foreground break-words'>
          {t(
            '{{model}}: group ratio {{multiplier}}× with this subscription',
            row
          )}
        </p>
      ))}
    </div>
  )
}
