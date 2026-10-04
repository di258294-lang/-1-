import {
  Device,
  getUserKeyForGame,
  graniteEvent,
  SafeArea,
  Screen,
  Share,
  Storage,
  User,
  type HapticFeedbackType,
} from '@apps-in-toss/web-framework'
import { copyWithToast } from './toast'
import type { HapticKind, Platform } from './types'

/**
 * Apps in Toss (WebView mini-app, SDK 3.x). Only `vite build --mode toss`
 * resolves '#platform' to this file, so web and Capacitor bundles never
 * include the SDK.
 */

const APP_NAME = import.meta.env.VITE_AIT_APP_NAME || 'TODO-appName'

const HAPTIC: Record<HapticKind, HapticFeedbackType> = {
  press: 'tickMedium',
  release: 'tickWeak',
  tick: 'tap',
}

type Insets = { top: number; bottom: number; left: number; right: number }

function applyInsets(insets: Insets) {
  const root = document.documentElement.style
  // Inline custom properties beat the env()-based :root defaults.
  root.setProperty('--safe-top', `${insets.top}px`)
  root.setProperty('--safe-bottom', `${insets.bottom}px`)
  root.setProperty('--safe-right', `${insets.right}px`)
}

/** Local storage fallback for the devtools mock or a failing bridge call. */
const local = {
  get(key: string) {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value)
    } catch {
      // Full or blocked. Nothing else to do.
    }
  },
}

let linkCache: Promise<string> | null = null

export const platform: Platform = {
  kind: 'toss',

  async init() {
    const root = document.documentElement
    // Toss does not support dark mode; ship the light palette only.
    root.dataset.theme = 'light'
    root.classList.add('toss')
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', '#f2f3f5'))
    try {
      applyInsets(SafeArea.get())
      SafeArea.subscribe({ onEvent: applyInsets })
    } catch {
      // Older Toss app or the devtools mock without insets: keep env().
    }
  },

  haptic(kind) {
    try {
      Device.triggerHaptic({ type: HAPTIC[kind] }).catch(() => {})
    } catch {
      // No bridge (plain browser).
    }
  },

  async share(text) {
    try {
      await Share.sendMessage({ message: text })
    } catch (err) {
      if (/cancel/i.test(String((err as Error)?.message ?? err))) return
      await copyWithToast(text)
    }
  },

  shareUrl(query) {
    // A deep link with a query (a friend challenge) is made fresh each time;
    // the mini-app receives it in location.search.
    if (query) {
      const path = `intoss://${APP_NAME}?${query}`
      return Promise.resolve()
        .then(() => Share.createLink({ path }))
        .catch(() => path)
    }
    // A toss.im link that opens the mini-app (installs Toss if needed).
    linkCache ??= Promise.resolve()
      .then(() => Share.createLink({ path: `intoss://${APP_NAME}` }))
      .catch(() => {
        linkCache = null
        return `intoss://${APP_NAME}`
      })
    return linkCache
  },

  storage: {
    // Toss storage survives WebView data clears and SDK origin changes; fall
    // back to localStorage so a missing bridge never loses the save.
    async get(key) {
      try {
        const value = await Storage.getItem(key)
        if (value !== null && value !== undefined) return value
      } catch {
        // Fall through.
      }
      return local.get(key)
    },
    async set(key, value) {
      local.set(key, value)
      try {
        await Storage.setItem(key, value)
      } catch {
        // localStorage still has it.
      }
    },
  },

  async userKey() {
    try {
      return (await User.getAnonymousKey()).hash
    } catch {
      // UNSUPPORTED_APP_VERSION on older Toss apps: the 2.x game key.
    }
    try {
      const res = await getUserKeyForGame()
      return res && typeof res === 'object' ? res.hash : null
    } catch {
      return null
    }
  },

  onBack(handler) {
    // Subscribing blocks Toss's default back, so the handler owns it.
    try {
      return graniteEvent.addEventListener('backEvent', { onEvent: handler, onError: () => {} })
    } catch {
      return () => {}
    }
  },

  async exit() {
    try {
      await Screen.close()
    } catch {
      // Nothing to close in the devtools mock.
    }
  },

  setSwipeBack(on) {
    try {
      Screen.setIosSwipeBack({ isEnabled: on }).catch(() => {})
    } catch {
      // No bridge (plain browser).
    }
  },
}

export default platform
