import { describe, expect, it } from 'vitest'
import { analyzeRound, profileFrom, roundInsight, tradesFrom, type HabitScores } from './habits'
import { COMPANIES, HISTORY_TICKS, PLAY_TICKS, type Market, type NewsEvent } from './market'

/** A market whose play-relative price at tick t is price(t). */
function marketOf(price: (t: number) => number, news: NewsEvent[] = []): Market {
  const prices = Array.from({ length: HISTORY_TICKS + PLAY_TICKS + 1 }, (_, i) =>
    price(Math.max(0, i - HISTORY_TICKS)),
  )
  return { seed: 0, company: COMPANIES[0], prices, news }
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

  it('only claims losers were held longer when they were', () => {
    // A slow 6% slide held for 19s, then a 2s pop that is sold at the top.
    const price = (t: number) =>
      t < 200 ? 10_000 * (1 - 0.0003 * t) : 9_400 * (1 + 0.003 * (Math.min(t, 230) - 200))
    const h = analyzeRound(marketOf(price), heldOn([0, 190], [210, 230]), 20_000)
    const insight = roundInsight(h)
    expect(insight.habit).toBe('holder')
    expect(h.facts.avgLossHoldSec).toBeGreaterThan(h.facts.avgWinHoldSec * 1.5)
    expect(insight.title).toBe('손실은 오래, 수익은 짧게 들고 있었어요')
  })

  it('flags overtrading', () => {
    const ranges = Array.from({ length: 12 }, (_, i) => [i * 30, i * 30 + 10] as [number, number])
    const h = analyzeRound(marketOf(flat), heldOn(...ranges), 240_000)
    expect(h.trades).toBe(12)
    expect(roundInsight(h).habit).toBe('scalper')
    expect(roundInsight(h).line).toContain('24만 원')
  })

  it('flags selling winners while the price keeps climbing', () => {
    const m = marketOf((t) => 10_000 * (1 + 0.0015 * t))
    const h = analyzeRound(m, heldOn([20, 40], [120, 140], [220, 240]), 60_000)
    expect(h.scores.chicken).toBeGreaterThan(0.5)
    expect(h.scores.scalper).toBe(0)
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

  it('counts acting on a rumor before the price moves, and whether it was false', () => {
    const news: NewsEvent[] = [
      { at: 100, impactAt: 116, kind: 'rumor', headline: '', blindHeadline: '', implied: 1, actual: -1 },
      { at: 250, impactAt: 266, kind: 'filing', headline: '', blindHeadline: '', implied: 1, actual: 1 },
    ]
    const h = analyzeRound(marketOf(flat, news), heldOn([105, 140], [255, 300]), 40_000)
    expect(h.facts.rumorReactions).toBe(1)
    expect(h.facts.wrongRumorReactions).toBe(1)
    expect(h.facts.filingReactions).toBe(1)
    expect(roundInsight(h).habit).toBe('rumor')
  })

  it('says nothing about habits when there were no trades', () => {
    expect(roundInsight(analyzeRound(marketOf(flat), heldOn(), 0)).tone).toBe('none')
  })
})

describe('profileFrom', () => {
  const zero: HabitScores = { holder: 0, chicken: 0, scalper: 0, chaser: 0, rumor: 0 }

  it('needs five rounds', () => {
    expect(profileFrom([zero, zero, zero, zero])).toBeNull()
    expect(profileFrom([zero, zero, zero, zero, zero])?.type).toBe('machine')
  })

  it('picks the strongest habit over the recent window', () => {
    const scalpy = { ...zero, scalper: 0.9 }
    const holdy = { ...zero, holder: 0.8 }
    // Old scalping rounds fall out of the 10-round window.
    const history = [...Array(10).fill(scalpy), ...Array(10).fill(holdy)]
    expect(profileFrom(history)?.type).toBe('holder')
  })
})
