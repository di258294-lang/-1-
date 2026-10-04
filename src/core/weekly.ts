import { daysBetween, nextKey, previousKey, weekStart } from './daily'
import { playPrice, TICKS_PER_SECOND, type Market } from './market'
import { cashRatePerTick } from './round'

/**
 * The weekly constraint challenge: one rule per KST week (Monday to Sunday),
 * the same for everyone, chosen by rotation from a small catalogue. Doing it
 * on WEEKLY_GOAL of that week's daily charts completes the week. The only
 * reward is a line in the records.
 *
 * Everything is computed from what the save already keeps for each daily
 * (return, buy-and-hold return, trades, the held ticks) plus the chart
 * itself, which the daily seed redraws exactly. Nothing new is stored.
 */

export type WeeklyRuleKey = 'fewTrades' | 'cutLoss' | 'noRumor' | 'halfCash'

export type WeeklyRule = {
  key: WeeklyRuleKey
  /** One short line; it must fit one home row at 360 px. */
  title: string
  /** What exactly counts, in plain words. */
  detail: string
  /** Whether checking it needs the redrawn chart. */
  needsMarket: boolean
  /** Days to pass, when not WEEKLY_GOAL (noRumor only counts days with a rumor, about 4 a week). */
  goal?: number
}

/**
 * What "그냥 들고 있는 것보다" means in the rules below, in plain words. The
 * comparison is exposure-matched: holding a share h of the time is compared
 * with keeping a share h of the money in for the whole round and the rest in
 * cash. Against plain holding, a small hold on a falling day passed 93% of
 * the time and almost never on a rising one: the rule rewarded guessing the
 * day's direction (stats audit §4).
 */
export const BENCH_NOTE = '들고 있던 시간만큼의 돈을 처음부터 끝까지 그냥 들고, 나머지는 현금으로 둔 경우와 견줘요.'

/** Rotation order. Append only, or past weeks change their rule. */
export const WEEKLY_RULES: readonly WeeklyRule[] = [
  {
    key: 'fewTrades',
    title: '매매 3번 이하로, 그냥 들고 있는 것보다 더 벌기',
    detail: `1~3번만 사고팔고 판의 20% 이상 들고 있으면서, 그냥 들고 있는 것보다 더 벌면 돼요. ${BENCH_NOTE}`,
    needsMarket: true,
  },
  {
    key: 'noRumor',
    title: '소문엔 반응 없이, 그냥 들고 있는 것보다 더 벌기',
    detail: `소문이 뜨면 가격이 움직일 때까지 사지도 팔지도 않고 판의 20% 이상 들고 있으면서, 그냥 들고 있는 것보다 더 벌면 돼요. ${BENCH_NOTE} 소문이 없던 날은 세지 않아요.`,
    needsMarket: true,
    goal: 2,
  },
  {
    key: 'halfCash',
    title: '절반은 현금으로, 그냥 들고 있는 것보다 더 벌기',
    detail: `들고 있는 시간을 판의 20~50%로 하고, 그냥 들고 있는 것보다 더 벌면 돼요. ${BENCH_NOTE}`,
    needsMarket: true,
  },
  {
    key: 'cutLoss',
    title: '손실은 2초 안에 정리하기',
    detail: '5초 이상 들고 있으면서, 산 값보다 내려가면 2초 안에 팔면 돼요.',
    needsMarket: true,
  },
]

/** Days in a week that must pass. */
export const WEEKLY_GOAL = 3
/** Monday of the week of daily chart #1 (2026-10-01): rotation starts here. */
export const WEEKLY_EPOCH = '2026-09-28'

const FEW_TRADES = 3
const HALF = 0.5
/**
 * Every rule that compares with holding: at least this much of the round
 * held, so "do almost nothing" can't pass (the same 20% as the mission guard).
 * Against the exposure-matched benchmark, one random 3-second hold beat it on
 * 42% of days and completed fewTrades in 63% of fully played weeks.
 */
export const MIN_HELD = 0.2
/** cutLoss: the longest a position may sit below its buy price. */
export const CUT_LOSS_TICKS = 2 * TICKS_PER_SECOND
/** cutLoss: held at least this long, so a single tap doesn't pass. */
const CUT_LOSS_MIN_HELD = 5 * TICKS_PER_SECOND

/** What the save keeps for one daily round. */
export type WeeklyDay = {
  key: string
  yourReturn: number
  buyHoldReturn: number
  trades: number
  held: readonly boolean[]
  abandoned?: boolean
}

/** 'skip': played, but the rule had nothing to judge (noRumor on a chart with no rumor). */
export type DayMark = 'pass' | 'fail' | 'skip' | 'none' | 'today' | 'future'

export type WeeklyProgress = {
  /** Monday of the week. */
  start: string
  rule: WeeklyRule
  /** Monday to Sunday. */
  days: Array<{ key: string; mark: DayMark }>
  passed: number
  goal: number
  done: boolean
}

/** The rule of the week containing `key`. */
export function weeklyRule(key: string): WeeklyRule {
  const weeks = Math.floor(daysBetween(WEEKLY_EPOCH, weekStart(key)) / 7)
  const n = WEEKLY_RULES.length
  return WEEKLY_RULES[((weeks % n) + n) % n]
}

/** Monday to Sunday of the week containing `key`. */
export function weekKeys(key: string): string[] {
  const out = [weekStart(key)]
  while (out.length < 7) out.push(nextKey(out[out.length - 1]))
  return out
}

function heldTicks(held: readonly boolean[], ticks: number) {
  let n = 0
  for (let t = 0; t < ticks; t++) if (held[t]) n++
  return n
}

