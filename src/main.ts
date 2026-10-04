import './styles.css'
import type { Route, Screen } from './ui/app'
import { errorScreen, installErrorHandlers, logError } from './ui/errors'
import { habitsScreen } from './ui/habits'
import { homeScreen } from './ui/home'
import { playScreen } from './ui/play'
import { resultScreen } from './ui/result'
import { closeAllSheets, closeTopSheet } from './ui/sheet'

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

go({ name: 'home' })
