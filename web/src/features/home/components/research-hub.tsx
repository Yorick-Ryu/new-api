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
  BookOpen01Icon,
  Chat01Icon,
  CodeIcon,
  QuillWrite01Icon,
  SparklesIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
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
    detailKey:
      'Connect Codex, Cursor, Claude Code and Python scripts through one consistent API endpoint and key.',
    icon: Chat01Icon,
  },
  {
    id: 'writing',
    labelKey: 'Academic writing',
    descriptionKey: 'Polishing · Structure · Submission',
    detailKey:
      'Polish manuscripts, refine structure, and draft reviewer responses with long-context precision.',
    icon: QuillWrite01Icon,
  },
  {
    id: 'literature',
    labelKey: 'Literature workflows',
    descriptionKey: 'Reading · Summarizing · Analysis',
    detailKey:
      'Read dense papers, extract structured tables, and synthesize cross-paper findings efficiently.',
    icon: BookOpen01Icon,
  },
  {
    id: 'code',
    labelKey: 'Code experiments',
    descriptionKey: 'Debugging · Refactoring · Engineering',
    detailKey:
      'Debug experiments, refactor analysis notebooks, and accelerate reproducible research code.',
    icon: CodeIcon,
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
  const activeCapability = capabilities.find((item) => item.id === active)
  const defaultLogo = !logo || logo === DEFAULT_LOGO || logo === '/logo.png'

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const center = map.querySelector<HTMLElement>('.research-hub-logo-frame')
    const nodes = [...map.querySelectorAll<HTMLElement>('.research-hub-node')]
    if (!center || nodes.length !== capabilities.length) return

    const measure = () => {
      const bounds = map.getBoundingClientRect()
      const hub = center.getBoundingClientRect()
      if (!bounds.width) return
      setPaths(
        nodes.map((node, index) => {
          const box = node.getBoundingClientRect()
          const left = index % 2 === 0
          const above = box.bottom <= hub.top
          const below = box.top >= hub.bottom
          const overlapsHub = box.left < hub.right && box.right > hub.left
          if (overlapsHub && (above || below)) {
            const x = box.left + box.width / 2 - bounds.left
            const y = (above ? box.bottom : box.top) - bounds.top
            const cx = (left ? hub.left : hub.right) - bounds.left
            const cy = hub.top + hub.height / 2 - bounds.top
            const approach = y + (above ? 24 : -24)
            return `M ${cx} ${cy} C ${x} ${cy}, ${x} ${approach}, ${x} ${y}`
          }
          const x = (left ? box.right : box.left) - bounds.left
          const y = box.top + box.height / 2 - bounds.top
          const cx = (left ? hub.left : hub.right) - bounds.left
          const cy = hub.top + hub.height / 2 - bounds.top
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
    return () => observer.disconnect()
  }, [])

  return (
    <div
      className='research-hub'
      role='group'
      aria-label={t('Unified model access')}
      data-has-active={active ? 'true' : 'false'}
    >
      <div className='research-hub-canvas'>
        <div
          className='research-hub-map'
          ref={mapRef}
          data-has-active={active ? 'true' : 'false'}
        >
          <svg className='research-hub-connections' aria-hidden='true'>
            {paths.map((path, index) => (
              <g
                key={capabilities[index].id}
                className={cn(
                  'research-hub-connection',
                  active === capabilities[index].id && 'is-active'
                )}
              >
                <path d={path} className='research-hub-glow' />
                <path d={path} className='research-hub-wire' />
                <path
                  d={path}
                  pathLength='100'
                  className='research-hub-pulse'
                />
              </g>
            ))}
          </svg>
          <div className='research-hub-brand'>
            <span className='research-hub-logo-frame'>
              <span className='research-hub-halo' aria-hidden='true' />
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
                <HugeiconsIcon icon={capability.icon} aria-hidden='true' />
              </span>
              <span className='research-hub-title'>
                {t(capability.labelKey)}
              </span>
              <span className='research-hub-description'>
                {t(capability.descriptionKey)}
              </span>
              <span className='research-hub-port' aria-hidden='true' />
            </Button>
          ))}
        </div>
        <div
          className='research-hub-detail'
          aria-live='polite'
          data-active={activeCapability ? activeCapability.id : 'idle'}
        >
          <span className='research-hub-detail-icon' aria-hidden='true'>
            <HugeiconsIcon
              icon={activeCapability ? activeCapability.icon : SparklesIcon}
              aria-hidden='true'
            />
          </span>
          <div className='research-hub-detail-body'>
            <div className='research-hub-detail-head'>
              <strong className='research-hub-detail-title'>
                {activeCapability
                  ? t(activeCapability.labelKey)
                  : t('Unified OpenAI & Claude compatible gateway')}
              </strong>
              {activeCapability && selected === activeCapability.id && (
                <Badge variant='secondary' className='research-hub-detail-tag'>
                  {t('Pinned')}
                </Badge>
              )}
            </div>
            <p className='research-hub-detail-copy'>
              {activeCapability
                ? t(activeCapability.detailKey)
                : t(
                    'Hover or select a node to inspect each research workflow.'
                  )}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
