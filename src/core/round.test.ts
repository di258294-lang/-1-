import { describe, expect, it } from 'vitest'
import { tradesFrom } from './habits'
import { pathReturn } from './luck'
import { generateMarket } from './market'
import { advanceTo, createRound, EVEN_EDGE, gradeFor, setHolding, summarize, type Round } from './round'

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
})
