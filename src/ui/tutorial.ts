import type { Market } from '../core/market'
import { save } from '../core/storage'
import { tutorialMarket } from '../core/tutorial'
import type { Navigate } from './app'
import { logError } from './errors'
import { showIntro } from './intro'

/**
 * The first-launch guided round. It runs through the ordinary play route
 * (practice mode), so app.ts and main.ts need no new route: the market object
 * itself is the flag. play.ts asks isTutorial(market) and, when true, shows
 * coach lines and finishes the round as kind 'tutorial': session.ts keeps
 * it out of the records and marks the tutorial done (save.markIntroSeen).
 */
const tutorials = new WeakSet<Market>()

export function isTutorial(market: Market) {
  return tutorials.has(market)
}

/** Starts the tutorial round. Home calls this instead of the daily chart while !save.seenIntro(). */
export function startTutorial(go: Navigate) {
  let market: Market
  try {
    market = tutorialMarket()
  } catch (err) {
    // Never block the first launch on the tutorial: the rules sheet does its job.
    logError(err, 'tutorialMarket')
    showIntro(() => save.markIntroSeen())
    return
  }
  tutorials.add(market)
  go({ name: 'play', mode: { kind: 'practice' }, market })
}
