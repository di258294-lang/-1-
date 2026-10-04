import { LENGTHS, TRADING_DAYS_PER_YEAR } from './market'
import type { ProductKey } from './products'
import { CASH_RATE_ANNUAL } from './round'
import { accountAfter, SEASON_START, seasonLabel, seasonLastDay, seasonOf } from './season'

/**
 * Season summaries, the season archive and the records list, as pure
 * functions over the daily map. storage.ts wraps them for screens.
 *
 * Every daily entry in the account counts here, abandoned ones included:
 * they move the account with their checkpointed return, so the market and
 * cash ghosts must ride the same days for a fair comparison. The day counts
 * (days played, days that beat the market, the medal's minimum) count only
 * finished rounds, like the streak and the records' win rate.
 */

type Entry = {
  yourReturn: number
  buyHoldReturn: number
  title: string
  product?: ProductKey
  abandoned?: boolean
}

/** Simulated trading days in one daily round (a short, one-month chart). */
export const DAILY_ROUND_TRADING_DAYS = LENGTHS.short.days
/** A season needs this many days for a medal, so one lucky day can't earn it. */
export const MEDAL_MIN_DAYS = 10

export type SeasonSummary = {
  label: string
  /** Season account balance in won. */
  account: number
  accountReturn: number
  /** Market ghost: buying and holding every day's chart, Π(1 + buyHoldReturn) - 1. */
  market: number
  /**
   * Cash ghost: sitting out every round at CASH_RATE_ANNUAL, pro-rated over
   * the simulated trading days those rounds covered (20 per daily round).
   */
  cash: number
  /** Finished (not abandoned) rounds so far this season. */
  days: number
  /** Finished rounds that beat that day's buy and hold. */
  beatDays: number
}

/** A finished month, frozen once by closeSeasons and never recomputed. */
export type ArchivedSeason = {
  /** Final account balance in won. */
  final: number
  market: number
  cash: number
  days: number
  beatDays: number
  /** Beat the market ghost over at least MEDAL_MIN_DAYS days. */
  medal: boolean
}

export type DailyHistoryItem = {
  key: string
  yourReturn: number
  buyHoldReturn: number
  product: ProductKey | null
  abandoned: boolean
  title: string
}

/** The season `key` falls in, counting days up to and including `key`. */
export function seasonSummary(daily: Record<string, Entry>, key: string): SeasonSummary {
  const season = seasonOf(key)
  const keys = Object.keys(daily)
    .filter((k) => seasonOf(k) === season && k <= key)
    .sort()
  let market = 1
  let days = 0
  let beatDays = 0
  for (const k of keys) {
    market *= 1 + daily[k].buyHoldReturn
    if (daily[k].abandoned) continue
    days++
    if (daily[k].yourReturn > daily[k].buyHoldReturn) beatDays++
  }
  const account = accountAfter(daily, key)
  const tradingDays = keys.length * DAILY_ROUND_TRADING_DAYS
  return {
    label: seasonLabel(key),
    account,
    accountReturn: account / SEASON_START - 1,
    market: market - 1,
    cash: (1 + CASH_RATE_ANNUAL) ** (tradingDays / TRADING_DAYS_PER_YEAR) - 1,
    days,
    beatDays,
  }
}

export function archiveSeason(daily: Record<string, Entry>, season: string): ArchivedSeason {
  const s = seasonSummary(daily, seasonLastDay(season))
  return {
    final: s.account,
    market: s.market,
    cash: s.cash,
    days: s.days,
    beatDays: s.beatDays,
    medal: s.accountReturn > s.market && s.days >= MEDAL_MIN_DAYS,
  }
}

/**
 * Months before today's that have entries but no archive yet. Months after
 * today (clock moved back) are left alone.
 */
export function seasonsToClose(
  daily: Record<string, Entry>,
  archived: Record<string, ArchivedSeason>,
  today: string,
): string[] {
  const current = seasonOf(today)
  const out = new Set<string>()
  for (const k of Object.keys(daily)) {
    const s = seasonOf(k)
    if (s < current && !(s in archived)) out.add(s)
  }
  return [...out].sort()
}

/** Every daily round, oldest first. */
export function dailyHistory(daily: Record<string, Entry>): DailyHistoryItem[] {
  return Object.keys(daily)
    .sort()
    .map((key) => {
      const d = daily[key]
      return {
        key,
        yourReturn: d.yourReturn,
        buyHoldReturn: d.buyHoldReturn,
        product: d.product ?? null,
        abandoned: Boolean(d.abandoned),
        title: d.title,
      }
    })
}
