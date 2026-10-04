import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle } from '@capacitor/haptics'
import { Share } from '@capacitor/share'
import { withQuery } from '../core/url'
import { copyWithToast } from './toast'
import type { HapticKind, Platform } from './types'

/**
 * Browser and Capacitor (iOS/Android app) platform. One file because the
 * apps run this exact web build; the Capacitor plugins load their web
 * fallbacks lazily, so the browser pays almost nothing for them.
 */

const native = Capacitor.isNativePlatform()

/** Where shared links point. The apps have no public origin of their own. */
const SHARE_URL = import.meta.env.VITE_SHARE_URL || 'https://di258294-lang.github.io/-1-/'

const VIBRATE_MS: Record<HapticKind, number> = { press: 10, release: 6, tick: 4 }
const IMPACT: Record<HapticKind, ImpactStyle> = {
  press: ImpactStyle.Medium,
  release: ImpactStyle.Light,
  tick: ImpactStyle.Light,
}

/** The history entry kept above the page on the plain web, so browser back reaches the game first. */
const GUARD = { holdBack: true }
/** Set while exit() walks back past the game, so its own popstate is not taken as a back press. */
let leaving = false

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

  async openUrl(url) {
    try {
      if (native) {
        // The system browser; a WebView that can't open it must not navigate itself.
        return window.open(url, '_system') !== null
      }
      const w = window.open(url, '_blank')
      if (w) {
        w.opener = null
        return true
      }
      // Popup blocked on the plain web: the same tab is still a browser tab.
      window.location.href = url
      return true
    } catch {
      return false
    }
  },

  onOpenUrl(handler) {
    if (!native) return () => {}
    let removed = false
    const pending = App.addListener('appUrlOpen', (e) => handler(e.url))
    return () => {
      if (removed) return
      removed = true
      pending.then((h) => h.remove()).catch(() => {})
    }
  },

  onBack(handler) {
    if (!native) {
      // Browser back: one guard entry sits above the page. Back pops it, the
      // game handles it like the Android button, and the guard goes back.
      const onPop = () => {
        if (leaving) return
        try {
          history.pushState(GUARD, '')
        } catch {
          return
        }
        handler()
      }
      // Armed on the first tap or key: browsers skip history entries that a
      // page adds before the user has touched it.
      const arm = () => {
        try {
          if (!(history.state as typeof GUARD | null)?.holdBack) history.pushState(GUARD, '')
        } catch {
          // History blocked (sandboxed frame): back leaves, as before.
        }
      }
      const opts = { capture: true, once: true } as const
      window.addEventListener('pointerdown', arm, opts)
      window.addEventListener('keydown', arm, opts)
      window.addEventListener('popstate', onPop)
      return () => {
        window.removeEventListener('pointerdown', arm, opts)
        window.removeEventListener('keydown', arm, opts)
        window.removeEventListener('popstate', onPop)
      }
    }
    let removed = false
    const pending = App.addListener('backButton', () => handler())
    return () => {
      if (removed) return
      removed = true
      pending.then((h) => h.remove()).catch(() => {})
    }
  },

  async exit() {
    if (!native) {
      // Past the guard and the game, to wherever the player came from.
      leaving = true
      setTimeout(() => (leaving = false), 1000)
      history.go(-2)
      return
    }
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
