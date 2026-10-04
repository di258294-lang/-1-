import { describe, expect, it } from 'vitest'
import { dailySeed } from './daily'
import { COMPANIES, generateMarket, type Market, type NewsEvent } from './market'
import {
  CUT_LOSS_TICKS,
  longestLoss,
  passesRule,
  pastWeeks,
  reactedToRumor,
  WEEKLY_GOAL,
  WEEKLY_RULES,
  weekKeys,
  weeklyProgress,
  weeklyRule,
  type WeeklyDay,
} from './weekly'

const PLAY_TICKS = 400
const HISTORY_TICKS = 120

function marketOf(price: (t: number) => number, news: NewsEvent[] = []): Market {
  const prices = Array.from({ length: HISTORY_TICKS + PLAY_TICKS + 1 }, (_, i) => price(Math.max(0, i - HISTORY_TICKS)))
  return {
    seed: 0,
    product: 'stock',
    length: 'short',
    company: COMPANIES[0],
    playTicks: PLAY_TICKS,
    historyTicks: HISTORY_TICKS,
    ticksPerDay: 20,
    prices,
    news,
    feeRate: 0.001,
  }
}

function heldOn(...ranges: Array<[number, number]>) {
  const held = new Array<boolean>(PLAY_TICKS).fill(false)
  for (const [a, b] of ranges) for (let t = a; t < b; t++) held[t] = true
  return held
}

const rumor = (at: number): NewsEvent => ({
  at,
  impactAt: at + 16,
  kind: 'rumor',
  headline: 'h',
  blindHeadline: 'b',
  implied: 1,
  actual: 1,
})

const day = (extra: Partial<WeeklyDay> = {}): WeeklyDay => ({
  key: '2026-10-05',
  yourReturn: 0.03,
  buyHoldReturn: 0.01,
  trades: 2,
  held: heldOn([10, 60], [200, 260]),
  ...extra,
})

const flat = marketOf(() => 10_000)
const noMarket = () => {
  throw new Error('market not needed')
}

describe('weekly rule', () => {
  it('is the same all week, Monday to Sunday (KST keys)', () => {
    const keys = weekKeys('2026-10-08')
    expect(keys[0]).toBe('2026-10-05')
    expect(keys[6]).toBe('2026-10-11')
    for (const k of keys) expect(weeklyRule(k)).toBe(weeklyRule('2026-10-05'))
  })

  it('changes every week and cycles through the whole catalogue', () => {
    const seen = new Set<string>()
    let prev = ''
    for (let w = 0; w < WEEKLY_RULES.length; w++) {
      const d = new Date(Date.UTC(2026, 8, 28 + 7 * w)).toISOString().slice(0, 10)
      const key = weeklyRule(d).key
      expect(key).not.toBe(prev)
      prev = key
      seen.add(key)
    }
    expect(seen.size).toBe(WEEKLY_RULES.length)
  })

  it('works before the epoch too', () => {
    expect(WEEKLY_RULES).toContain(weeklyRule('2025-01-01'))
  })

  it('keeps every title short enough for one home row', () => {
    for (const r of WEEKLY_RULES) expect([...r.title].length).toBeLessThanOrEqual(16)
  })
})

describe('passesRule', () => {
  it('never passes an abandoned day or one with no trades', () => {
    for (const r of WEEKLY_RULES) {
      expect(passesRule(r.key, day({ abandoned: true }), () => flat)).toBe(false)
      expect(passesRule(r.key, day({ trades: 0, held: heldOn() }), () => flat)).toBe(false)
    }
  })

  it('fewTrades: 3 trades or fewer and beat the market', () => {
    expect(passesRule('fewTrades', day({ trades: 3 }), noMarket)).toBe(true)
    expect(passesRule('fewTrades', day({ trades: 4 }), noMarket)).toBe(false)
    expect(passesRule('fewTrades', day({ yourReturn: 0.01 }), noMarket)).toBe(false)
  })

  it('halfCash: held half the time or less and beat the market', () => {
    expect(passesRule('halfCash', day({ held: heldOn([0, 200]) }), noMarket)).toBe(true)
    expect(passesRule('halfCash', day({ held: heldOn([0, 201]) }), noMarket)).toBe(false)
    expect(passesRule('halfCash', day({ yourReturn: -0.01 }), noMarket)).toBe(false)
  })

  it('noRumor: no buy or sell between a rumor and its price move, and a profit', () => {
    const m = marketOf(() => 10_000, [rumor(100)])
    expect(passesRule('noRumor', day({ held: heldOn([10, 60]) }), () => m)).toBe(true)
    // Bought on the headline.
    expect(passesRule('noRumor', day({ held: heldOn([105, 160]) }), () => m)).toBe(false)
    // Sold on the headline.
    expect(passesRule('noRumor', day({ held: heldOn([50, 110]) }), () => m)).toBe(false)
    // Bought once the price moved: a reaction to the price, not the rumor.
    expect(passesRule('noRumor', day({ held: heldOn([116, 160]) }), () => m)).toBe(true)
    expect(passesRule('noRumor', day({ held: heldOn([10, 60]), yourReturn: -0.001 }), () => m)).toBe(false)
  })

  it('cutLoss: never more than 2 s under the buy price, and held 5 s or more', () => {
    // Falls from tick 100 on.
    const falling = marketOf((t) => (t <= 100 ? 10_000 : 10_000 - (t - 100)))
    expect(passesRule('cutLoss', day({ held: heldOn([50, 100 + CUT_LOSS_TICKS + 1]) }), () => falling)).toBe(true)
    expect(passesRule('cutLoss', day({ held: heldOn([50, 100 + CUT_LOSS_TICKS + 2]) }), () => falling)).toBe(false)
    // A tap is not enough.
    expect(passesRule('cutLoss', day({ held: heldOn([50, 52]) }), () => falling)).toBe(false)
  })
})

