import { describe, expect, it } from 'vitest'
import { nextKey } from './daily'
import { archiveSeason, DAILY_ROUND_TRADING_DAYS, seasonSummary } from './records'
import { CASH_RATE_ANNUAL } from './round'
import { accountAfter, accountBefore, SEASON_START, seasonLastDay } from './season'
import { createStore, memoryBackend, type SavedDaily } from './storage'

const entry = (yourReturn: number, buyHoldReturn: number, over: Partial<SavedDaily> = {}): SavedDaily => ({
  yourReturn,
  buyHoldReturn,
  held: [],
  trades: 1,
  title: 't',
  product: 'stock',
  ...over,
})

function fill(from: string, n: number, make: (i: number) => SavedDaily) {
  const out: Record<string, SavedDaily> = {}
  let k = from
  for (let i = 0; i < n; i++, k = nextKey(k)) out[k] = make(i)
  return out
}

describe('season boundaries', () => {
  it('reset the account on the first of the month', () => {
    const daily = { '2027-01-31': entry(0.1, 0), '2027-02-01': entry(0.1, 0) }
    expect(accountAfter(daily, '2027-01-31')).toBeCloseTo(SEASON_START * 1.1)
    expect(accountBefore(daily, '2027-02-01')).toBe(SEASON_START)
    expect(accountAfter(daily, '2027-02-01')).toBeCloseTo(SEASON_START * 1.1)
  })

  it('reset across the year', () => {
    const daily = { '2026-12-31': entry(-0.5, 0), '2027-01-01': entry(0, 0) }
    expect(accountBefore(daily, '2027-01-01')).toBe(SEASON_START)
    expect(seasonSummary(daily, '2027-01-01').days).toBe(1)
  })

  it('include a leap day in February', () => {
    expect(seasonLastDay('2028-02')).toBe('2028-02-29')
    expect(seasonLastDay('2027-02')).toBe('2027-02-28')
    expect(seasonLastDay('2026-12')).toBe('2026-12-31')
    const daily = { '2028-02-28': entry(0.1, 0), '2028-02-29': entry(0.1, 0), '2028-03-01': entry(0.1, 0) }
    expect(archiveSeason(daily, '2028-02').final).toBeCloseTo(SEASON_START * 1.21)
    expect(archiveSeason(daily, '2028-02').days).toBe(2)
    expect(accountBefore(daily, '2028-03-01')).toBe(SEASON_START)
  })
})

describe('season summary', () => {
  it('compares the account with the market and cash ghosts', () => {
    const daily = {
      '2026-10-01': entry(0.1, 0.05),
      '2026-10-02': entry(-0.02, 0.01),
      '2026-10-03': entry(0.03, -0.04, { abandoned: true, trades: 0 }),
      '2026-11-01': entry(0.5, 0.5),
    }
    const s = seasonSummary(daily, '2026-10-31')
    expect(s.label).toBe('10월 시즌')
    expect(s.account).toBeCloseTo(SEASON_START * 1.1 * 0.98 * 1.03)
    expect(s.accountReturn).toBeCloseTo(1.1 * 0.98 * 1.03 - 1)
    expect(s.market).toBeCloseTo(1.05 * 1.01 * 0.96 - 1)
    // The abandoned day moves the account and the ghosts, but is not a day played.
    expect(s.days).toBe(2)
    expect(s.entries).toBe(3)
    expect(s.beatDays).toBe(1)
    expect(s.cash).toBeCloseTo((1 + CASH_RATE_ANNUAL) ** ((3 * DAILY_ROUND_TRADING_DAYS) / 252) - 1)
    // Mid-season: only days so far.
    expect(seasonSummary(daily, '2026-10-01').days).toBe(1)
  })

  it('is flat for a season with no days', () => {
    const s = seasonSummary({}, '2026-10-15')
    expect(s).toMatchObject({ account: SEASON_START, accountReturn: 0, market: 0, cash: 0, entries: 0, days: 0, beatDays: 0 })
  })

  it('counts a month with only an abandoned day as started (qa3 P2-8)', () => {
    const s = seasonSummary({ '2026-10-05': entry(0.03, 0.01, { abandoned: true, trades: 0 }) }, '2026-10-15')
    expect(s).toMatchObject({ entries: 1, days: 0, beatDays: 0 })
    expect(s.account).toBeCloseTo(SEASON_START * 1.03)
    expect(s.market).toBeCloseTo(0.01)
  })
})

describe('season archive', () => {
  it('awards a medal for beating the market over 10+ days', () => {
    expect(archiveSeason(fill('2026-10-01', 10, () => entry(0.01, 0)), '2026-10').medal).toBe(true)
    expect(archiveSeason(fill('2026-10-01', 9, () => entry(0.01, 0)), '2026-10').medal).toBe(false)
    expect(archiveSeason(fill('2026-10-01', 12, () => entry(0.01, 0.02)), '2026-10').medal).toBe(false)
    // Abandoned days don't count toward the 10-day minimum.
    const nine = { ...fill('2026-10-01', 9, () => entry(0.01, 0)), '2026-10-20': entry(0.01, 0, { abandoned: true }) }
    expect(archiveSeason(nine, '2026-10').medal).toBe(false)
  })

  it('closes past months once and never recomputes them', () => {
    const store = createStore(memoryBackend())
    for (const [k, d] of Object.entries(fill('2026-10-20', 15, () => entry(0.01, 0)))) store.recordDaily(k, d)
    store.recordDaily('2026-12-01', entry(0.2, 0))
    expect(store.closeSeasons('2026-10-31')).toEqual([])
    expect(store.closeSeasons('2026-12-02')).toEqual(['2026-10', '2026-11'])
    const first = store.pastSeasons()
    expect(first.map((s) => s.season)).toEqual(['2026-10', '2026-11'])
    expect(first[0]).toMatchObject({ days: 12, beatDays: 12, medal: true })
    expect(first[1]).toMatchObject({ days: 3, medal: false })

    // A late entry (clock games) doesn't change a closed season.
    store.recordDaily('2026-10-01', entry(-0.9, 0))
    expect(store.closeSeasons('2026-12-03')).toEqual([])
    expect(store.pastSeasons()).toEqual(first)
    // The clock moving back doesn't close the current month.
    expect(store.closeSeasons('2026-09-01')).toEqual([])
    expect(store.pastSeasons()).toHaveLength(2)
  })
})

describe('records', () => {
  it('lists every daily oldest first', () => {
    const store = createStore(memoryBackend())
    store.recordDaily('2026-10-02', entry(0.1, 0.2, { title: 'b' }))
    store.recordDaily('2026-10-01', entry(0.3, 0.1, { title: 'a', product: undefined }))
    store.startDaily('2026-10-03', 0.05)
    expect(store.dailyHistory()).toEqual([
      { key: '2026-10-01', yourReturn: 0.3, buyHoldReturn: 0.1, product: null, abandoned: false, title: 'a' },
      { key: '2026-10-02', yourReturn: 0.1, buyHoldReturn: 0.2, product: 'stock', abandoned: false, title: 'b' },
      { key: '2026-10-03', yourReturn: 0, buyHoldReturn: 0.05, product: null, abandoned: true, title: '중간에 나갔어요' },
    ])
  })
})
