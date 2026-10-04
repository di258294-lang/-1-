import { describe, expect, it } from 'vitest'
import { dailySeed, nextKey } from './daily'
import { pathReturn } from './luck'
import { COMPANIES, generateMarket, playPrice, type Market, type NewsEvent } from './market'
import { dailyProduct } from './products'
import { createRng, type Rng } from './rng'
import { cashRatePerTick } from './round'
import {
  benchReturn,
  CUT_LOSS_TICKS,
  dayVerdict,
  longestLoss,
  MIN_HELD,
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

  it('keeps every title to two short lines on the home row', () => {
    for (const r of WEEKLY_RULES) expect([...r.title].length).toBeLessThanOrEqual(30)
  })

  it('names the real measure: "그냥 들고 있는 것보다", never "시장 이기기" or "수익 내기"', () => {
    for (const r of WEEKLY_RULES) {
      expect(r.title).not.toMatch(/시장 이기기|수익 내기/)
      if (r.key !== 'cutLoss') expect(r.title).toContain('그냥 들고 있는 것보다')
      expect(r.title + r.detail).not.toMatch(/지라시|공시/)
    }
    expect(WEEKLY_RULES.find((r) => r.key === 'noRumor')!.detail).toContain('소문이 없던 날은 세지 않아요')
  })
})

