import { describe, expect, it } from 'vitest'
import { dailySeed } from './daily'
import { ENGINE_VERSION, engineParams, generateMarket, LENGTHS, round8, tailMoments, type Market, type RoundLength } from './market'
import { dailyProduct, PRODUCT_ORDER, PRODUCTS, type ProductKey } from './products'
import { hashString } from './rng'

/** FNV-1a over every stored series, as text (number-to-string is exactly specified). */
function chartHash(m: Market) {
  const parts = [m.prices.join(',')]
  if (m.yields) parts.push(m.yields.join(','))
  if (m.underlying) parts.push(m.underlying.join(','))
  return hashString(parts.join('|')).toString(16)
}

describe('determinism', () => {
  it('is engine version 2', () => {
    expect(ENGINE_VERSION).toBe(2)
  })

  it('rounds stored numbers to 8 significant digits', () => {
    expect(round8(123456.789012)).toBe(123456.79)
    expect(round8(0.0295882345678)).toBe(0.029588235)
    expect(round8(-0.00123456789)).toBe(-0.0012345679)
    expect(round8(987.654321)).toBe(987.65432)
    expect(round8(0)).toBe(0)
    for (const key of PRODUCT_ORDER) {
      const m = generateMarket(11, key)
      const series = key === 'lev2' ? m.underlying! : m.prices
      for (const x of series) expect(Number(x.toPrecision(8))).toBe(x)
      for (const y of m.yields ?? []) expect(Number(y.toPrecision(8))).toBe(y)
    }
  })

  // Golden charts. If an intended engine change moves these, bump
  // ENGINE_VERSION and regenerate them; otherwise a change here is a bug.
  const GOLDEN: [ProductKey, RoundLength, number, string][] = [
    ['stock', 'short', 1, 'ede27ef2'],
    ['stock', 'long', 2, 'a6156b9b'],
    ['bond', 'short', 3, 'c080e9b5'],
    ['bond', 'long', 4, '29df351a'],
    ['gold', 'short', 5, '30556256'],
    ['coin', 'short', 6, '2529965f'],
    ['coin', 'long', 7, 'b464f24d'],
    ['lev2', 'short', 8, '3038dcd1'],
    ['lev2', 'long', 9, '879126d0'],
  ]
  for (const [product, length, seed, hash] of GOLDEN) {
    it(`draws the golden ${product}/${length} chart for seed ${seed}`, () => {
      expect(chartHash(generateMarket(seed, product, length))).toBe(hash)
    })
  }

  it('draws the golden daily chart for 2026-10-01', () => {
    const key = '2026-10-01'
    expect(chartHash(generateMarket(dailySeed(key), dailyProduct(key)))).toBe('56b3ca39')
  })
})

describe('engine parameters', () => {
  it('keeps the GARCH fourth moment finite: E[(alpha u + beta)^2] < 1', () => {
    for (const key of PRODUCT_ORDER) {
      for (const length of ['short', 'long'] as const) {
        const { alpha, beta, nu } = engineParams(key, length).garch
        const { u1, uVar } = tailMoments(nu)
        const s = alpha * u1 + beta
        expect(s * s + alpha * alpha * uVar).toBeLessThan(1)
        expect(alpha).toBeGreaterThan(0)
        expect(beta).toBeGreaterThan(0)
      }
    }
  })

  it('gives volatility the same half-life in trading days in both round lengths', () => {
    for (const key of PRODUCT_ORDER) {
      const halfLife = (length: RoundLength) => {
        const { alpha, beta, nu } = engineParams(key, length).garch
        const perTick = alpha * tailMoments(nu).u1 + beta
        return Math.log(0.5) / Math.log(perTick) / engineParams(key, length).ticksPerDay
      }
      expect(halfLife('short')).toBeCloseTo(halfLife('long'), 6)
      expect(halfLife('long')).toBeCloseTo(Math.log(0.5) / Math.log(0.9), 6)
    }
  })

  it('budgets jumps with the news rate the planner really delivers', () => {
    for (const key of ['stock', 'coin'] as const) {
      for (const length of ['short', 'long'] as const) {
        const seeds = length === 'short' ? 2000 : 200
        let count = 0
        for (let s = 0; s < seeds; s++) count += generateMarket(s * 31 + 5, key, length).news.length
        const expected = engineParams(key, length).expectedNews
        // Poisson-ish counts: allow 4 standard errors.
        expect(Math.abs(count / seeds - expected)).toBeLessThan(4 * Math.sqrt(expected / seeds))
        expect(expected).toBeLessThan(PRODUCTS[key].model.newsPerDay * LENGTHS[length].days)
      }
    }
  })
})

describe('tails', () => {
  // A few hundred one-year rounds per product. Ticks are measured against
  // the engine's own long-run noise sigma, sqrt(tickVar): the clip (8) and
  // the variance cap (9x) bound a quiet tick at about 24 of those, so this
  // can never flake. Days are measured against the product's nominal daily
  // sigma (annual target / sqrt(252); the 2x fund on its 20% index, bonds on
  // the 90bp yield). Over 4,000 seeds the worst quiet day was 9.3 of those
  // (stock); the review saw 70.
  it('has no non-news tick beyond 25 noise sigmas and no non-news day beyond 12 daily sigmas', () => {
    for (const key of PRODUCT_ORDER) {
      const p = engineParams(key, 'long')
      const model = PRODUCTS[key].model
      const tickSigma = Math.sqrt(p.tickVar)
      const daySigma = (model.bond ? model.bond.sigmaYield : model.sigma) / Math.sqrt(252)
      let worstTick = 0
      let worstDay = 0
      for (let s = 0; s < 300; s++) {
        const m = generateMarket(s * 104729 + 3, key, 'long')
        // The 2x fund is checked on its index; bonds on the yield.
        const series = m.underlying ?? m.yields ?? m.prices
        const step = (a: number, b: number) => (m.yields ? series[b] - series[a] : Math.log(series[b] / series[a]))
        const news = new Set(m.news.map((n) => m.historyTicks + n.impactAt))
        for (let d = 0; d < m.playTicks / m.ticksPerDay; d++) {
          const a = m.historyTicks + d * m.ticksPerDay
          let quiet = true
          for (let i = a + 1; i <= a + m.ticksPerDay; i++) {
            if (news.has(i)) quiet = false
            else worstTick = Math.max(worstTick, Math.abs(step(i - 1, i)) / tickSigma)
          }
          if (quiet) worstDay = Math.max(worstDay, Math.abs(step(a, a + m.ticksPerDay)) / daySigma)
        }
      }
      expect(worstTick, key).toBeLessThan(25)
      expect(worstDay, key).toBeLessThan(12)
    }
  })
})
