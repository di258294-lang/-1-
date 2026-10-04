import { nextKey, previousKey } from './daily'
import { playPrice, TICKS_PER_SECOND, type Market } from './market'
import { weekStart } from './streak'

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
}

/** Rotation order. Append only, or past weeks change their rule. */
export const WEEKLY_RULES: readonly WeeklyRule[] = [
  {
    key: 'fewTrades',
    title: '매매 3번 이하로 시장 이기기',
    detail: '1~3번만 사고팔고, 그냥 들고 있는 것보다 더 벌면 돼요.',
    needsMarket: false,
  },
  {
    key: 'noRumor',
    title: '소문엔 반응 없이 수익 내기',
    detail: '소문이 뜨면 가격이 움직일 때까지 사지도 팔지도 않고, 수익으로 끝내면 돼요.',
    needsMarket: true,
  },
  {
    key: 'halfCash',
    title: '절반은 현금으로 시장 이기기',
    detail: '들고 있는 시간을 절반 이하로 하고, 그냥 들고 있는 것보다 더 벌면 돼요.',
    needsMarket: false,
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

export type DayMark = 'pass' | 'fail' | 'none' | 'today' | 'future'

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

const DAY_MS = 86_400_000
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS)

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

/** Whether one finished daily round kept the rule. */
export function passesRule(rule: WeeklyRuleKey, day: WeeklyDay, market: () => Market): boolean {
  if (day.abandoned || day.trades < 1) return false
  const beat = day.yourReturn > day.buyHoldReturn
  switch (rule) {
    case 'fewTrades':
      return day.trades <= FEW_TRADES && beat
    case 'halfCash': {
      const ticks = day.held.length
      return ticks > 0 && heldTicks(day.held, ticks) / ticks <= HALF && beat
    }
    case 'noRumor':
      return day.yourReturn > 0 && !reactedToRumor(market(), day.held)
    case 'cutLoss': {
      const m = market()
      return heldTicks(day.held, m.playTicks) >= CUT_LOSS_MIN_HELD && longestLoss(m, day.held) <= CUT_LOSS_TICKS
    }
  }
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
    let pass = false
    try {
      pass = passesRule(rule.key, d, () => marketOf(d))
    } catch {
      // A day that can't be checked (corrupt save, missing chart) just doesn't count.
    }
    return { key, mark: pass ? ('pass' as const) : ('fail' as const) }
  })
  const passed = days.filter((d) => d.mark === 'pass').length
  return { start: days[0].key, rule, days, passed, goal: WEEKLY_GOAL, done: passed >= WEEKLY_GOAL }
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
