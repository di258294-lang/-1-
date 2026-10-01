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
