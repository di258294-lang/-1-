import { describe, expect, it } from 'vitest'
import { analyzeRound, profileFrom, roundInsight, tradesFrom, type HabitRecord, type HabitScores } from './habits'
import { COMPANIES, type Market, type NewsEvent } from './market'

const PLAY_TICKS = 400
const HISTORY_TICKS = 120

/** A market whose play-relative price at tick t is price(t). */
function marketOf(price: (t: number) => number, news: NewsEvent[] = []): Market {
  const prices = Array.from({ length: HISTORY_TICKS + PLAY_TICKS + 1 }, (_, i) =>
    price(Math.max(0, i - HISTORY_TICKS)),
  )
  return {
    seed: 0, product: 'stock', length: 'short', company: COMPANIES[0],
    playTicks: PLAY_TICKS, historyTicks: HISTORY_TICKS, ticksPerDay: 20, prices, news, feeRate: 0.001,
  }
}

/** held[] that is true on [a, b) for each range. */
function heldOn(...ranges: Array<[number, number]>) {
  const held = new Array<boolean>(PLAY_TICKS).fill(false)
  for (const [a, b] of ranges) for (let t = a; t < b; t++) held[t] = true
  return held
}

const flat = () => 10_000

describe('tradesFrom', () => {
  it('splits held ticks into trades, including one closed at the bell', () => {
    const trades = tradesFrom(marketOf(flat), heldOn([10, 20], [30, 31], [390, PLAY_TICKS]))
    expect(trades.map((t) => [t.entry, t.exit])).toEqual([
      [10, 20],
      [30, 31],
      [390, PLAY_TICKS],
    ])
  })
})

