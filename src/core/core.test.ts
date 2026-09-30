import { describe, expect, it } from 'vitest'
import { createRng, hashString } from './rng'
import { generateMarket, HISTORY_TICKS, PLAY_TICKS, playPrice } from './market'
import { advanceTo, createRound, FEE_RATE, setHolding, START_EQUITY, summarize } from './round'
import { dateKey, dayNumber, msUntilNextDay, previousKey } from './daily'
import { formatPct, formatWonDelta } from './format'
import { timelineSquares } from './share'

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = createRng(42)
    const b = createRng(42)
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next())
  })
  it('hashes strings stably', () => {
    expect(hashString('hold')).toBe(hashString('hold'))
    expect(hashString('a')).not.toBe(hashString('b'))
  })
})

describe('market', () => {
  it('is identical for the same seed', () => {
    expect(generateMarket(7).prices).toEqual(generateMarket(7).prices)
  })
  it('has the expected length and positive prices', () => {
    const m = generateMarket(123)
    expect(m.prices).toHaveLength(HISTORY_TICKS + PLAY_TICKS + 1)
    expect(m.prices.every((p) => p > 0 && Number.isFinite(p))).toBe(true)
  })
  it('schedules news inside the round with a lead time', () => {
    for (let s = 0; s < 200; s++) {
      for (const ev of generateMarket(s).news) {
        expect(ev.at).toBeGreaterThanOrEqual(0)
        expect(ev.impactAt).toBeGreaterThan(ev.at)
        expect(ev.impactAt + 6).toBeLessThanOrEqual(PLAY_TICKS)
        if (ev.kind === 'filing') expect(ev.actual).toBe(ev.implied)
        expect(ev.blindHeadline).not.toContain(generateMarket(s).company.name)
      }
    }
  })
})

describe('round', () => {
  it('tracks buy and hold exactly when held the whole time, minus two fees', () => {
    const m = generateMarket(99)
    const r = createRound(m)
    setHolding(r, true)
    advanceTo(r, PLAY_TICKS)
    const bh = playPrice(m, PLAY_TICKS) / playPrice(m, 0)
    expect(r.holding).toBe(false)
    expect(r.equity).toBeCloseTo(START_EQUITY * (1 - FEE_RATE) * bh * (1 - FEE_RATE), 4)
    expect(summarize(r).heldRatio).toBe(1)
  })
  it('keeps cash flat when never holding', () => {
    const r = createRound(generateMarket(5))
    advanceTo(r, PLAY_TICKS)
    const s = summarize(r)
    expect(s.finalEquity).toBe(START_EQUITY)
    expect(s.trades).toBe(0)
  })
  it('never beats per-tick hindsight, and per-second hindsight beats buy and hold', () => {
    const m = generateMarket(2024)
    const r = createRound(m)
    for (let t = 0; t < PLAY_TICKS; t++) {
      setHolding(r, t % 7 < 3)
      advanceTo(r, t + 1)
    }
    let upperBound = 1
    for (let t = 0; t < PLAY_TICKS; t++) {
      upperBound *= Math.max(1, playPrice(m, t + 1) / playPrice(m, t))
    }
    const s = summarize(r)
    expect(s.yourReturn).toBeLessThanOrEqual(upperBound - 1)
    expect(s.perfectReturn).toBeGreaterThanOrEqual(Math.max(0, s.buyHoldReturn))
  })
  it('refuses to open a position after the bell', () => {
    const r = createRound(generateMarket(1))
    advanceTo(r, PLAY_TICKS)
    setHolding(r, true)
    expect(r.holding).toBe(false)
  })
})

describe('daily', () => {
  it('uses KST midnight as the day boundary', () => {
    // 2026-10-01 14:59:59Z is 23:59:59 KST, 15:00Z is the next day.
    expect(dateKey(Date.parse('2026-10-01T14:59:59Z'))).toBe('2026-10-01')
    expect(dateKey(Date.parse('2026-10-01T15:00:00Z'))).toBe('2026-10-02')
    expect(msUntilNextDay(Date.parse('2026-10-01T14:59:59Z'))).toBe(1000)
  })
  it('counts days from the epoch', () => {
    expect(dayNumber('2026-10-01')).toBe(1)
    expect(dayNumber('2026-10-31')).toBe(31)
    expect(previousKey('2026-10-01')).toBe('2026-09-30')
  })
})

describe('format', () => {
  it('formats signed percentages', () => {
    expect(formatPct(0.12345)).toBe('+12.35%')
    expect(formatPct(-0.05)).toBe('-5.00%')
    expect(formatPct(0.000001)).toBe('0.00%')
    expect(formatWonDelta(-3200)).toBe('-3,200원')
  })
})

describe('share', () => {
  it('produces ten squares', () => {
    const m = generateMarket(3)
    const squares = [...timelineSquares(m, new Array(PLAY_TICKS).fill(false))]
    expect(squares).toHaveLength(10)
    expect(squares.every((c) => c === '⬜')).toBe(true)
  })
})
