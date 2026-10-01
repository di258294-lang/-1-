import { describe, expect, it } from 'vitest'
import { createRng, hashString } from './rng'
import { generateMarket, HISTORY_TICKS, PLAY_TICKS, playPrice } from './market'
import { advanceTo, CASH_RATE_PER_TICK, createRound, FEE_RATE, setHolding, START_EQUITY, summarize } from './round'
import { dateKey, dayNumber, msUntilNextDay, previousKey } from './daily'
import { formatPct, formatWonDelta, iEyo } from './format'
import { timelineSquares } from './share'
import { dailyProduct, PRODUCT_ORDER, PRODUCTS } from './products'
import { productLesson } from './lessons'
import { accountAfter, accountBefore, SEASON_START, seasonDaysLeft, seasonLabel } from './season'

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
  it('pays a little interest on idle cash', () => {
    const r = createRound(generateMarket(5))
    advanceTo(r, PLAY_TICKS)
    const s = summarize(r)
    expect(s.finalEquity).toBeCloseTo(START_EQUITY * (1 + CASH_RATE_PER_TICK) ** PLAY_TICKS, 4)
    expect(s.yourReturn).toBeGreaterThan(0.002)
    expect(s.yourReturn).toBeLessThan(0.004)
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

describe('season account', () => {
  const daily = {
    '2026-09-30': { yourReturn: 0.5 },
    '2026-10-01': { yourReturn: 0.1 },
    '2026-10-02': { yourReturn: -0.2 },
  }
  it('compounds daily results within the month only', () => {
    expect(accountBefore(daily, '2026-10-01')).toBe(SEASON_START)
    expect(accountAfter(daily, '2026-10-01')).toBeCloseTo(11_000_000)
    expect(accountAfter(daily, '2026-10-02')).toBeCloseTo(8_800_000)
    // Not played yet: before and after match.
    expect(accountBefore(daily, '2026-10-05')).toBeCloseTo(8_800_000)
    expect(accountAfter(daily, '2026-10-05')).toBeCloseTo(8_800_000)
  })
  it('labels the season and counts the days left', () => {
    expect(seasonLabel('2026-10-01')).toBe('10월 시즌')
    expect(seasonDaysLeft('2026-10-01')).toBe(30)
    expect(seasonDaysLeft('2026-02-28')).toBe(0)
  })
  it('starts a round from any balance', () => {
    const r = createRound(generateMarket(9), 5_000_000)
    advanceTo(r, PLAY_TICKS)
    expect(summarize(r).startEquity).toBe(5_000_000)
    expect(summarize(r).finalEquity).toBeCloseTo(5_000_000 * (1 + CASH_RATE_PER_TICK) ** PLAY_TICKS, 4)
  })
})

describe('products', () => {
  it('keeps every product series positive and sized', () => {
    for (const key of PRODUCT_ORDER) {
      for (let s = 0; s < 50; s++) {
        const m = generateMarket(s, key)
        expect(m.product).toBe(key)
        expect(m.prices.every((p) => p > 0 && Number.isFinite(p))).toBe(true)
        expect(m.feeRate).toBe(PRODUCTS[key].fee)
        if (key === 'lev2') expect(m.underlying).toHaveLength(m.prices.length)
      }
    }
  })
  it('makes the leveraged product move twice its index each tick', () => {
    const m = generateMarket(77, 'lev2')
    const u = m.underlying!
    for (let i = 1; i < 50; i++) {
      expect(m.prices[i] / m.prices[i - 1] - 1).toBeCloseTo(2 * (u[i] / u[i - 1] - 1), 10)
    }
  })
  it('hides the asset name in headlines during the round', () => {
    for (const key of PRODUCT_ORDER) {
      for (let s = 0; s < 30; s++) {
        const m = generateMarket(s, key)
        for (const n of m.news) expect(n.blindHeadline).not.toContain(m.company.name)
      }
    }
  })
  it('rotates the daily product by weekday', () => {
    expect(dailyProduct('2026-10-01')).toBe('stock') // Thursday
    expect(dailyProduct('2026-10-02')).toBe('lev2') // Friday
    expect(dailyProduct('2026-10-03')).toBe('coin') // Saturday
    expect(dailyProduct('2026-10-06')).toBe('bond') // Tuesday
    expect(dailyProduct('2026-10-07')).toBe('gold') // Wednesday
  })
  it('explains every non-stock product with real numbers', () => {
    expect(productLesson(generateMarket(1, 'stock'))).toBeNull()
    for (const key of ['bond', 'gold', 'coin', 'lev2'] as const) {
      for (let s = 0; s < 20; s++) {
        const lesson = productLesson(generateMarket(s, key))
        expect(lesson?.title).toBeTruthy()
        expect(lesson?.line).toMatch(/%/)
      }
    }
  })
})

describe('iEyo', () => {
  it('picks the right ending', () => {
    expect(iEyo('채권')).toBe('채권이에요')
    expect(iEyo('금')).toBe('금이에요')
    expect(iEyo('코인')).toBe('코인이에요')
    expect(iEyo('레버리지 2배')).toBe('레버리지 2배예요')
    expect(iEyo('주식')).toBe('주식이에요')
  })
})
