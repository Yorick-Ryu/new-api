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
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

export type PlansSectionId = 'recharge' | 'subscriptions'

function getInitialSection(): PlansSectionId {
  if (
    typeof window !== 'undefined' &&
    window.location.hash === '#subscriptions'
  ) {
    return 'subscriptions'
  }
  return 'recharge'
}

/**
 * Coordinates progressive scroll-reveal fallbacks and section navigation state
 * for the plans catalog.
 *
 * Browsers supporting CSS `animation-timeline: view()` and `animation-range: entry`
 * drive section reveals on the compositor thread without JS; older browsers fall
 * back to an IntersectionObserver while reduced-motion users stay in the static
 * final state.
 */
export function usePlansMotion(
  containerRef: RefObject<HTMLElement | null>,
  revealKey: number
): {
  activeSection: PlansSectionId
  selectSection: (section: PlansSectionId) => void
} {
  const [activeSection, setActiveSection] =
    useState<PlansSectionId>(getInitialSection)
  const manualLockUntilRef = useRef(0)

  const selectSection = useCallback((section: PlansSectionId) => {
    manualLockUntilRef.current = Date.now() + 650
    setActiveSection(section)
  }, [])

  useEffect(() => {
    const root = containerRef.current
    if (!root || typeof window === 'undefined') return
    if (typeof IntersectionObserver === 'undefined') return
    if (
      typeof window.matchMedia !== 'function' ||
      !window.matchMedia('(prefers-reduced-motion: no-preference)').matches
    ) {
      return
    }
    if (
      typeof CSS !== 'undefined' &&
      typeof CSS.supports === 'function' &&
      CSS.supports('(animation-timeline: view()) and (animation-range: entry)')
    ) {
      return
    }

    const targets = [...root.querySelectorAll<HTMLElement>('[data-reveal]')]
    if (targets.length === 0) return

    const foldThreshold = window.innerHeight * 0.96
    const belowFold: HTMLElement[] = []

    for (const target of targets) {
      if (target.dataset.revealState === 'visible') continue
      if (target.getBoundingClientRect().top > foldThreshold) {
        target.dataset.revealState = 'pending'
        belowFold.push(target)
      }
    }

    if (belowFold.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const element = entry.target as HTMLElement
          element.dataset.revealState = 'visible'
          observer.unobserve(element)
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -24px 0px' }
    )

    for (const target of belowFold) {
      observer.observe(target)
    }

    return () => {
      observer.disconnect()
      for (const target of belowFold) {
        delete target.dataset.revealState
      }
    }
  }, [containerRef, revealKey])

  useEffect(() => {
    const root = containerRef.current
    if (!root || typeof window === 'undefined') return
    if (typeof IntersectionObserver === 'undefined') return

    const recharge = root.querySelector<HTMLElement>('#recharge')
    const subscriptions = root.querySelector<HTMLElement>('#subscriptions')
    const observed = [recharge, subscriptions].filter(
      (node): node is HTMLElement => node !== null
    )
    if (observed.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() < manualLockUntilRef.current) return
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const id = entry.target.id
          if (id === 'recharge' || id === 'subscriptions') {
            setActiveSection(id)
          }
        }
      },
      { rootMargin: '-24% 0px -56% 0px', threshold: 0 }
    )

    for (const section of observed) {
      observer.observe(section)
    }

    return () => {
      observer.disconnect()
    }
  }, [containerRef])

  return { activeSection, selectSection }
}
