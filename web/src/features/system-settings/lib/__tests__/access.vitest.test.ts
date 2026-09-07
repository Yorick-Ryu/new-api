import { describe, expect, it } from 'vitest'

import { ROLE } from '@/lib/roles'

import { canAccessSystemSettings } from '../access'

describe('System settings access', () => {
  it('keeps service status management accessible to administrators at its new location', () => {
    expect(
      canAccessSystemSettings(
        ROLE.ADMIN,
        '/system-settings/operations/service-status'
      )
    ).toBe(true)
    expect(
      canAccessSystemSettings(
        ROLE.ADMIN,
        '/system-settings/operations/service-status/'
      )
    ).toBe(true)
  })
  it('continues blocking other system settings for non-root administrators', () => {
    expect(
      canAccessSystemSettings(ROLE.ADMIN, '/system-settings/operations/alerts')
    ).toBe(false)
    expect(canAccessSystemSettings(ROLE.ADMIN, '/system-settings/site')).toBe(
      false
    )
    expect(
      canAccessSystemSettings(
        ROLE.ADMIN,
        '/system-settings/operations/service-status/extra'
      )
    ).toBe(false)
  })
  it('blocks ordinary users and anonymous visitors from management', () => {
    expect(
      canAccessSystemSettings(
        ROLE.USER,
        '/system-settings/operations/service-status'
      )
    ).toBe(false)
    expect(
      canAccessSystemSettings(
        undefined,
        '/system-settings/operations/service-status'
      )
    ).toBe(false)
  })
  it('preserves full system settings access for root', () => {
    expect(
      canAccessSystemSettings(
        ROLE.SUPER_ADMIN,
        '/system-settings/operations/alerts'
      )
    ).toBe(true)
    expect(
      canAccessSystemSettings(
        ROLE.SUPER_ADMIN,
        '/system-settings/operations/service-status'
      )
    ).toBe(true)
  })
})