describe('passesRule', () => {
  it('never passes an abandoned day or one with no trades', () => {
    for (const r of WEEKLY_RULES) {
      expect(passesRule(r.key, day({ abandoned: true }), () => flat)).toBe(false)
      expect(passesRule(r.key, day({ trades: 0, held: heldOn() }), () => flat)).toBe(false)
    }
  })

  it('compares with the exposure-matched benchmark h·(holding) + (1 − h)·(cash)', () => {
    // Held 110 of 400 ticks.
    const d = day({ buyHoldReturn: 0.04 })
    const cash = (1 + cashRatePerTick(flat)) ** PLAY_TICKS - 1
    expect(benchReturn(d, flat)).toBeCloseTo(0.275 * 0.04 + 0.725 * cash, 12)
  })

  it('fewTrades: 3 trades or fewer and beat holding the same share', () => {
    expect(passesRule('fewTrades', day({ trades: 3 }), () => flat)).toBe(true)
    expect(passesRule('fewTrades', day({ trades: 4 }), noMarket)).toBe(false)
    expect(passesRule('fewTrades', day({ yourReturn: 0.002 }), () => flat)).toBe(false)
    // Behind plain holding (+5%) but ahead of holding 27.5% of the money: a pass.
    expect(passesRule('fewTrades', day({ yourReturn: 0.02, buyHoldReturn: 0.05 }), () => flat)).toBe(true)
    // A small hold on a falling day no longer passes for free: it must beat its own share of the fall.
    expect(passesRule('fewTrades', day({ yourReturn: -0.02, buyHoldReturn: -0.05 }), () => flat)).toBe(false)
  })

  it('fewTrades and noRumor need the round held 20% or more: doing almost nothing does not pass', () => {
    const m = marketOf(() => 10_000, [rumor(300)])
    // One 3-second hold that happened to beat its own share of the market.
    const tiny = day({ trades: 1, held: heldOn([10, 40]), yourReturn: 0.01 })
    expect(passesRule('fewTrades', tiny, () => flat)).toBe(false)
    expect(passesRule('noRumor', tiny, () => m)).toBe(false)
    const enough = day({ trades: 1, held: heldOn([10, 10 + MIN_HELD * PLAY_TICKS]), yourReturn: 0.01 })
    expect(passesRule('fewTrades', enough, () => flat)).toBe(true)
    expect(passesRule('noRumor', enough, () => m)).toBe(true)
    for (const key of ['fewTrades', 'noRumor'] as const) expect(WEEKLY_RULES.find((r) => r.key === key)?.detail).toContain('20% 이상')
  })

  it('halfCash: held 20% to 50% of the time and beat holding the same share', () => {
    expect(passesRule('halfCash', day({ held: heldOn([0, 200]) }), () => flat)).toBe(true)
    expect(passesRule('halfCash', day({ held: heldOn([0, 201]) }), () => flat)).toBe(false)
    expect(passesRule('halfCash', day({ held: heldOn([0, 79]) }), () => flat)).toBe(false)
    expect(passesRule('halfCash', day({ held: heldOn([0, 80]) }), () => flat)).toBe(true)
    expect(passesRule('halfCash', day({ yourReturn: -0.01 }), () => flat)).toBe(false)
  })

  it('noRumor: no buy or sell between a rumor and its price move, and beat holding the same share', () => {
    const m = marketOf(() => 10_000, [rumor(100)])
    expect(passesRule('noRumor', day({ held: heldOn([0, 90]) }), () => m)).toBe(true)
    // Bought on the headline.
    expect(passesRule('noRumor', day({ held: heldOn([105, 160]) }), () => m)).toBe(false)
    // Sold on the headline.
    expect(passesRule('noRumor', day({ held: heldOn([50, 110]) }), () => m)).toBe(false)
    // Bought once the price moved: a reaction to the price, not the rumor.
    expect(passesRule('noRumor', day({ held: heldOn([116, 200]) }), () => m)).toBe(true)
    expect(passesRule('noRumor', day({ held: heldOn([0, 90]), yourReturn: -0.001 }), () => m)).toBe(false)
    // Holding all day on an up day is not "beating" anything.
    expect(passesRule('noRumor', day({ held: heldOn([0, PLAY_TICKS]), trades: 1, yourReturn: 0.05, buyHoldReturn: 0.052 }), () => m)).toBe(false)
  })

  it('noRumor: a chart with no rumor is not judged, and does not count', () => {
    expect(dayVerdict('noRumor', day(), () => flat)).toBe('skip')
    expect(passesRule('noRumor', day(), () => flat)).toBe(false)
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
    // This week's rule is noRumor: the chart needs a rumor for a day to count.
    expect(rule.key).toBe('noRumor')
    const m = marketOf(() => 10_000, [rumor(300)])
    const p = weeklyProgress(today, (k) => saved[k], () => m)
    expect(p.rule).toBe(rule)
    expect(p.start).toBe('2026-10-05')
    expect(p.days.map((d) => d.mark)).toEqual(['pass', 'fail', 'none', 'today', 'future', 'future', 'future'])
    expect(p.passed).toBe(1)
    // noRumor counts only days with a rumor (about 4 a week), so it needs 2.
    expect(p.goal).toBe(2)
    expect(p.done).toBe(false)

    saved['2026-10-06'] = day({ key: '2026-10-06' })
    const done = weeklyProgress(today, (k) => saved[k], () => m)
    expect(done.passed).toBe(2)
    expect(done.done).toBe(true)

    // Other rules keep the usual goal.
    expect(weeklyProgress(today, (k) => saved[k], () => m, '2026-10-12').goal).toBe(WEEKLY_GOAL)

    // No rumor on the chart: the day is marked as not counted.
    const quiet = weeklyProgress(today, (k) => saved[k], () => flat)
    expect(quiet.days[0].mark).toBe('skip')
    expect(quiet.passed).toBe(0)
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

describe('calibration on real daily charts (182 dailies from 2026-10-05)', () => {
  const days: Array<{ key: string; m: Market }> = []
  for (let key = '2026-10-05'; days.length < 182; key = nextKey(key)) days.push({ key, m: generateMarket(dailySeed(key), dailyProduct(key), 'short') })
  const play = (style: (m: Market, rng: Rng) => boolean[], rule: 'fewTrades' | 'noRumor') => {
    const vs = days.map(({ key, m }) => {
      const held = style(m, createRng(dailySeed(key) + 17))
      let trades = 0
      for (let t = 0; t < held.length; t++) if (held[t] && (t === 0 || !held[t - 1])) trades++
      const bh = playPrice(m, m.playTicks) / playPrice(m, 0) - 1
      return dayVerdict(rule, { key, yourReturn: pathReturn(m, held), buyHoldReturn: bh, trades, held }, () => m)
    })
    const judged = vs.filter((v) => v !== 'skip')
    return judged.filter((v) => v === 'pass').length / judged.length
  }
  /** One 3-second hold: was 42% of days and 63% of fully played weeks on fewTrades. */
  const tiny = (m: Market, rng: Rng) => {
    const held = new Array<boolean>(m.playTicks).fill(false)
    const a = rng.int(0, m.playTicks - 31)
    for (let t = a; t < a + 30; t++) held[t] = true
    return held
  }
  /** One to three holds of 4 to 15 s at random moments: a real low-frequency trader with no timing edge. */
  const lowFreq = (m: Market, rng: Rng) => {
    const held = new Array<boolean>(m.playTicks).fill(false)
    const want = rng.int(1, 3)
    for (let placed = 0, tries = 0; placed < want && tries < 500; tries++) {
      const len = rng.int(40, 150)
      const a = rng.int(0, m.playTicks - len - 1)
      let free = true
      for (let t = Math.max(0, a - 2); t < Math.min(m.playTicks, a + len + 2); t++) if (held[t]) free = false
      if (!free) continue
      for (let t = a; t < a + len; t++) held[t] = true
      placed++
    }
    return held
  }

  it('doing almost nothing never passes fewTrades or noRumor', () => {
    expect(play(tiny, 'fewTrades')).toBe(0)
    expect(play(tiny, 'noRumor')).toBe(0)
  })

  it('stays achievable for a low-frequency trader: a third of days or so without any timing edge', () => {
    expect(play(lowFreq, 'fewTrades')).toBeGreaterThan(0.25)
    expect(play(lowFreq, 'noRumor')).toBeGreaterThan(0.2)
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
