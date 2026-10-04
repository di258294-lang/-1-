import { describe, expect, it } from 'vitest'
import { luckTest, luckVerdict, pathReturn, type LuckResult } from './luck'
import { generateMarket, playPrice } from './market'
import { createRng, type Rng } from './rng'
import { advanceTo, createRound, setHolding, summarize } from './round'

/** A P&L-blind player: given run lengths, placed uniformly at random (independent of prices). */
function blindPlayer(rng: Rng, n: number, lengths: number[]) {
  const k = lengths.length
  const held = new Array<boolean>(n).fill(false)
  const free = n - lengths.reduce((a, b) => a + b, 0) - (k - 1)
  // Uniform composition of `free` into k + 1 parts via k sorted distinct bars.
  const bars = new Set<number>()
  while (bars.size < k) bars.add(rng.int(0, free + k - 1))
  const sorted = [...bars].sort((a, b) => a - b)
  let t = 0
  sorted.forEach((bar, j) => {
    const gap = bar - (j === 0 ? 0 : sorted[j - 1] + 1) + (j > 0 ? 1 : 0)
    t += gap
    for (let i = 0; i < lengths[j]; i++) held[t + i] = true
    t += lengths[j]
  })
  return held
}

describe('luck test', () => {
  it('computes returns exactly like the round engine', () => {
    const m = generateMarket(42)
    const r = createRound(m)
    const held: boolean[] = []
    for (let t = 0; t < m.playTicks; t++) {
      const on = t % 37 < 15
      setHolding(r, on)
      held.push(on)
      advanceTo(r, t + 1)
    }
    expect(pathReturn(m, held)).toBeCloseTo(summarize(r).yourReturn, 10)
    expect(luckTest(m, held)!.playerReturn).toBeCloseTo(summarize(r).yourReturn, 10)
  })

  it('ranks a trader with perfect foresight at the top', () => {
    const m = generateMarket(7)
    // Hold exactly the one-second blocks that go up.
    const held = Array.from({ length: m.playTicks }, (_, t) => {
      const b = Math.floor(t / 10) * 10
      return playPrice(m, Math.min(b + 10, m.playTicks)) > playPrice(m, b)
    })
    const result = luckTest(m, held)!
    expect(result.percentile).toBeGreaterThan(0.99)
    expect(result.pValue).toBe(1 / (result.sims + 1))
  })

  it('ranks random play near the middle on average', () => {
    let sum = 0
    const rounds = 40
    for (let s = 0; s < rounds; s++) {
      const m = generateMarket(1000 + s)
      const held = Array.from({ length: m.playTicks }, (_, t) => Math.floor(t / 23 + s) % 3 === 0)
      sum += luckTest(m, held, 400)!.percentile
    }
    const avg = sum / rounds
    expect(avg).toBeGreaterThan(0.3)
    expect(avg).toBeLessThan(0.7)
  })

  it('skips rounds with nothing to compare', () => {
    const m = generateMarket(3)
    expect(luckTest(m, new Array(m.playTicks).fill(false))).toBeNull()
    expect(luckTest(m, new Array(m.playTicks).fill(true))).toBeNull()
  })

  it('is deterministic', () => {
    const m = generateMarket(9)
    const held = Array.from({ length: m.playTicks }, (_, t) => t % 50 < 20)
    expect(luckTest(m, held)!.nullReturns).toEqual(luckTest(m, held)!.nullReturns)
  })

  it('places exactly the player’s runs, every placement equally often', () => {
    // One run of n - 5 ticks fits in exactly 6 places. Every null return
    // must be one of those 6 path returns, each drawn about 1/6 of the time.
    const m = generateMarket(21)
    const n = m.playTicks
    const placements = Array.from({ length: 6 }, (_, start) =>
      pathReturn(m, Array.from({ length: n }, (_, t) => t >= start && t < start + n - 5)),
    )
    const held = Array.from({ length: n }, (_, t) => t >= 2 && t < n - 3)
    const result = luckTest(m, held, 3000)!
    const counts = new Array(6).fill(0)
    for (const r of result.nullReturns) {
      const i = placements.findIndex((p) => Math.abs(p - r) < 1e-9)
      expect(i).toBeGreaterThanOrEqual(0)
      counts[i]++
    }
    for (const c of counts) expect(Math.abs(c - 500)).toBeLessThan(100)
    // The player's own placement is one of them: p-value counts it.
    const atLeast = placements.filter((p) => p >= result.playerReturn - 1e-9).length
    expect(result.pValue).toBeCloseTo((1 + (atLeast / 6) * 3000) / 3001, 1)
  })

  it('keeps fees: several runs cost the same in every placement', () => {
    const m = generateMarket(33)
    const held = Array.from({ length: m.playTicks }, (_, t) => t % 80 < 10)
    const result = luckTest(m, held)!
    expect(result.runs).toBe(5)
    // A flat chart would make every placement worth exactly fees plus interest.
    const flat = { ...m, prices: m.prices.map(() => 100) }
    const flatResult = luckTest(flat, held)!
    for (const r of flatResult.nullReturns) expect(r).toBeCloseTo(flatResult.playerReturn, 12)
  })

  it('accepts an override for the player’s return', () => {
    const m = generateMarket(9)
    const held = Array.from({ length: m.playTicks }, (_, t) => t % 50 < 20)
    const base = luckTest(m, held)!
    expect(luckTest(m, held, 1000, 10)!.pValue).toBe(1 / 1001)
    expect(luckTest(m, held, 1000, -10)!.pValue).toBe(1)
    expect(luckTest(m, held, 1000, base.playerReturn)!.pValue).toBe(base.pValue)
  })

  it('is calibrated: a price-blind player gets p <= 0.05 about 5% of the time', () => {
    const rng = createRng(0xc0ffee)
    for (const k of [1, 4, 10]) {
      const pValues: number[] = []
      for (let s = 0; s < 300; s++) {
        const m = generateMarket(5000 + s * 13 + k, 'stock')
        const lengths = Array.from({ length: k }, () => rng.int(5, 120 / k + 10))
        const held = blindPlayer(rng, m.playTicks, lengths)
        pValues.push(luckTest(m, held, 199)!.pValue)
      }
      const rate = pValues.filter((p) => p <= 0.05).length / pValues.length
      expect(rate, `k=${k}`).toBeGreaterThanOrEqual(0.025)
      expect(rate, `k=${k}`).toBeLessThanOrEqual(0.08)
      // Deciles: chi-square with 9 degrees of freedom, 99.9% point 27.9.
      const bins = new Array(10).fill(0)
      for (const p of pValues) bins[Math.min(9, Math.floor(p * 10 - 1e-9))]++
      const chi2 = bins.reduce((acc, c) => acc + (c - 30) ** 2 / 30, 0)
      expect(chi2, `k=${k} deciles ${bins}`).toBeLessThan(27.9)
    }
  })
})

