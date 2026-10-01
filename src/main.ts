import './styles.css'
import type { Route, Screen } from './ui/app'
import { habitsScreen } from './ui/habits'
import { homeScreen } from './ui/home'
import { playScreen } from './ui/play'
import { resultScreen } from './ui/result'

const root = document.getElementById('app')!
let current: Screen | null = null

function go(route: Route) {
  current?.destroy?.()
  root.replaceChildren()
  switch (route.name) {
    case 'home':
      current = homeScreen(go)
      break
    case 'play':
      current = playScreen(go, route.mode, route.market)
      break
    case 'result':
      current = resultScreen(go, route.mode, route.market, route.result, route.unlocked ?? [])
      break
    case 'habits':
      current = habitsScreen(go)
      break
  }
  root.append(current.el)
  window.scrollTo(0, 0)
}

go({ name: 'home' })
