import { dateKey } from './daily'

/**
 * Pure rules for what reaches past a round: the Toss leaderboard score, the
 * daily reminder's schedule and the store review prompt. The screens and the
 * platform layer do the calling (ui/reach.ts, ui/reminder.ts); nothing here
 * touches storage, the clock or the network.
 */

// ---------------------------------------------------------------------------
// Leaderboard

/**
 * The leaderboard score of one daily: the edge over buy-and-hold in basis
 * points, rounded to an integer.
 *
 *   score = round((yourReturn - buyHoldReturn) × 10,000)
 *
 * yourReturn and buyHoldReturn are fractions (0.034 = +3.4%), so beating the
 * market by 3.21 %p scores 321 and trailing it by 0.5 %p scores -50. The edge,
 * not the raw return, because everyone plays the same chart that day: it is
 * the part of the result that timing earned, and a rising market lifts no one.
 * An integer, because Toss parses the string as a float and the console's
 * display format is set there: whole numbers rank and print the same anywhere.
 * Sort the board high-to-low in the console (docs/RELEASE.md).
 *
 * Null for a result that is not a finite number (never submitted).
 */
export function leaderboardScore(yourReturn: number, buyHoldReturn: number): number | null {
  const bps = Math.round((yourReturn - buyHoldReturn) * 10_000)
  if (!Number.isFinite(bps)) return null
  // No "-0" in a string the board parses.
  return bps === 0 ? 0 : bps
}

// ---------------------------------------------------------------------------
// Daily reminder

/** The times the settings sheet offers, as local hours. */
export const REMINDER_PRESETS: ReadonlyArray<{ hour: number; label: string }> = [
  { hour: 8, label: '오전 8시' },
  { hour: 12, label: '낮 12시' },
  { hour: 20, label: '저녁 8시' },
]

/** The reminder's text. Functional only: what opened and how long it takes. No streaks, no guilt. */
export const REMINDER_TITLE = 'HOLD'
export const REMINDER_BODY = '오늘의 차트가 열렸어요 · 40초면 돼요'

/**
 * How many days ahead the reminder is scheduled. Each app open and each
 * finished daily schedules the window again, so it never runs out for anyone
 * who plays; a player who has not opened the game for two weeks stops getting
 * it, which is the polite end for a reminder nobody acts on.
 */
export const REMINDER_DAYS = 14

/**
 * The next reminder times: one per day at `hour`:00 local time, for `days`
 * days starting today, skipping times already past (or under a minute away)
 * and days whose daily chart was already played. "Played" is asked by the
 * KST date key that is current at the fire time, since that is the chart the
 * notification announces (players outside KST get the chart that is open
 * then).
 */
export function reminderTimes(
  now: number,
  hour: number,
  played: (key: string) => boolean,
  days = REMINDER_DAYS,
): Date[] {
  const out: Date[] = []
  const base = new Date(now)
  for (let i = 0; i < days; i++) {
    // Local calendar arithmetic: DST days keep the wall-clock hour.
    const at = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, hour, 0, 0, 0)
    if (at.getTime() <= now + 60_000) continue
    if (played(dateKey(at.getTime()))) continue
    out.push(at)
  }
  return out
}

// ---------------------------------------------------------------------------
// Review prompt

/** Days between two store review prompts, at the very least. */
export const REVIEW_COOLDOWN_DAYS = 90
/** Completed dailies before the first prompt. */
export const REVIEW_AFTER_DAILIES = 3

export type ReviewInput = {
  /** Finished (not abandoned) dailies, this one included. */
  completedDailies: number
  /** This daily's result. */
  yourReturn: number
  buyHoldReturn: number
  /** KST date key of the last prompt, '' for never. */
  lastAsked: string
  /** KST date key of this daily. */
  today: string
}

const dayIndex = (key: string) => Math.round(Date.parse(`${key}T00:00:00Z`) / 86_400_000)

/**
 * Whether to show the store's own review prompt after this daily:
 *   - from the 3rd completed daily on,
 *   - only after a daily that beat buy-and-hold (strictly, as records count
 *     a win) and did not lose money: never after a loss,
 *   - at most once every 90 days (the OS throttles further on its own).
 * Never tied to a reward, never a "rate us" button: the caller just asks the
 * platform, which may show nothing at all.
 */
export function reviewEligible(r: ReviewInput): boolean {
  if (r.completedDailies < REVIEW_AFTER_DAILIES) return false
  if (!(r.yourReturn > r.buyHoldReturn) || !(r.yourReturn >= 0)) return false
  if (!r.lastAsked) return true
  const since = dayIndex(r.today) - dayIndex(r.lastAsked)
  return Number.isFinite(since) && since >= REVIEW_COOLDOWN_DAYS
}