/** Bought or sold while a rumor was up but before the price reacted. */
export function reactedToRumor(market: Market, held: readonly boolean[]) {
  for (const n of market.news) {
    if (n.kind !== 'rumor') continue
    for (let t = Math.max(1, n.at); t < n.impactAt && t < market.playTicks; t++) {
      if (Boolean(held[t]) !== Boolean(held[t - 1])) return true
    }
  }
  return false
}

/**
 * The longest stretch, in ticks, that an open position spent below its buy
 * price: from the first tick it closed under the entry price until it came
 * back to it or was sold (selling counts as the end of the stretch).
 */
export function longestLoss(market: Market, held: readonly boolean[]) {
  const end = market.playTicks
  let worst = 0
  let t = 0
  while (t < end) {
    if (!held[t]) {
      t++
      continue
    }
    const entry = t
    while (t < end && held[t]) t++
    const exit = t
    const p0 = playPrice(market, entry)
    let since = -1
    for (let j = entry + 1; j <= exit; j++) {
      if (playPrice(market, j) < p0) {
        if (since < 0) since = j
        worst = Math.max(worst, j - since)
      } else if (since >= 0) {
        worst = Math.max(worst, j - since)
        since = -1
      }
    }
  }
  return worst
}

/**
 * The exposure-matched benchmark: h·(buy and hold) + (1 − h)·(cash), where h
 * is the share of the round held. Computable from the saved daily and the
 * redrawn chart.
 */
export function benchReturn(day: Pick<WeeklyDay, 'buyHoldReturn' | 'held'>, market: Market) {
  const ticks = market.playTicks
  const h = heldShare(day, market)
  const cash = (1 + cashRatePerTick(market)) ** ticks - 1
  return h * day.buyHoldReturn + (1 - h) * cash
}

const heldShare = (day: Pick<WeeklyDay, 'held'>, m: Market) => (m.playTicks > 0 ? heldTicks(day.held, m.playTicks) / m.playTicks : 0)

const hasRumor = (m: Market) => m.news.some((n) => n.kind === 'rumor' && n.at < m.playTicks)

/** One finished daily against the rule: kept, broken, or nothing to judge. */
export function dayVerdict(rule: WeeklyRuleKey, day: WeeklyDay, market: () => Market): 'pass' | 'fail' | 'skip' {
  if (day.abandoned || day.trades < 1) return 'fail'
  const ok = (x: boolean) => (x ? 'pass' : 'fail')
  switch (rule) {
    case 'fewTrades': {
      if (day.trades > FEW_TRADES) return 'fail'
      const m = market()
      return ok(heldShare(day, m) >= MIN_HELD && day.yourReturn > benchReturn(day, m))
    }
    case 'halfCash': {
      const m = market()
      const h = heldShare(day, m)
      return ok(h >= MIN_HELD && h <= HALF && day.yourReturn > benchReturn(day, m))
    }
    case 'noRumor': {
      const m = market()
      if (!hasRumor(m)) return 'skip'
      return ok(heldShare(day, m) >= MIN_HELD && !reactedToRumor(m, day.held) && day.yourReturn > benchReturn(day, m))
    }
    case 'cutLoss': {
      const m = market()
      return ok(heldTicks(day.held, m.playTicks) >= CUT_LOSS_MIN_HELD && longestLoss(m, day.held) <= CUT_LOSS_TICKS)
    }
  }
}

/** Whether one finished daily round kept the rule (a day with nothing to judge did not). */
export function passesRule(rule: WeeklyRuleKey, day: WeeklyDay, market: () => Market): boolean {
  return dayVerdict(rule, day, market) === 'pass'
}

/**
 * The week containing `week` (default: today's), as of `today`. `dayOf`
 * returns the saved daily for a key; `marketOf` redraws its chart and is
 * only called for rules that need it.
 */
export function weeklyProgress(
  today: string,
  dayOf: (key: string) => WeeklyDay | undefined,
  marketOf: (day: WeeklyDay) => Market,
  week = today,
): WeeklyProgress {
  const rule = weeklyRule(week)
  const days = weekKeys(week).map((key) => {
    if (key > today) return { key, mark: 'future' as const }
    const d = dayOf(key)
    if (!d || d.abandoned) return { key, mark: key === today && !d ? ('today' as const) : ('none' as const) }
    let mark: 'pass' | 'fail' | 'skip' = 'fail'
    try {
      mark = dayVerdict(rule.key, d, () => marketOf(d))
    } catch {
      // A day that can't be checked (corrupt save, missing chart) just doesn't count.
    }
    return { key, mark }
  })
  const passed = days.filter((d) => d.mark === 'pass').length
  const goal = rule.goal ?? WEEKLY_GOAL
  return { start: days[0].key, rule, days, passed, goal, done: passed >= goal }
}

/**
 * Finished weeks before the current one, newest first, from the week of
 * `first` (the player's first daily) and at most `limit` of them.
 */
export function pastWeeks(
  today: string,
  first: string | null,
  dayOf: (key: string) => WeeklyDay | undefined,
  marketOf: (day: WeeklyDay) => Market,
  limit = 12,
): WeeklyProgress[] {
  if (!first || first > today) return []
  const out: WeeklyProgress[] = []
  const stop = weekStart(first)
  let monday = weekStart(today)
  for (let i = 0; i < limit; i++) {
    monday = weekStart(previousKey(monday))
    if (monday < stop) break
    out.push(weeklyProgress(today, dayOf, marketOf, monday))
  }
  return out
}
