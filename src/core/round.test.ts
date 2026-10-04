import { describe, expect, it } from 'vitest'
import { tradesFrom } from './habits'
import { pathReturn } from './luck'
import { generateMarket } from './market'
import { advanceTo, createRound, setHolding, summarize, type Round } from './round'

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
