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
import { useEffect, type RefObject } from 'react'

export function useHomeScrollReveal(
  containerRef: RefObject<HTMLElement | null>
): void {
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
    const targets = [
      ...root.querySelectorAll<HTMLElement>('[data-reveal], [data-reveal-bar]'),
    ].filter(
      (target) => target.getBoundingClientRect().top >= window.innerHeight
    )
    if (!targets.length) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const element = entry.target as HTMLElement
          element.dataset.revealState = 'visible'
          observer.unobserve(element)
        }
      },
      { threshold: 0 }
    )

    for (const target of targets) {
      observer.observe(target)
    }

    return () => {
      observer.disconnect()
      for (const target of targets) {
        delete target.dataset.revealState
      }
    }
  }, [containerRef])
}
