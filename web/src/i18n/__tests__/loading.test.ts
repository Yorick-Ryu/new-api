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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

async function initializeLanguage(language: string) {
  localStorage.setItem('i18nextLng', language)
  const config = await import('../config')
  await config.i18nReady
  return config.default
}

beforeEach(() => {
  vi.resetModules()
  // Isolate the real i18next instance from the global test setup.
  vi.doMock('i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('i18next')>()
    return { ...actual, default: actual.createInstance() }
  })
  vi.doUnmock('../locales/fr.json')
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.doUnmock('i18next')
  vi.doUnmock('../locales/fr.json')
  localStorage.clear()
})

describe('on-demand interface translations', () => {
  it('starts in English without loading other language bundles', async () => {
    const i18n = await initializeLanguage('en')

    expect(i18n.t('Sign In')).toBe('Sign In')
    expect(i18n.hasResourceBundle('en', 'translation')).toBe(true)
    for (const language of ['zhCN', 'zhTW', 'fr', 'ru', 'ja', 'vi']) {
      expect(i18n.hasResourceBundle(language, 'translation')).toBe(false)
    }
  })

  it.each([
    ['zhCN', '登录'],
    ['zhTW', '登入'],
    ['fr', 'Se connecter'],
    ['ru', 'Войти'],
    ['ja', 'ログイン'],
    ['vi', 'Đăng nhập'],
  ])(
    'loads saved %s translations before startup completes',
    async (language, label) => {
      const i18n = await initializeLanguage(language)

      expect(i18n.isInitialized).toBe(true)
      expect(i18n.t('Sign In')).toBe(label)
      expect(Object.keys(i18n.store.data).sort()).toEqual(
        ['en', language].sort()
      )
    }
  )

  it('maps a Traditional Chinese browser locale before loading its bundle', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['zh-TW'])
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-TW')
    const config = await import('../config')
    await config.i18nReady

    expect(config.default.language).toBe('zhTW')
    expect(config.default.t('Sign In')).toBe('登入')
    expect(config.default.hasResourceBundle('zhCN', 'translation')).toBe(false)
  })

  it('loads a language when selected and preserves translations when switching back', async () => {
    const i18n = await initializeLanguage('en')

    await i18n.changeLanguage('zhCN')
    expect(i18n.t('Sign In')).toBe('登录')
    expect(i18n.hasResourceBundle('fr', 'translation')).toBe(false)
    await i18n.changeLanguage('fr')
    expect(i18n.t('Sign In')).toBe('Se connecter')
    await i18n.changeLanguage('zhCN')
    expect(i18n.t('Sign In')).toBe('登录')
    expect(localStorage.getItem('i18nextLng')).toBe('zhCN')
  })

  it('falls back to English for an unsupported saved language', async () => {
    const i18n = await initializeLanguage('unsupported-language')

    expect(i18n.t('Sign In')).toBe('Sign In')
    expect(Object.keys(i18n.store.data)).toEqual(['en'])
  })

  it('keeps the English fallback available when a requested chunk fails', async () => {
    vi.doMock('../locales/fr.json', () => {
      throw new Error('Translation chunk could not be downloaded')
    })
    const i18n = await initializeLanguage('fr')

    expect(i18n.isInitialized).toBe(true)
    expect(i18n.t('Sign In')).toBe('Sign In')
    expect(i18n.hasResourceBundle('fr', 'translation')).toBe(false)
  })
})
