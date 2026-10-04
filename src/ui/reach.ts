import { platform } from '#platform'
import { reviewEligible } from '../core/reach'
import { save } from '../core/storage'
import { logError } from './errors'
import { submitDailyScore } from './leaderboard'
import { refreshReminders } from './reminder'

/**
 * What happens outside the game once a daily is recorded: its score goes to
 * the Toss leaderboard, the reminder window moves past today, and, rarely,
 * the store's own review prompt. Each is a no-op where the platform has no
 * such thing. Nothing here changes what the player sees in the game.
 */

/** Wait this long before the review prompt, so the result screen is read first. */
const REVIEW_DELAY_MS = 2500

/** True when the save holds this very result for the day (not another tab's, not nothing). */
function recorded(key: string, result: { yourReturn: number; trades: number }): boolean {
  const d = save.daily(key)
  return !!d && !d.abandoned && d.yourReturn === result.yourReturn && d.trades === result.trades
}

/** The store review prompt, when core/reach.ts reviewEligible allows it. */
function maybeAskReview(key: string, result: { yourReturn: number; buyHoldReturn: number }) {
  const ask = platform.requestReview
  if (!ask) return
  const completedDailies = save.dailyHistory().filter((d) => !d.abandoned).length
  const lastAsked = save.getSettings().reviewAsked
  if (!reviewEligible({ completedDailies, yourReturn: result.yourReturn, buyHoldReturn: result.buyHoldReturn, lastAsked, today: key })) return
  // Marked first: a crash or a closed app never leads to a second prompt.
  save.updateSettings({ reviewAsked: key })
  setTimeout(() => void ask().catch(() => {}), REVIEW_DELAY_MS)
}

/**
 * Call once right after completeRound() returns for a daily round. Checks the
 * save itself, so a round another tab already recorded does nothing.
 * Never throws.
 */
export function onDailyRecorded(key: string, result: { yourReturn: number; buyHoldReturn: number; trades: number }): void {
  try {
    if (!recorded(key, result)) return
    submitDailyScore(key, result)
    void refreshReminders()
    maybeAskReview(key, result)
  } catch (err) {
    logError(err, 'onDailyRecorded')
  }
}

/** Call once at boot, after the save is loaded: tops the reminder window up. Never throws. */
export function initReach(): void {
  void refreshReminders()
}
