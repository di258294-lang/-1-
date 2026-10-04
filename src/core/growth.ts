import { EPOCH_KEY, nextKey, previousKey } from './daily'
import { FREEZE_CAP, FREEZE_EVERY, weekStart } from './streak'

/**
 * Pure helpers for the records screen and the home week strip: calendar
 * grids, streak bests, win rates. All dates are KST 'yyyy-mm-dd' keys.
 */

type Day = { key: string; yourReturn: number; buyHoldReturn: number; abandoned: boolean }

/** Same rule as the season's beatDays (records.ts): strictly better than buy and hold. */
export const beatMarket = (d: Pick<Day, 'yourReturn' | 'buyHoldReturn'>) => d.yourReturn > d.buyHoldReturn

/** Monday-first weeks of a 'yyyy-mm' month; null pads the first and last week. */
export function monthGrid(season: string): Array<Array<string | null>> {
  const first = `${season}-01`
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7
  const cells: Array<string | null> = new Array(lead).fill(null)
  for (let k = first; k.startsWith(season); k = nextKey(k)) cells.push(k)
  while (cells.length % 7) cells.push(null)
  const weeks: Array<Array<string | null>> = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

/** 'yyyy-mm' of the month before. */
export function previousSeason(season: string): string {
  return previousKey(`${season}-01`).slice(0, 7)
}

/**
 * Longest run of played days, frozen days bridging without adding (the same
 * rule as streakDays). Only days up to `today` count.
 */
export function bestStreak(played: Iterable<string>, frozen: Iterable<string>, today: string): number {
  const p = new Set([...played].filter((k) => k <= today))
  const f = new Set([...frozen].filter((k) => k <= today))
  const keys = [...p, ...f].sort()
  if (!keys.length) return 0
  let best = 0
  let run = 0
  for (let k = keys[0]; k <= keys[keys.length - 1]; k = nextKey(k)) {
    if (p.has(k)) best = Math.max(best, ++run)
    else if (!f.has(k)) run = 0
  }
  return best
}

/**
 * Played days until the next freeze token, or null at the cap. Mirrors
 * tokensAt() in streak.ts: a missed day restarts the count, frozen days
 * neither add nor restart, and today only counts once it is played.
 */
export function daysToNextFreeze(
  played: Iterable<string>,
  frozen: Iterable<string>,
  today: string,
  tokens: number,
): number | null {
  if (tokens >= FREEZE_CAP) return null
  const p = new Set(played)
  const f = new Set(frozen)
  let run = 0
  let k = p.has(today) ? today : previousKey(today)
  // Walk back to the last missed day; stop at the first recorded day.
  for (let guard = 0; guard < 4000; guard++, k = previousKey(k)) {
    if (p.has(k)) run++
    else if (!f.has(k)) break
  }
  return FREEZE_EVERY - (run % FREEZE_EVERY)
}

/** Finished (not abandoned) dailies and how many beat buy and hold. */
export function winRate(history: readonly Day[]): { played: number; beat: number } {
  const done = history.filter((d) => !d.abandoned)
  return { played: done.length, beat: done.filter(beatMarket).length }
}

/** Monday to Sunday containing `today`: finished dailies and wins. */
export function weekSummary(history: readonly Day[], today: string): { played: number; beat: number } {
  const from = weekStart(today)
  return winRate(history.filter((d) => d.key >= from && d.key <= today))
}

export type CalendarState =
  | 'beat'
  | 'behind'
  | 'abandoned'
  | 'frozen'
  | 'missed'
  | 'today'
  | 'future'
  /** Before the first daily chart existed. */
  | 'before'

export function calendarState(key: string, today: string, entry: Day | undefined, frozen: ReadonlySet<string>): CalendarState {
  if (key > today) return 'future'
  if (entry) return entry.abandoned ? 'abandoned' : beatMarket(entry) ? 'beat' : 'behind'
  if (key === today) return 'today'
  if (key < EPOCH_KEY) return 'before'
  return frozen.has(key) ? 'frozen' : 'missed'
}

/**
 * Past daily charts can be replayed as practice: from day #1 up to
 * yesterday. Never today (it is still the live daily) or later.
 */
export function canReplay(key: string, today: string): boolean {
  return key >= EPOCH_KEY && key < today
}

/** The newest archived season the player hasn't dismissed, if any. */
export function unseenSeason<T extends { season: string }>(past: readonly T[], seen: readonly string[]): T | null {
  for (let i = past.length - 1; i >= 0; i--) if (!seen.includes(past[i].season)) return past[i]
  return null
}
