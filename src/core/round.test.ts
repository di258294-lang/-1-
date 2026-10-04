import { describe, expect, it } from 'vitest'
import { tickVolatility, tradesFrom } from './habits'
import { pathReturn } from './luck'
import { generateMarket } from './market'
import { formatPct } from './format'
import { advanceTo, createRound, EVEN_EDGE, gradeEdges, gradeFor, roundScale, setHolding, summarize, type Round } from './round'

const runsOf = (held: boolean[]) => held.filter((on, t) => on && !held[t - 1]).length

/** Press and release inside the same tick, then let time move on. */
function quickTap(round: Round) {
  setHolding(round, true)
  setHolding(round, false)
}

describe('round: every trade leaves a trace in held', () => {
  it('records a press and release inside one tick as a held tick', () => {
    const m = generateMarket(11)
    const r = createRound(m)
    advanceTo(r, 50)
    quickTap(r)
    advanceTo(r, m.playTicks)
    const s = summarize(r)
    expect(s.trades).toBe(1)
    expect(s.held[50]).toBe(true)
    expect(s.held.filter(Boolean)).toHaveLength(1)
    expect(runsOf(s.held)).toBe(1)
  })

  it('matches the replayed path return, so the luck card agrees with the result', () => {
    const m = generateMarket(77)
    const r = createRound(m)
    for (let t = 0; t < m.playTicks; t += 9) {
      advanceTo(r, t)
      if (t % 27 === 0) quickTap(r)
      else setHolding(r, t % 18 === 0)
    }
    advanceTo(r, m.playTicks)
    const s = summarize(r)
    expect(pathReturn(m, s.held)).toBeCloseTo(s.yourReturn, 10)
  })

  it('counts trades as held runs, also for habit analysis', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const m = generateMarket(seed)
      const r = createRound(m)
      // Deterministic messy input: taps, holds, release and re-press in one tick.
      for (let t = 0; t < m.playTicks; t++) {
        advanceTo(r, t)
        const k = (t * 7 + seed * 13) % 23
        if (k === 0) quickTap(r)
        else if (k === 3) setHolding(r, true)
        else if (k === 9) setHolding(r, false)
        else if (k === 15 && r.holding) {
          setHolding(r, false)
          setHolding(r, true)
        }
      }
      advanceTo(r, m.playTicks)
      const s = summarize(r)
      expect(s.trades).toBe(runsOf(s.held))
      expect(tradesFrom(m, s.held)).toHaveLength(s.trades)
      expect(pathReturn(m, s.held)).toBeCloseTo(s.yourReturn, 10)
    }
  })

  it('treats release and re-press inside one tick as no trade at all', () => {
    const m = generateMarket(5)
    const r = createRound(m)
    setHolding(r, true)
    advanceTo(r, 10)
    const before = { equity: r.equity, fees: r.fees, trades: r.trades }
    setHolding(r, false)
    setHolding(r, true)
    expect(r.equity).toBeCloseTo(before.equity, 6)
    expect(r.fees).toBeCloseTo(before.fees, 6)
    expect(r.trades).toBe(before.trades)
  })

  it('charges two fees for a quick tap, like any round trip', () => {
    const m = generateMarket(9)
    const r = createRound(m)
    advanceTo(r, 20)
    quickTap(r)
    expect(r.fees).toBeGreaterThan(0)
    expect(r.trades).toBe(1)
  })
})