describe('analyzeRound', () => {
  it('flags holding a steadily losing position', () => {
    const m = marketOf((t) => 10_000 * (1 - 0.0005 * t))
    const h = analyzeRound(m, heldOn([0, 300]), 20_000)
    expect(h.scores.holder).toBeGreaterThan(0.5)
    expect(roundInsight(h).habit).toBe('holder')
    expect(roundInsight(h).title).toBe('손실을 끝까지 버텼어요')
  })

  it('names the disposition effect from sell rates while up versus down', () => {
    // A mild 1.5% slide held for 15 s and sold at a loss, then three quick
    // pops that each get sold at the top.
    const price = (t: number) => {
      if (t < 150) return 10_000 * (1 - 0.0001 * t)
      const pop = [200, 250, 300].find((s) => t >= s && t < s + 30)
      if (pop === undefined) return 9_850
      const k = t - pop
      return 9_850 * (1 + 0.002 * (k < 15 ? k : 30 - k))
    }
    const h = analyzeRound(marketOf(price), heldOn([0, 150], [200, 215], [250, 265], [300, 315]), 40_000)
    const insight = roundInsight(h)
    expect(insight.habit).toBe('holder')
    expect(h.facts.comparableRates).toBe(true)
    expect(h.facts.sellsUp).toBe(3)
    expect(h.facts.sellsDown).toBe(1)
    expect(h.facts.sellRateUp / h.facts.sellRateDown).toBeGreaterThan(1.5)
    expect(insight.title).toBe('수익은 빨리 팔고, 손실은 버텼어요')
    expect(insight.line).toContain('수익 중에 3번, 손실 중에 1번')
  })

  it('does not claim a disposition effect from one winner and one loser', () => {
    const price = (t: number) =>
      t < 200 ? 10_000 * (1 - 0.0003 * t) : 9_400 * (1 + 0.003 * (Math.min(t, 230) - 200))
    const h = analyzeRound(marketOf(price), heldOn([0, 190], [210, 230]), 20_000)
    expect(h.facts.comparableRates).toBe(false)
    expect(roundInsight(h).title).not.toBe('수익은 빨리 팔고, 손실은 버텼어요')
  })

  it('flags overtrading', () => {
    const ranges = Array.from({ length: 12 }, (_, i) => [i * 30, i * 30 + 10] as [number, number])
    const h = analyzeRound(marketOf(flat), heldOn(...ranges), 240_000)
    expect(h.trades).toBe(12)
    expect(roundInsight(h).habit).toBe('scalper')
    expect(roundInsight(h).line).toContain('24만 원')
  })

  it('flags selling winners right before the rally they started keeps going', () => {
    // Every 50 ticks: a small rise, a big rally, then a slide. Selling at the
    // first small gain misses far more than a random winner on this chart.
    const step = (k: number) => (k < 5 ? 0.001 * k : k < 30 ? 0.005 + 0.003 * (k - 5) : 0.08 - 0.003 * (k - 30))
    const m = marketOf((t) => 10_000 * Math.exp(step(t % 50)))
    const ranges = Array.from({ length: 7 }, (_, i) => [i * 50, i * 50 + 5] as [number, number])
    const h = analyzeRound(m, heldOn(...ranges), 70_000)
    expect(h.facts.cleanWinExits).toBe(7)
    expect(h.scores.chicken).toBeGreaterThan(0.5)
    const insight = roundInsight(h)
    expect(insight.habit).toBe('chicken')
    expect(insight.line).toContain('7번')
  })

  it('never says the price kept rising after you sold when it fell', () => {
    // Winners sold quickly, but the price drops right after each sale.
    const step = (k: number) => (k < 10 ? 0.002 * k : 0.02 - 0.004 * (k - 10))
    const m = marketOf((t) => 10_000 * Math.exp(step(t % 50)))
    const ranges = Array.from({ length: 7 }, (_, i) => [i * 50, i * 50 + 10] as [number, number])
    const h = analyzeRound(m, heldOn(...ranges), 70_000)
    expect(h.facts.missedAfterWin).toBeLessThan(0)
    expect(h.scores.chicken).toBe(0)
    expect(roundInsight(h).habit).not.toBe('chicken')
  })

  it('ignores the move after a sale when a news gap lands in it', () => {
    // Flat, with a big gap 1 s after each winning sale.
    const news: NewsEvent[] = [60, 160, 260].map((s) => ({
      at: s - 6, impactAt: s + 10, kind: 'filing' as const, headline: '', blindHeadline: '', implied: 1 as const, actual: 1 as const,
    }))
    const price = (t: number) => 10_000 * (1 + 0.001 * Math.max(0, Math.min((t % 100) - 55, 5))) * (1 + 0.05 * news.filter((n) => t >= n.impactAt).length)
    const h = analyzeRound(marketOf(price, news), heldOn([55, 60], [155, 160], [255, 260]), 30_000)
    expect(h.facts.winTrades).toBe(3)
    expect(h.facts.cleanWinExits).toBe(0)
    expect(h.scores.chicken).toBe(0)
  })

  it('flags buying right after a spike', () => {
    // Flat, then +6% over two seconds before each entry.
    const spikeAt = [100, 250]
    const price = (t: number) => {
      let p = 10_000
      for (const s of spikeAt) if (t >= s - 20) p *= 1 + 0.06 * Math.min(1, (t - (s - 20)) / 20)
      return p
    }
    const h = analyzeRound(marketOf(price), heldOn([100, 130], [250, 280]), 40_000)
    expect(h.facts.chaseEntries).toBe(2)
    expect(roundInsight(h).habit).toBe('chaser')
  })

  it('counts acting on rumors before the price moves, and whether they were false', () => {
    const rumorAt = (at: number, actual: 1 | -1): NewsEvent => ({
      at, impactAt: at + 16, kind: 'rumor', headline: '', blindHeadline: '', implied: 1, actual,
    })
    const news: NewsEvent[] = [
      rumorAt(100, -1),
      rumorAt(180, 1),
      rumorAt(260, -1),
      { at: 330, impactAt: 346, kind: 'filing', headline: '', blindHeadline: '', implied: 1, actual: 1 },
    ]
    const h = analyzeRound(marketOf(flat, news), heldOn([105, 140], [185, 220], [265, 300], [335, 380]), 80_000)
    expect(h.facts.rumorReactions).toBe(3)
    expect(h.facts.wrongRumorReactions).toBe(2)
    expect(h.facts.filingReactions).toBe(1)
    const insight = roundInsight(h)
    expect(insight.habit).toBe('rumor')
    expect(insight.line).toBe('지라시 3개 중 3개에 가격이 움직이기 전에 반응했어요. 그중 2개는 틀린 소문이었어요.')
  })

  it('does not call one rumor reaction a habit', () => {
    const news: NewsEvent[] = [
      { at: 100, impactAt: 116, kind: 'rumor', headline: '', blindHeadline: '', implied: 1, actual: -1 },
    ]
    const h = analyzeRound(marketOf(flat, news), heldOn([105, 140], [255, 300]), 40_000)
    expect(h.facts.rumorReactions).toBe(1)
    expect(h.scores.rumor).toBeLessThan(0.5)
  })

  it('says nothing about habits when there were no trades', () => {
    expect(roundInsight(analyzeRound(marketOf(flat), heldOn(), 0)).tone).toBe('none')
  })
})