describe('longestLoss', () => {
  it('measures each dip from its first red tick until it recovers or is sold', () => {
    // Dips under 10,000 on ticks 21..25 then recovers, dips again from 41 on.
    const m = marketOf((t) => ((t > 20 && t < 26) || t > 40 ? 9_990 : 10_000))
    expect(longestLoss(m, heldOn([10, 30]))).toBe(5)
    expect(longestLoss(m, heldOn([10, 50]))).toBe(9)
    expect(longestLoss(m, heldOn())).toBe(0)
    expect(longestLoss(flat, heldOn([0, PLAY_TICKS]))).toBe(0)
  })

  it('handles a position held to the bell', () => {
    const m = marketOf((t) => (t > 390 ? 9_000 : 10_000))
    expect(longestLoss(m, heldOn([380, PLAY_TICKS]))).toBe(PLAY_TICKS - 391)
  })
})

describe('reactedToRumor', () => {
  it('ignores filings', () => {
    const m = marketOf(() => 10_000, [{ ...rumor(100), kind: 'filing' }])
    expect(reactedToRumor(m, heldOn([105, 160]))).toBe(false)
  })
})

describe('weeklyProgress', () => {
  const today = '2026-10-08' // Thursday
  const rule = weeklyRule(today)

  it('marks each day and completes at the goal', () => {
    const saved: Record<string, WeeklyDay> = {
      '2026-10-05': day({ key: '2026-10-05' }),
      '2026-10-06': day({ key: '2026-10-06', trades: 0, held: heldOn() }),
      '2026-10-07': day({ key: '2026-10-07', abandoned: true }),
    }
    const m = marketOf(() => 10_000)
    const p = weeklyProgress(today, (k) => saved[k], () => m)
    expect(p.rule).toBe(rule)
    expect(p.start).toBe('2026-10-05')
    expect(p.days.map((d) => d.mark)).toEqual(['pass', 'fail', 'none', 'today', 'future', 'future', 'future'])
    expect(p.passed).toBe(1)
    expect(p.goal).toBe(WEEKLY_GOAL)
    expect(p.done).toBe(false)

    saved['2026-10-06'] = day({ key: '2026-10-06' })
    saved['2026-10-08'] = day({ key: '2026-10-08' })
    const done = weeklyProgress(today, (k) => saved[k], () => m)
    expect(done.passed).toBe(3)
    expect(done.done).toBe(true)
  })

  it('counts a day whose check throws as not passed', () => {
    const p = weeklyProgress(
      today,
      (k) => (k === '2026-10-05' ? day() : undefined),
      () => {
        throw new Error('no chart')
      },
      '2026-10-12', // a week with a chart rule; future days only
    )
    expect(p.passed).toBe(0)
  })

  it('redraws real daily charts without trouble', () => {
    for (const r of WEEKLY_RULES) {
      const d = day({ key: '2026-10-05' })
      const m = generateMarket(dailySeed(d.key), 'stock')
      expect(typeof passesRule(r.key, d, () => m)).toBe('boolean')
    }
  })
})

describe('pastWeeks', () => {
  it('lists finished weeks newest first, from the first daily on', () => {
    const weeks = pastWeeks('2026-10-20', '2026-10-01', () => undefined, () => flat)
    expect(weeks.map((w) => w.start)).toEqual(['2026-10-12', '2026-10-05', '2026-09-28'])
    expect(pastWeeks('2026-10-20', null, () => undefined, () => flat)).toEqual([])
    expect(pastWeeks('2026-10-20', '2026-10-19', () => undefined, () => flat)).toEqual([])
    expect(pastWeeks('2027-10-20', '2026-10-01', () => undefined, () => flat, 4)).toHaveLength(4)
  })
})
