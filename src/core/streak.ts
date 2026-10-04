import { daysBetween, nextKey, previousKey, weekStart } from './daily'

export { weekStart }

/**
 * Daily streaks and streak freezes ("휴장일"), as pure functions over two sets
 * of KST date keys:
 *   played  days with a finished daily round (abandoned rounds don't count)
 *   frozen  missed days a freeze token covered
 *
 * Tokens are never stored. They are replayed from history, so two tabs or a
 * repaired save can never disagree about how many you hold:
 *   - every FREEZE_EVERY-th played day of an unbroken run earns one token,
 *     up to FREEZE_CAP held (earned only, never random or bought);
 *   - each frozen day spends one;
 *   - a missed day breaks the run (the count toward the next token restarts),
 *     but tokens already held are kept.
 * Frozen days keep the streak alive without counting as played days, and
 * never touch the season account (they add no daily entry).
 */

export const FREEZE_EVERY = 7
export const FREEZE_CAP = 2

export type DayState = 'played' | 'frozen' | 'missed' | 'today' | 'future'

export type StreakState = {
  /** Played days in the current streak (frozen days bridge, they don't add). */
  days: number
  /** Freeze tokens held now. */
  tokens: number
  /** Every frozen day up to today, oldest first. */
  frozen: string[]
  /** Monday to Sunday of today's week (KST). */
  week: Array<{ key: string; state: DayState }>
}

type Entry = { abandoned?: boolean }

/** Days that count as played: finished, not abandoned. */
export function playedDays(daily: Record<string, Entry>): Set<string> {
  return new Set(Object.keys(daily).filter((k) => !daily[k].abandoned))
}

/**
 * Consecutive played days, counting today if played, else ending yesterday.
 * Frozen days are stepped over. Keys after today (clock moved back) never
 * matter because the walk only goes backwards from today.
 */
export function streakDays(played: Set<string>, frozen: Set<string>, today: string): number {
  let key = played.has(today) ? today : previousKey(today)
  let n = 0
  for (;;) {
    if (played.has(key)) n++
    else if (!frozen.has(key)) break
    key = previousKey(key)
  }
  return n
}

/** Tokens held at the end of `through`, replayed from the first recorded day. */
export function tokensAt(played: Set<string>, frozen: Set<string>, through: string): number {
  let first: string | null = null
  for (const k of [...played, ...frozen]) if (k <= through && (first === null || k < first)) first = k
  if (first === null) return 0
  let tokens = 0
  let run = 0
  for (let key = first; key <= through; key = nextKey(key)) {
    if (played.has(key)) {
      run++
      if (run % FREEZE_EVERY === 0) tokens = Math.min(FREEZE_CAP, tokens + 1)
    } else if (frozen.has(key)) {
      tokens = Math.max(0, tokens - 1)
    } else {
      run = 0
    }
  }
  return tokens
}

/**
 * Which missed days to freeze on opening the app on `today`, newest first
 * (the order tokens are spent). Missed days are those after the latest played
 * or frozen day before today, up to yesterday; today can still be played.
 *
 * All or nothing: if the gap is larger than the tokens held then, the streak
 * is lost anyway, so nothing is spent and the tokens are kept for the next
 * streak. Tokens earned today can't cover earlier days.
 */
export function freezesToApply(played: Set<string>, frozen: Set<string>, today: string): string[] {
  let anchor: string | null = null
  for (const k of [...played, ...frozen]) if (k < today && (anchor === null || k > anchor)) anchor = k
  if (anchor === null) return []
  const gap = daysBetween(anchor, today) - 1
  if (gap <= 0 || gap > FREEZE_CAP) return []
  if (gap > tokensAt(played, frozen, anchor)) return []
  const out: string[] = []
  for (let key = previousKey(today); key > anchor; key = previousKey(key)) out.push(key)
  return out
}

export function weekStrip(played: Set<string>, frozen: Set<string>, today: string): StreakState['week'] {
  const week: StreakState['week'] = []
  let key = weekStart(today)
  for (let i = 0; i < 7; i++, key = nextKey(key)) {
    let state: DayState
    if (key > today) state = 'future'
    else if (played.has(key)) state = 'played'
    else if (key === today) state = 'today'
    else if (frozen.has(key)) state = 'frozen'
    else state = 'missed'
    week.push({ key, state })
  }
  return week
}

export function streakState(played: Set<string>, frozen: Set<string>, today: string): StreakState {
  return {
    days: streakDays(played, frozen, today),
    tokens: tokensAt(played, frozen, today),
    frozen: [...frozen].filter((k) => k <= today).sort(),
    week: weekStrip(played, frozen, today),
  }
}
