import { describe, expect, it } from 'vitest'
import { luckTest, pathReturn } from './luck'
import { generateMarket, playPrice } from './market'
import { advanceTo, createRound, setHolding, summarize } from './round'

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
  })

  it('ranks a trader with perfect foresight at the top', () => {
    const m = generateMarket(7)
    // Hold exactly the one-second blocks that go up.
    const held = Array.from({ length: m.playTicks }, (_, t) => {
      const b = Math.floor(t / 10) * 10
      return playPrice(m, Math.min(b + 10, m.playTicks)) > playPrice(m, b)
    })
    expect(luckTest(m, held)!.percentile).toBeGreaterThan(0.99)
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
    expect(luckTest(m, held)!.percentile).toBe(luckTest(m, held)!.percentile)
  })
})
