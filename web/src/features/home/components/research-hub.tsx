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
import { BookOpen, CodeXml, Feather, MessagesSquare } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useSystemConfig } from '@/hooks/use-system-config'
import { DEFAULT_LOGO } from '@/lib/constants'
import { cn } from '@/lib/utils'

import '@/styles/research-hub.css'

const capabilities = [
  {
    id: 'tools',
    labelKey: 'ChatGPT / Claude',
    descriptionKey: 'Codex · IDE · Scripts',
    icon: MessagesSquare,
  },
  {
    id: 'writing',
    labelKey: 'Academic writing',
    descriptionKey: 'Polishing · Structure · Submission',
    icon: Feather,
  },
  {
    id: 'literature',
    labelKey: 'Literature workflows',
    descriptionKey: 'Reading · Summarizing · Analysis',
    icon: BookOpen,
  },
  {
    id: 'code',
    labelKey: 'Code experiments',
    descriptionKey: 'Debugging · Refactoring · Engineering',
    icon: CodeXml,
  },
] as const

type Capability = (typeof capabilities)[number]['id']

export function ResearchHub() {
  const { t } = useTranslation()
  const { logo, systemName } = useSystemConfig()
  const mapRef = useRef<HTMLDivElement>(null)
  const [paths, setPaths] = useState<string[]>([])
  const [selected, setSelected] = useState<Capability | null>(null)
  const [hovered, setHovered] = useState<Capability | null>(null)
  const [focused, setFocused] = useState<Capability | null>(null)
  const active = hovered ?? focused ?? selected
  const defaultLogo = !logo || logo === DEFAULT_LOGO || logo === '/logo.png'

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const center = map.querySelector<HTMLElement>('.research-hub-logo-frame')
    const nodes = [...map.querySelectorAll<HTMLElement>('.research-hub-node')]
    const icons = [...map.querySelectorAll<HTMLElement>('.research-hub-icon')]
    if (!center || icons.length !== capabilities.length) return

    const measure = () => {
      const bounds = map.getBoundingClientRect()
      const hub = center.getBoundingClientRect()
      if (!bounds.width) return
      const stacked = hub.bottom <= nodes[0].getBoundingClientRect().top
      setPaths(
        icons.map((icon, index) => {
          const box = icon.getBoundingClientRect()
          const left = index % 2 === 0
          const x = (left ? box.right : box.left) - bounds.left
          const y = box.top + box.height / 2 - bounds.top
          const cx = (left ? hub.left : hub.right) - bounds.left
          const cy = hub.top + hub.height / 2 - bounds.top
          if (stacked) {
            const lane = cx + (left ? -16 : 16)
            const gutter = bounds.width / 2 + (left ? -3 : 3)
            const join = nodes[0].getBoundingClientRect().top - bounds.top - 8
            return `M ${cx} ${cy} C ${lane} ${cy}, ${lane} ${join}, ${gutter} ${join} L ${gutter} ${y - 8} Q ${gutter} ${y}, ${x} ${y}`
          }
          const mid = (x + cx) / 2
          return `M ${cx} ${cy} C ${mid} ${cy}, ${mid} ${y}, ${x} ${y}`
        })
      )
    }

    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(map)
    observer.observe(center)
    if (center.parentElement) observer.observe(center.parentElement)
    nodes.forEach((element) => observer.observe(element))
    icons.forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [])

  return (
    <div
      className='research-hub'
      role='group'
      aria-label={t('Unified model access')}
    >
      <div className='research-hub-map' ref={mapRef}>
        <svg className='research-hub-connections' aria-hidden='true'>
          {paths.map((path, index) => (
            <g
              key={capabilities[index].id}
              className={cn(
                'research-hub-connection',
                active === capabilities[index].id && 'is-active'
              )}
            >
              <path d={path} className='research-hub-wire' />
              <path d={path} pathLength='100' className='research-hub-pulse' />
            </g>
          ))}
        </svg>
        <div className='research-hub-brand'>
          <span className='research-hub-logo-frame'>
            {defaultLogo ? (
              <span className='research-hub-mark' aria-hidden='true' />
            ) : (
              <img className='research-hub-custom-logo' src={logo} alt='' />
            )}
          </span>
          <span className='research-hub-name'>{systemName}</span>
        </div>
        {capabilities.map((capability) => (
          <Button
            key={capability.id}
            variant='outline'
            className={cn(
              'research-hub-node',
              `research-hub-${capability.id}`,
              active === capability.id && 'is-active'
            )}
            aria-pressed={selected === capability.id}
            onPointerEnter={() => setHovered(capability.id)}
            onPointerLeave={() => setHovered(null)}
            onFocus={() => setFocused(capability.id)}
            onBlur={() => setFocused(null)}
            onClick={() =>
              setSelected(selected === capability.id ? null : capability.id)
            }
          >
            <span className='research-hub-icon'>
              <capability.icon aria-hidden='true' />
              <span className='research-hub-port' aria-hidden='true' />
            </span>
            <span className='research-hub-title'>{t(capability.labelKey)}</span>
            <span className='research-hub-description'>
              {t(capability.descriptionKey)}
            </span>
          </Button>
        ))}
      </div>
    </div>
  )
}
