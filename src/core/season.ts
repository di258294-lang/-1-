/**
 * The season account: daily-chart results compound inside a calendar month
 * (KST), so a bad day carries into tomorrow. Practice rounds never touch it.
 */
export const SEASON_START = 10_000_000

export function seasonOf(dateKey: string) {
  return dateKey.slice(0, 7)
}

export function seasonLabel(dateKey: string) {
  return `${Number(dateKey.slice(5, 7))}월 시즌`
}

export function seasonDaysLeft(dateKey: string) {
  const [y, m, d] = dateKey.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return last - d
}

/** Last date key of a season: '2028-02' -> '2028-02-29'. */
export function seasonLastDay(season: string) {
  const [y, m] = season.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${season}-${String(last).padStart(2, '0')}`
}

/**
 * Abandoned rounds count with their checkpointed return (see
 * storage.progressDaily); frozen streak days add no entry, so they never
 * move the account.
 */
type Entry = { yourReturn: number }

function balance(daily: Record<string, Entry>, dateKey: string, inclusive: boolean) {
  const season = seasonOf(dateKey)
  let value = SEASON_START
  for (const key of Object.keys(daily).sort()) {
    if (seasonOf(key) !== season) continue
    if (key > dateKey || (key === dateKey && !inclusive)) continue
    value *= 1 + daily[key].yourReturn
  }
  return value
}

/** Balance a round on `dateKey` starts from. */
export function accountBefore(daily: Record<string, Entry>, dateKey: string) {
  return balance(daily, dateKey, false)
}

/** Balance after `dateKey`'s round (same as before if not played yet). */
export function accountAfter(daily: Record<string, Entry>, dateKey: string) {
  return balance(daily, dateKey, true)
}
