import { describe, expect, it } from 'vitest'
import { nextKey } from './daily'
import { createStore, memoryBackend, type SavedDaily } from './storage'
import { FREEZE_CAP, freezesToApply, streakDays, tokensAt, weekStart, weekStrip } from './streak'

/** `n` consecutive keys starting at `from`. */
function days(from: string, n: number): string[] {
  const out: string[] = []
  for (let k = from; out.length < n; k = nextKey(k)) out.push(k)
  return out
}

const set = (...keys: string[]) => new Set(keys)

const entry: SavedDaily = { yourReturn: 0.01, buyHoldReturn: 0, held: [], trades: 1, title: '' }

/** A store with finished dailies on `keys`. */
function storeWith(keys: string[]) {
  const store = createStore(memoryBackend())
  for (const k of keys) store.recordDaily(k, entry)
  return store
}

describe('streak', () => {
  it('runs across month and year boundaries', () => {
    const played = set('2026-12-30', '2026-12-31', '2027-01-01')
    expect(streakDays(played, set(), '2027-01-01')).toBe(3)
    expect(streakDays(played, set(), '2027-01-02')).toBe(3)
    expect(streakDays(played, set(), '2027-01-03')).toBe(0)
    const store = storeWith(['2026-10-30', '2026-10-31', '2026-11-01'])
    expect(store.streak('2026-11-01')).toBe(3)
  })

  it('ignores abandoned days', () => {
    const store = storeWith(['2026-10-01', '2026-10-02'])
    store.startDaily('2026-10-03', 0)
    expect(store.streak('2026-10-03')).toBe(2)
    expect(store.streak('2026-10-04')).toBe(0)
    expect(store.streakState('2026-10-03').week.find((d) => d.key === '2026-10-03')?.state).toBe('today')
  })

  it('counts through frozen days without adding them', () => {
    const played = set('2026-10-01', '2026-10-02', '2026-10-04')
    expect(streakDays(played, set('2026-10-03'), '2026-10-04')).toBe(3)
    expect(streakDays(played, set(), '2026-10-04')).toBe(1)
  })
})

describe('streak freezes', () => {
  it('earn one token per 7 played days, holding at most 2', () => {
    expect(tokensAt(set(...days('2026-10-01', 6)), set(), '2026-10-06')).toBe(0)
    expect(tokensAt(set(...days('2026-10-01', 7)), set(), '2026-10-07')).toBe(1)
    expect(tokensAt(set(...days('2026-10-01', 14)), set(), '2026-10-14')).toBe(2)
    expect(tokensAt(set(...days('2026-10-01', 30)), set(), '2026-10-30')).toBe(FREEZE_CAP)
  })

  it('only count unbroken runs of real play days', () => {
    // 4 days, a miss, 4 days: no run of 7.
    const played = set(...days('2026-10-01', 4), ...days('2026-10-06', 4))
    expect(tokensAt(played, set(), '2026-10-09')).toBe(0)
    // Abandoned days don't count either.
    const store = storeWith(days('2026-10-01', 6))
    store.startDaily('2026-10-07', 0)
    expect(store.streakState('2026-10-07').tokens).toBe(0)
  })

  it('cover a missed day and keep the streak', () => {
    const store = storeWith(days('2026-10-01', 7))
    expect(store.streakState('2026-10-07').tokens).toBe(1)
    const before = store.accountAfter('2026-10-09')
    expect(store.streak('2026-10-09')).toBe(0)
    expect(store.applyStreakFreezes('2026-10-09')).toEqual(['2026-10-08'])
    expect(store.applyStreakFreezes('2026-10-09')).toEqual([])
    expect(store.streak('2026-10-09')).toBe(7)
    const state = store.streakState('2026-10-09')
    expect(state.tokens).toBe(0)
    expect(state.frozen).toEqual(['2026-10-08'])
    // Frozen days never touch the season account.
    expect(store.accountAfter('2026-10-09')).toBe(before)
  })

  it('are spent newest first', () => {
    const played = set(...days('2026-10-01', 14))
    expect(freezesToApply(played, set(), '2026-10-17')).toEqual(['2026-10-16', '2026-10-15'])
  })

  it('reset the streak when the gap is larger than the tokens, keeping them', () => {
    const played = set(...days('2026-10-01', 14))
    expect(freezesToApply(played, set(), '2026-10-18')).toEqual([])
    const store = storeWith(days('2026-10-01', 7))
    expect(store.applyStreakFreezes('2026-10-10')).toEqual([])
    expect(store.streak('2026-10-10')).toBe(0)
    expect(store.streakState('2026-10-10').tokens).toBe(1)
  })

  it("can't use a token earned after the missed day", () => {
    // 6 days, miss, then the 7th play today: today's token can't cover yesterday.
    const played = set(...days('2026-10-01', 6), '2026-10-08')
    expect(freezesToApply(played, set(), '2026-10-08')).toEqual([])
  })

  it('cover a missed day even if today was already played', () => {
    const played = set(...days('2026-10-01', 7), '2026-10-09')
    expect(freezesToApply(played, set(), '2026-10-09')).toEqual(['2026-10-08'])
  })

  it('chain over several app opens and spend the tokens', () => {
    const store = storeWith(days('2026-10-01', 14))
    expect(store.applyStreakFreezes('2026-10-16')).toEqual(['2026-10-15'])
    expect(store.applyStreakFreezes('2026-10-17')).toEqual(['2026-10-16'])
    expect(store.streak('2026-10-17')).toBe(14)
    expect(store.applyStreakFreezes('2026-10-18')).toEqual([])
    expect(store.streak('2026-10-18')).toBe(0)
  })

  it('ignore days after today when the clock moved back', () => {
    const played = set(...days('2026-10-01', 7), '2026-10-20')
    expect(freezesToApply(played, set(), '2026-10-09')).toEqual(['2026-10-08'])
    expect(tokensAt(played, set(), '2026-10-09')).toBe(1)
    const store = storeWith([...days('2026-10-01', 7), '2026-10-20'])
    expect(store.applyStreakFreezes('2026-10-09')).toEqual(['2026-10-08'])
    expect(store.streak('2026-10-09')).toBe(7)
  })

  it('work across a year boundary', () => {
    const store = storeWith(days('2026-12-25', 7))
    expect(store.applyStreakFreezes('2027-01-02')).toEqual(['2027-01-01'])
    expect(store.streak('2027-01-02')).toBe(7)
  })
})

describe('week strip', () => {
  it('runs Monday to Sunday', () => {
    expect(weekStart('2026-10-07')).toBe('2026-10-05') // Wednesday
    expect(weekStart('2026-10-05')).toBe('2026-10-05') // Monday
    expect(weekStart('2026-10-11')).toBe('2026-10-05') // Sunday
    expect(weekStart('2027-01-01')).toBe('2026-12-28') // across a year
  })

  it('labels each day', () => {
    const week = weekStrip(set('2026-10-05'), set('2026-10-06'), '2026-10-08')
    expect(week.map((d) => d.state)).toEqual(['played', 'frozen', 'missed', 'today', 'future', 'future', 'future'])
    expect(weekStrip(set('2026-10-08'), set(), '2026-10-08')[3].state).toBe('played')
  })
})
