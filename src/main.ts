import './styles.css'
import { clearAnnouncements } from './ui/announce'
import { platform } from '#platform'
import { takeChallengeCode } from './core/challenge'
import { blindBackend, configureStorage, hydrateAsync, migrateLegacyNick } from './core/storage'
import type { Route, Screen } from './ui/app'
import { openChallenge, takeChallengeParam } from './ui/challenge'
import { errorScreen, installErrorHandlers, logError } from './ui/errors'
import { habitsScreen } from './ui/habits'
import { homeScreen } from './ui/home'
import { playScreen } from './ui/play'
import { recordsScreen } from './ui/records'
import { initReach } from './ui/reach'
import { resultScreen } from './ui/result'
import { anySheetOpen, closeAllSheets, closeTopSheet, confirmSheet } from './ui/sheet'

installErrorHandlers()

/**
 * A friend's challenge code (?c=...) waiting for the home screen: read and
 * stripped from the address before anything else, so a reload never
 * re-opens it. A link that reaches the running app mid-round waits here too.
 */
let queuedChallenge = takeChallengeParam()

const root = document.getElementById('app')!
let current: Screen | null = null
let currentRoute: Route['name'] | null = null

function build(route: Route): Screen {
  switch (route.name) {
    case 'home':
      return homeScreen(go)
    case 'play':
      return playScreen(go, route.mode, route.market)
    case 'result':
      return resultScreen(go, route.mode, route.market, route.result, route.unlocked ?? [], route.habits, route.record ?? null)
    case 'habits':
      return habitsScreen(go)
    case 'records':
      return recordsScreen(go)
  }
}

function go(route: Route) {
  // Sheets live on body, outside the root: they must not outlive their screen.
  closeAllSheets()
  try {
    current?.destroy?.()
  } catch (err) {
    logError(err, `destroy ${currentRoute}`)
  }
  current = null
  root.replaceChildren()
  // A finished screen's last announcement must not be read out on the next one.
  clearAnnouncements()
  try {
    current = build(route)
    currentRoute = route.name
  } catch (err) {
    logError(err, `build ${route.name}`)
    current = errorScreen(go)
    currentRoute = null
  }
  root.append(current.el)
  window.scrollTo(0, 0)
  if (currentRoute === 'home') openQueuedChallenge()
}

/** Opens a waiting challenge link over home. */
function openQueuedChallenge() {
  const code = queuedChallenge
  if (code === null) return
  queuedChallenge = null
  try {
    openChallenge(go, code)
  } catch (err) {
    logError(err, 'openChallenge')
  }
}

/**
 * Challenge entry for a link that opens the running app (Capacitor
 * appUrlOpen). Over home at once; mid-round or on another screen, it waits
 * for the next home screen.
 */
function onChallengeLink(code: string) {
  queuedChallenge = code
  if (currentRoute === 'home') {
    closeAllSheets()
    openQueuedChallenge()
  }
}

/**
 * Platform back: closes the top sheet, else asks the screen, else goes home.
 * False on home, so the platform can leave the app.
 */
function handleBack(): boolean {
  if (closeTopSheet()) return true
  if (current?.back) return current.back()
  if (currentRoute === 'home') return false
  go({ name: 'home' })
  return true
}

function confirmExit() {
  // A browser tab just goes back to where the player came from.
  if (platform.kind === 'web') {
    void platform.exit()
    return
  }
  confirmSheet({
    title: 'HOLD를 끝낼까요?',
    body: '오늘의 기록은 저장돼 있어요.',
    confirm: '끝내기',
    cancel: '계속하기',
    onConfirm: () => void platform.exit(),
    onCancel: () => {},
  })
}

/** The save's backend is in place (Toss loads it asynchronously). */
let storageReady = platform.kind !== 'toss'

async function boot() {
  await platform.init()
  // The Toss app keeps the save in its own async storage; load it before the
  // first render. Browsers and the native apps keep using localStorage. The
  // timeout keeps first paint well inside the platform's 10-second rule; a
  // late answer loads then (the store never writes before it has read).
  if (platform.kind === 'toss') {
    await hydrateAsync(platform.storage, {
      timeoutMs: 2000,
      onLate: () => {
        // Home drew an empty save: draw it again. Other screens pick the
        // loaded save up on their next navigation.
        if ((currentRoute === 'home' || currentRoute === null) && !anySheetOpen()) go({ name: 'home' })
      },
      onError: (err) => logError(err, 'storage load'),
    })
    storageReady = true
  }
  migrateLegacyNick()
  initReach()
  platform.onBack(() => {
    if (!handleBack()) confirmExit()
  })
  platform.onOpenUrl((url) => {
    const { code } = takeChallengeCode(url)
    if (code !== null) onChallengeLink(code)
  })
  go({ name: 'home' })
}

boot().catch((err) => {
  logError(err, 'boot')
  // Never write over a save that was not read.
  if (!storageReady) configureStorage(blindBackend())
  if (!current) go({ name: 'home' })
})
