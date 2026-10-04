import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { Share } from '@capacitor/share'
import { copyWithToast } from './toast'
import type { HapticKind, Platform } from './types'

/**
 * Browser and Capacitor (iOS/Android app) platform. One file because the
 * apps run this exact web build; the Capacitor plugins load their web
 * fallbacks lazily, so the browser pays almost nothing for them.
 */

const native = Capacitor.isNativePlatform()

/** Where shared links point. The apps have no public origin of their own. */
export const SHARE_URL = import.meta.env.VITE_SHARE_URL || 'https://di258294-lang.github.io/-1-/'

const VIBRATE_MS: Record<HapticKind, number> = { press: 10, release: 6, tick: 4 }
const IMPACT: Record<HapticKind, ImpactStyle> = {
  press: ImpactStyle.Medium,
  release: ImpactStyle.Light,
  tick: ImpactStyle.Light,
}

const isCancel = (err: unknown) =>
  (err as DOMException)?.name === 'AbortError' || /cancel/i.test(String((err as Error)?.message ?? err))

export const platform: Platform = {
  kind: native ? 'capacitor' : 'web',

  async init() {
    if (native) document.documentElement.classList.add('native')
  },

  haptic(kind) {
    if (native) {
      Haptics.impact({ style: IMPACT[kind] }).catch(() => {})
      return
    }
    try {
      navigator.vibrate?.(VIBRATE_MS[kind])
    } catch {
      // Not supported. Fine.
    }
  },

  async share(text) {
    // Android's WebView has no navigator.share, so the apps go through the
    // native plugin.
    if (native) {
      try {
        await Share.share({ text })
        return
      } catch (err) {
        if (isCancel(err)) return
      }
    } else if (navigator.share) {
      try {
        await navigator.share({ text })
        return
      } catch (err) {
        if (isCancel(err)) return
      }
    }
    await copyWithToast(text)
  },

  async shareUrl(query) {
    return query ? withQuery(SHARE_URL, query) : SHARE_URL
  },

  storage: {
    async get(key) {
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    },
    async set(key, value) {
      try {
        localStorage.setItem(key, value)
      } catch {
        // Private mode or full storage. The game still works for this session.
      }
    },
  },

  async userKey() {
    return null
  },

  onBack(handler) {
    if (!native) return () => {}
    let removed = false
    const pending = App.addListener('backButton', () => handler())
    return () => {
      if (removed) return
      removed = true
      pending.then((h) => h.remove()).catch(() => {})
    }
  },

  async exit() {
    if (!native) return
    try {
      // Android only; iOS apps may not quit themselves.
      await App.exitApp()
    } catch {
      // Unimplemented on iOS.
    }
  },

  setSwipeBack() {
    // Capacitor's WKWebView has back/forward gestures off already.
  },
}

export default platform

/** `base` with `query` appended, keeping any query or hash it already has. */
export function withQuery(base: string, query: string) {
  const hashAt = base.indexOf('#')
  const head = hashAt < 0 ? base : base.slice(0, hashAt)
  const hash = hashAt < 0 ? '' : base.slice(hashAt)
  const sep = head.includes('?') ? (/[?&]$/.test(head) ? '' : '&') : '?'
  return `${head}${sep}${query}${hash}`
}
