import './styles.css'
import { platform } from '#platform'
import { BACKUP_KEY, hydrate, SAVE_KEY } from './core/storage'
import type { Route, Screen } from './ui/app'
import { errorScreen, installErrorHandlers, logError } from './ui/errors'
import { habitsScreen } from './ui/habits'
import { homeScreen } from './ui/home'
import { playScreen } from './ui/play'
import { recordsScreen } from './ui/records'
import { resultScreen } from './ui/result'
import { closeAllSheets, closeTopSheet, confirmSheet } from './ui/sheet'

installErrorHandlers()

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
}

/**
 * Platform back: closes the top sheet, else asks the screen, else goes home.
 * False on home, so the platform can leave the app.
 */
export function handleBack(): boolean {
  if (closeTopSheet()) return true
  if (current?.back) return current.back()
  if (currentRoute === 'home') return false
  go({ name: 'home' })
  return true
}

function confirmExit() {
  confirmSheet({
    title: 'HOLD를 끝낼까요?',
    body: '오늘의 기록은 저장돼 있어요.',
    confirm: '끝내기',
    cancel: '계속하기',
    onConfirm: () => void platform.exit(),
    onCancel: () => {},
  })
}

/** Resolves to null if the shell's storage doesn't answer in time. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))])
}

async function boot() {
  await platform.init()
  // The Toss app keeps the save in its own async storage; load it before the
  // first render. Browsers and the native apps keep using localStorage. The
  // timeout keeps first paint well inside the platform's 10-second rule.
  if (platform.kind === 'toss') {
    const raw = await withTimeout(platform.storage.get(SAVE_KEY).catch(() => null), 2000)
    hydrate(
      raw,
      (next) => platform.storage.set(SAVE_KEY, next),
      (backup) => void platform.storage.set(BACKUP_KEY, backup),
    )
  }
  platform.onBack(() => {
    if (!handleBack()) confirmExit()
  })
  go({ name: 'home' })
}

void boot()