/** A stored round with the given scores and otherwise neutral fields. */
export function recordOf(scores: HabitScores, extra: Partial<HabitRecord> = {}): HabitRecord {
  return {
    id: `p:${Math.random()}`,
    at: '2026-10-01',
    product: 'stock',
    length: 'short',
    trades: 3,
    heldRatio: 0.5,
    scores,
    measurable: { holder: true, chicken: true, scalper: true, chaser: true, rumor: true },
    counts: { sellUp: 0, expUp: 0, sellDown: 0, expDown: 0 },
    luckPct: null,
    ...extra,
  }
}

describe('profileFrom', () => {
  const zero: HabitScores = { holder: 0, chicken: 0, scalper: 0, chaser: 0, rumor: 0 }
  const times = (n: number, extra: Partial<HabitRecord> = {}, scores = zero) =>
    Array.from({ length: n }, () => recordOf(scores, extra))

  it('needs five rounds', () => {
    expect(profileFrom([zero, zero, zero, zero].map((s) => recordOf(s)))).toBeNull()
    expect(profileFrom([zero, zero, zero, zero, zero].map((s) => recordOf(s)))?.type).toBe('machine')
  })

  it('picks the strongest habit over the recent window', () => {
    const scalpy = { ...zero, scalper: 0.9 }
    const holdy = { ...zero, holder: 0.8 }
    // Old scalping rounds fall out of the 10-round window.
    const history = [...Array(10).fill(scalpy), ...Array(10).fill(holdy)].map((s) => recordOf(s))
    expect(profileFrom(history)?.type).toBe('holder')
  })

  it('averages a habit only over rounds where it could be measured', () => {
    const none = { holder: true, chicken: false, scalper: true, chaser: true, rumor: true }
    const history = [...times(8, { measurable: none }), ...times(2, {}, { ...zero, chicken: 0.6 })]
    const p = profileFrom(history)!
    expect(p.scores.chicken).toBeCloseTo(0.6)
    expect(p.type).toBe('chicken')
  })

  it('pools sell counts across rounds for the disposition effect', () => {
    // No single round is convincing, but ten rounds of selling only while up are.
    const counts = { sellUp: 1, expUp: 30, sellDown: 0, expDown: 60 }
    expect(profileFrom(times(10, { counts }))?.type).toBe('holder')
    // The same counts with sells while down too are not a habit.
    const even = { sellUp: 1, expUp: 30, sellDown: 2, expDown: 60 }
    expect(profileFrom(times(10, { counts: even }))?.type).toBe('machine')
  })

  it('calls barely playing a watcher, not a machine', () => {
    expect(profileFrom(times(5, { heldRatio: 0.01, trades: 1 }))?.type).toBe('watcher')
    expect(profileFrom(times(5, { heldRatio: 0.5, trades: 1 }))?.type).toBe('watcher')
    expect(profileFrom(times(5, { heldRatio: 0.1, trades: 4 }))?.type).toBe('watcher')
  })

  it('needs a better-than-random luck test for the machine type when it is known', () => {
    expect(profileFrom(times(5, { luckPct: 0.4 }))?.type).toBe('watcher')
    expect(profileFrom(times(5, { luckPct: 0.7 }))?.type).toBe('machine')
    // Two known results are too few to judge; unknown luck does not block it.
    expect(profileFrom([...times(2, { luckPct: 0.1 }), ...times(3)])?.type).toBe('machine')
  })

  it('does not count records migrated without participation as barely playing', () => {
    expect(profileFrom(times(5, { heldRatio: 0, trades: 1, at: '' }))?.type).toBe('machine')
  })
})