describe('luck verdict', () => {
  const fake = (pValue: number, percentile: number): LuckResult => ({
    pValue, percentile, sims: 1000, nullReturns: [], playerReturn: 0, runs: 3,
  })

  it('states the chance of a random placement doing as well, never a chance of skill', () => {
    for (const [p, pct] of [[0.002, 0.999], [0.03, 0.97], [0.15, 0.85], [0.5, 0.5], [0.9, 0.1]]) {
      const v = luckVerdict(fake(p, pct))
      expect(v.headline).toMatch(/^아무 때나 누른 1,000판보다 잘한 비율 \d+%$/)
      expect(v.rank).toMatch(/^무작위 배치 1,000번 중 (상위|하위) \d+%$/)
      expect(v.line + v.headline + v.note).not.toMatch(/실력일 가능성|운일 확률|실력일 확률|꽤 잘했/)
      expect(v.line + v.headline + v.note).not.toMatch(/—/)
      if (p <= 0.2) {
        expect(v.line).toMatch(/아무렇게나 누른 가상 플레이어 중 이만큼 이상 낸 경우는/)
        expect(v.line).toMatch(/한 판만으로는 알 수 없어요/)
      }
    }
    expect(luckVerdict(fake(0.002, 0.999)).line).toMatch(/1% 미만이에요/)
    expect(luckVerdict(fake(0.03, 0.97)).line).toMatch(/약 3%예요/)
  })

  it('works the odds out from p instead of a fixed "20판"', () => {
    expect(luckVerdict(fake(0.01, 0.99)).line).toContain('약 100판에 한 번')
    expect(luckVerdict(fake(0.03, 0.97)).line).toContain('약 33판에 한 번')
    expect(luckVerdict(fake(0.15, 0.85)).line).toContain('약 7판에 한 번')
    expect(luckVerdict(fake(1 / 1001, 1)).line).toContain('이만큼 낸 판은 없었어요')
    for (const [p, pct] of [[0.01, 0.99], [0.03, 0.97], [0.15, 0.85]]) expect(luckVerdict(fake(p, pct)).line).not.toContain('20판')
  })

  it('says the headline as the share of random placements beaten, never 0 or 100 for a partial result', () => {
    expect(luckVerdict(fake(0.03, 0.97)).headline).toBe('아무 때나 누른 1,000판보다 잘한 비율 97%')
    expect(luckVerdict(fake(0.002, 0.9996)).headline).toBe('아무 때나 누른 1,000판보다 잘한 비율 99%')
    expect(luckVerdict(fake(0.9996, 0.004)).headline).toBe('아무 때나 누른 1,000판보다 잘한 비율 1%')
  })
})
