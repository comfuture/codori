/**
 * Determines if the current browser requires deferred reactivation sync due to
 * background streaming limitations (e.g., mobile browsers that suspend background tasks).
 *
 * Desktop browsers with reliable SSE support should return false to maintain continuous streaming.
 * Mobile browsers with known background restrictions should return true to use reactivation sync.
 *
 * @returns true if the browser is constrained and needs deferred sync, false otherwise
 */
export function isConstrainedBrowserRequiringDeferredSync(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }

  const userAgent = navigator.userAgent.toLowerCase()

  // Check for mobile platforms that typically suspend background tasks
  const isMobileDevice = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent)

  // iOS/iPadOS browsers are particularly aggressive about suspending background tabs
  const isIOSDevice = /iphone|ipad|ipod/i.test(userAgent)

  // Android browsers also commonly suspend background network activity
  const isAndroidDevice = /android/i.test(userAgent)

  // For now, use deferred sync only for mobile browsers
  // Desktop browsers (Chrome, Firefox, Safari on macOS, Edge) should stream continuously
  return isMobileDevice || isIOSDevice || isAndroidDevice
}
