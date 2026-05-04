import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { isConstrainedBrowserRequiringDeferredSync } from '../app/utils/browser-capabilities'

describe('browser capabilities', () => {
  let originalNavigator: Navigator

  beforeEach(() => {
    originalNavigator = global.navigator
  })

  afterEach(() => {
    // Restore original navigator
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true
    })
  })

  const mockUserAgent = (userAgent: string) => {
    Object.defineProperty(global, 'navigator', {
      value: {
        userAgent
      },
      writable: true,
      configurable: true
    })
  }

  describe('isConstrainedBrowserRequiringDeferredSync', () => {
    it('returns false for desktop Chrome on Windows', () => {
      mockUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
      expect(isConstrainedBrowserRequiringDeferredSync()).toBe(false)
    })

    it('returns false for desktop Firefox on macOS', () => {
      mockUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0')
      expect(isConstrainedBrowserRequiringDeferredSync()).toBe(false)
    })

    it('returns false for desktop Safari on macOS', () => {
      mockUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15')
      expect(isConstrainedBrowserRequiringDeferredSync()).toBe(false)
    })

    it('returns false for desktop Edge on Windows', () => {
      mockUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0')
      expect(isConstrainedBrowserRequiringDeferredSync()).toBe(false)
    })

    it('returns true for iPhone Safari', () => {
      mockUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')
      expect(isConstrainedBrowserRequiringDeferredSync()).toBe(true)
    })

    it('returns true for iPad Safari', () => {
      mockUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')
      expect(isConstrainedBrowserRequiringDeferredSync()).toBe(true)
    })

    it('returns true for iPod touch', () => {
      mockUserAgent('Mozilla/5.0 (iPod touch; CPU iPhone 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1')
      expect(isConstrainedBrowserRequiringDeferredSync()).toBe(true)
    })

    it('returns true for Android Chrome', () => {
      mockUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36')
      expect(isConstrainedBrowserRequiringDeferredSync()).toBe(true)
    })

    it('returns true for Android Firefox', () => {
      mockUserAgent('Mozilla/5.0 (Android 13; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0')
      expect(isConstrainedBrowserRequiringDeferredSync()).toBe(true)
    })

    it('returns true for Samsung Internet on Android', () => {
      mockUserAgent('Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36')
      expect(isConstrainedBrowserRequiringDeferredSync()).toBe(true)
    })

    it('returns true for BlackBerry browser', () => {
      mockUserAgent('Mozilla/5.0 (BlackBerry; U; BlackBerry 9900; en) AppleWebKit/534.11+ (KHTML, like Gecko) Version/7.1.0.346 Mobile Safari/534.11+')
      expect(isConstrainedBrowserRequiringDeferredSync()).toBe(true)
    })

    it('returns true for Opera Mini', () => {
      mockUserAgent('Opera/9.80 (J2ME/MIDP; Opera Mini/9.80 (S60; SymbOS; Opera Mobi/23.348; U; en) Presto/2.5.25 Version/10.54')
      expect(isConstrainedBrowserRequiringDeferredSync()).toBe(true)
    })

    it('returns true for IEMobile', () => {
      mockUserAgent('Mozilla/5.0 (compatible; MSIE 10.0; Windows Phone 8.0; Trident/6.0; IEMobile/10.0; ARM; Touch)')
      expect(isConstrainedBrowserRequiringDeferredSync()).toBe(true)
    })

    it('returns false when navigator is undefined (SSR context)', () => {
      Object.defineProperty(global, 'navigator', {
        value: undefined,
        writable: true,
        configurable: true
      })
      expect(isConstrainedBrowserRequiringDeferredSync()).toBe(false)
    })

    it('handles case-insensitive user agent matching', () => {
      mockUserAgent('Mozilla/5.0 (IPHONE; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15')
      expect(isConstrainedBrowserRequiringDeferredSync()).toBe(true)

      mockUserAgent('Mozilla/5.0 (ANDROID 13; Mobile) AppleWebKit/537.36')
      expect(isConstrainedBrowserRequiringDeferredSync()).toBe(true)
    })
  })
})
