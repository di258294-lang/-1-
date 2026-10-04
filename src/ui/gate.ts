import { dateKey, dayNumber, dailySeed } from '../core/daily'
import { generateMarket } from '../core/market'
import { dailyProduct } from '../core/products'
import { save } from '../core/storage'
import type { Navigate } from './app'
import { logError } from './errors'
import { showIntro } from './intro'
import { startTutorial } from './tutorial'

function seen() {
  try {
    return save.seenIntro()
  } catch {
    return true
  }
}

/**
 * The one "rules first" gate (arch2 P1-1). Before the intro has been seen:
 * - `via: 'tutorial'` (home) runs the guided tutorial round instead of
 *   `start`; the tutorial's own finish marks the intro seen.
 * - `via: 'rules'` (records replay, a friend's challenge) shows the rules
 *   sheet, then `start`, and marks nothing, so the next 시작하기 on home
 *   still gets the tutorial before the irreversible daily chart.
 */
export function withIntro(go: Navigate, start: () => void, via: 'tutorial' | 'rules' = 'tutorial') {
  if (seen()) return start()
  if (via === 'tutorial') startTutorial(go)
  else showIntro(start)
}

/** Today's daily chart, or home when it is done or the date rolled over. */
export function startDaily(go: Navigate, key = dateKey()) {
  try {
    if (dateKey() !== key || save.daily(key)) return go({ name: 'home' })
    const market = generateMarket(dailySeed(key), dailyProduct(key))
    go({ name: 'play', mode: { kind: 'daily', key, day: dayNumber(key) }, market })
  } catch (err) {
    logError(err, 'startDaily')
    go({ name: 'home' })
  }
}

/** True once today's daily chart has a record (played or abandoned). */
export function dailyDone(key = dateKey()) {
  try {
    return save.daily(key) !== undefined
  } catch {
    return false
  }
}
