import { hashString } from './rng'

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
/** Day #1 of the daily chart. */
export const EPOCH_KEY = '2026-10-01'

export function dateKey(now = Date.now()) {
  return new Date(now + KST_OFFSET_MS).toISOString().slice(0, 10)
}

export function dayNumber(key: string) {
  const ms = Date.parse(`${key}T00:00:00Z`) - Date.parse(`${EPOCH_KEY}T00:00:00Z`)
  return Math.round(ms / 86_400_000) + 1
}

export function dailySeed(key: string) {
  return hashString(`hold/daily/${key}`)
}

/** Milliseconds until the next KST midnight. */
export function msUntilNextDay(now = Date.now()) {
  const kst = now + KST_OFFSET_MS
  const next = Math.floor(kst / 86_400_000 + 1) * 86_400_000
  return next - kst
}

export function nextKey(key: string) {
  const d = new Date(`${key}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function previousKey(key: string) {
  const d = new Date(`${key}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Calendar math over date keys. Keys are KST calendar days (from dateKey);
// the math itself is plain UTC date arithmetic, so it never sees a timezone.

const DAY_MS = 86_400_000

/** Days since 1970-01-01 for a 'yyyy-mm-dd' key (0 for a key that doesn't parse). */
function dayIndex(key: string) {
  const t = Date.parse(`${key}T00:00:00Z`)
  return Number.isNaN(t) ? 0 : Math.round(t / DAY_MS)
}

const keyOfIndex = (i: number) => new Date(i * DAY_MS).toISOString().slice(0, 10)

/** Calendar days from a to b (b - a). */
export function daysBetween(a: string, b: string) {
  return dayIndex(b) - dayIndex(a)
}

/** Monday-based week number: consecutive weeks differ by one (1970-01-05, a Monday, is day 4). */
export function weekIndex(key: string) {
  return Math.floor((dayIndex(key) - 4) / 7)
}

/** Monday of the week containing `key`. */
export function weekStart(key: string): string {
  const i = dayIndex(key)
  return keyOfIndex(i - ((((i - 4) % 7) + 7) % 7))
}

/** The date key of daily chart #day (the inverse of dayNumber). */
export function keyForDay(day: number): string {
  return keyOfIndex(dayIndex(EPOCH_KEY) + day - 1)
}
