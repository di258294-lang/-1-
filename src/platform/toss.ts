import {
  Device,
  Game,
  graniteEvent,
  Review,
  SafeArea,
  Screen,
  Share,
  Storage,
  type HapticFeedbackType,
} from '@apps-in-toss/web-framework'
import { copyWithToast } from './toast'
import type { HapticKind, Platform, PlatformLeaderboard } from './types'

/**
 * Apps in Toss (WebView mini-app, SDK 3.x). Only `vite build --mode toss`
 * resolves '#platform' to this file, so web and Capacitor bundles never
 * include the SDK.
 */

/** The console appName (.env.toss); apps-in-toss.config.ts refuses to build without a real one. */
const APP_NAME = import.meta.env.VITE_AIT_APP_NAME ?? ''

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
  /** False when localStorage is full or blocked. */
  set(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value)
      return true
    } catch {
      return false
    }
  },
}

let linkCache: Promise<string> | null = null

/** isSupported() of an SDK call, false when the bridge itself is missing. */
function can(fn: unknown): boolean {
  try {
    const check = (fn as { isSupported?: () => boolean } | undefined)?.isSupported
    return typeof fn === 'function' && (typeof check !== 'function' || check() !== false)
  } catch {
    return false
  }
}

/**
 * The Toss game center leaderboard (SDK 3.x `Game.setLeaderboardScore` /
 * `Game.openLeaderboard`, the successors of submitGameCenterLeaderBoardScore /
 * openGameCenterLeaderboard). One board per mini-app; its unit, sort order
 * and policy are set in the console (docs/RELEASE.md). Feature-checked at
 * every call, so an SDK or Toss app without it simply hides the entry.
 */
const leaderboard: PlatformLeaderboard = {
  supported() {
    return can(Game?.setLeaderboardScore) && can(Game?.openLeaderboard)
  },

  async submit(score) {
    if (!Number.isFinite(score) || !can(Game?.setLeaderboardScore)) return 'failed'
    try {
      // The API takes a float as a string ("123.45" or "9999").
      const res = await Game.setLeaderboardScore({ score: String(Math.round(score)) })
      if (res?.statusCode === 'SUCCESS') return 'ok'
      if (res?.statusCode === 'PROFILE_NOT_FOUND') return 'no-profile'
      return 'failed'
    } catch {
      // Not a game mini-app, not approved yet, or no bridge.
      return 'failed'
    }
  },

  async open() {
    if (!can(Game?.openLeaderboard)) return false
    try {
      // Toss sends the mini-app to the background while the board is open.
      await Game.openLeaderboard()
      return true
    } catch {
      return false
    }
  },
}

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
    // Rejects only when neither copy was stored, so the save can flag it.
    async set(key, value) {
      const kept = local.set(key, value)
      try {
        await Storage.setItem(key, value)
      } catch (err) {
        if (!kept) throw err
        // localStorage still has it.
      }
    },
  },

  async openUrl(url) {
    try {
      await Device.openURL(url)
      return true
    } catch {
      return false
    }
  },

  onOpenUrl() {
    // A Toss deep link restarts the mini-app with its query.
    return () => {}
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

  leaderboard,

  // No local reminders in Toss. Its only route is a 푸시알림 template that
  // Toss sends after a console review, and its guide bars retention-purpose
  // messages; a "today's chart is open" nudge is exactly that (docs/RELEASE.md).
  reminders: null,

  // Toss decides whether the rating sheet shows (fatigue policy) and never
  // says what the player did, by design.
  requestReview: async () => {
    if (!can(Review?.request)) return
    try {
      await Review.request()
    } catch {
      // Older Toss app or no bridge.
    }
  },
}

export default platform