describe('grade titles never contradict the numbers', () => {
  // Wording that reads as a loss or a miss, and wording that reads as praise.
  const LOSSY = /잃|거꾸로|늦|못/
  const PRAISE = /앞섰|벌었|잘|장인|좋|정답/
  const BEHIND = /덜 탔|더 잃|거꾸로|늦/
  const AHEAD = /앞섰|덜 잃/
  const returns = [-0.4, -0.12, -0.05, -0.02, -0.006, -0.004, -0.001, 0, 0.001, 0.004, 0.006, 0.02, 0.05, 0.12, 0.4]

  it('matches the tone of the title to the sign of the return and of the edge', () => {
    let checked = 0
    for (const r of returns) {
      for (const b of returns) {
        for (const held of [0, 0.05, 0.5, 1]) {
          // Sitting out the whole round earns interest only: a small gain.
          const you = held === 0 ? 0.002 : r
          const { title, line } = gradeFor(you, b, held)
          const edge = you - b
          const tag = `${title} (you ${you}, market ${b}, held ${held})`
          expect(title.length, tag).toBeGreaterThan(0)
          expect(line.length, tag).toBeGreaterThan(0)
          if (you > 0) expect(title, tag).not.toMatch(LOSSY)
          if (you < 0) expect(title, tag).not.toMatch(PRAISE)
          if (edge > EVEN_EDGE) expect(title, tag).not.toMatch(BEHIND)
          if (edge < -EVEN_EDGE) expect(title, tag).not.toMatch(AHEAD)
          // No identity labels ("타이밍 장인"): titles describe the round.
          expect(title, tag).toMatch(/요$/)
          checked++
        }
      }
    }
    expect(checked).toBe(returns.length * returns.length * 4)
  })

  it('keeps "거꾸로 탔어요" for losing money while the market rose', () => {
    expect(gradeFor(-0.03, 0.05, 0.6).title).toBe('거꾸로 탔어요')
    expect(gradeFor(0.04, 0.2, 0.6).title).toBe('올랐는데 덜 탔어요')
    expect(gradeFor(-0.006, 0.155, 0.1).title).toBe('거꾸로 탔어요')
    expect(gradeFor(-0.08, -0.03, 0.6).title).toBe('시장보다 더 잃었어요')
    expect(gradeFor(-0.01, -0.06, 0.6).title).toBe('시장보다 덜 잃었어요')
  })

  it('adds a luck caveat to big wins', () => {
    expect(gradeFor(0.2, 0.01, 0.5).line).toMatch(/운/)
  })

  it('keeps the sweep honest with the round scale too, and scales "크게" and "비김"', () => {
    for (const scale of [0.004, 0.012, 0.05, 0.12]) {
      const { even, big } = gradeEdges(scale)
      expect(even).toBeGreaterThanOrEqual(0.001)
      expect(big).toBeCloseTo(Math.max(0.002, scale), 12)
      for (const r of returns) {
        for (const b of returns) {
          const { title } = gradeFor(r, b, 0.5, scale)
          const edge = r - b
          const tag = `${title} (you ${r}, market ${b}, scale ${scale})`
          if (r > 0) expect(title, tag).not.toMatch(LOSSY)
          if (r < 0) expect(title, tag).not.toMatch(PRAISE)
          if (edge > even) expect(title, tag).not.toMatch(BEHIND)
          if (edge < -even) expect(title, tag).not.toMatch(AHEAD)
          if (title.includes('크게')) expect(edge, tag).toBeGreaterThanOrEqual(big)
        }
      }
    }
    // A 2% lead is big on a bond chart (scale 0.4%), ordinary on a coin chart (12%).
    expect(gradeFor(0.03, 0.01, 0.5, 0.004).title).toBe('시장보다 크게 앞섰어요')
    expect(gradeFor(0.03, 0.01, 0.5, 0.12).title).toBe('시장보다 앞섰어요')
    // Without a scale the old fixed cut-offs apply.
    expect(gradeEdges()).toEqual({ even: EVEN_EDGE, big: 0.05 })
  })

  it('never says "시장만큼 잃었어요" while the market rose', () => {
    for (const scale of [undefined, 0.004, 0.05]) {
      for (const [you, mkt] of [[-0.001, 0.003], [-0.0004, 0.0001], [-0.002, 0]] as const) {
        const g = gradeFor(you, mkt, 0.5, scale)
        expect(g.title, `${you} ${mkt}`).not.toBe('시장만큼 잃었어요')
      }
    }
    expect(gradeFor(-0.001, 0.003, 0.5).title).toBe('시장만큼 했어요')
    expect(gradeFor(-0.001, -0.003, 0.5).title).toBe('시장만큼 잃었어요')
  })

  it('computes the gap from the numbers as shown, one decimal each', () => {
    // 3.24% and 11.26% show as +3.2% and +11.3%: the gap reads 8.1%, not 8.0%.
    expect(gradeFor(0.0324, 0.1126, 0.5).line).toContain('8.1%')
    expect(gradeFor(0.0326, 0.1124, 0.5).line).toContain('7.9%')
    for (let i = 0; i < 400; i++) {
      const you = Math.sin(i * 12.9898) * 0.15
      const mkt = Math.sin(i * 78.233) * 0.15
      const { line } = gradeFor(you, mkt, 0.5, 0.05)
      const m = line.match(/(\d+\.\d)% (더|덜)/)
      if (!m) continue
      const shown = (x: number) => Number(formatPct(x, 1).replace('%', ''))
      expect(Number(m[1]), line).toBeCloseTo(Math.abs(shown(you) - shown(mkt)), 9)
    }
  })

  it('passes the round scale from summarize', () => {
    const m = generateMarket(3, 'bond')
    const s = roundScale(m)
    expect(s).toBeGreaterThan(0.001)
    expect(s).toBeLessThan(0.02)
    expect(roundScale(generateMarket(3, 'coin'))).toBeGreaterThan(s * 5)
    // Same estimate as the habit measures' tick volatility.
    for (const product of ['stock', 'bond', 'coin'] as const) {
      for (const length of ['short', 'long'] as const) {
        const m = generateMarket(11, product, length)
        expect(roundScale(m)).toBeCloseTo(tickVolatility(m) * Math.sqrt(m.playTicks), 9)
      }
    }
  })
})
