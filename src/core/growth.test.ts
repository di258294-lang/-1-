import { describe, expect, it } from 'vitest'
import { nextKey } from './daily'
import {
  bestStreak,
  calendarState,
  canReplay,
  daysToNextFreeze,
  monthGrid,
  previousSeason,
  unseenSeason,
  weekSummary,
  winRate,
} from './growth'

function days(from: string, n: number): string[] {
  const out: string[] = []
  for (let k = from; out.length < n; k = nextKey(k)) out.push(k)
  return out
}

const day = (key: string, yourReturn: number, buyHoldReturn: number, abandoned = false) => ({
  key,
  yourReturn,
  buyHoldReturn,
  abandoned,
})

describe('monthGrid', () => {
  it('starts weeks on Monday and pads with null', () => {
    // 2026-10-01 is a Thursday.
    const g = monthGrid('2026-10')
    expect(g[0]).toEqual([null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])
    expect(g.every((w) => w.length === 7)).toBe(true)
    expect(g.flat().filter(Boolean)).toHaveLength(31)
    expect(g[g.length - 1]).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', null])
  })

  it('handles a month starting on Monday and leap February', () => {
    // 2027-02-01 is a Monday.
    expect(monthGrid('2027-02')[0][0]).toBe('2027-02-01')
    expect(monthGrid('2028-02').flat().filter(Boolean)).toHaveLength(29)
  })

  it('steps back a month across the year', () => {
    expect(previousSeason('2027-01')).toBe('2026-12')
    expect(previousSeason('2026-11')).toBe('2026-10')
  })
})

describe('bestStreak', () => {
  it('finds the longest run, with frozen days bridging but not adding', () => {
    const played = [...days('2026-10-01', 3), ...days('2026-10-05', 4), ...days('2026-10-20', 2)]
    expect(bestStreak(played, [], '2026-10-30')).toBe(4)
    // Freezing 10-04 joins 3 + 4.
    expect(bestStreak(played, ['2026-10-04'], '2026-10-30')).toBe(7)
    expect(bestStreak([], [], '2026-10-30')).toBe(0)
  })

  it('ignores days after today', () => {
    expect(bestStreak(days('2026-10-01', 10), [], '2026-10-03')).toBe(3)
  })
})

describe('daysToNextFreeze', () => {
  it('counts down from seven played days since the last miss', () => {
    expect(daysToNextFreeze([], [], '2026-10-10', 0)).toBe(7)
    // Three days played up to yesterday; today not played yet.
    expect(daysToNextFreeze(days('2026-10-07', 3), [], '2026-10-10', 0)).toBe(4)
    // Today played counts.
    expect(daysToNextFreeze(days('2026-10-07', 4), [], '2026-10-10', 0)).toBe(3)
    // Seven played: a token was just earned, the next is seven away.
    expect(daysToNextFreeze(days('2026-10-04', 7), [], '2026-10-10', 1)).toBe(7)
  })

  it('restarts after a missed day but not after a frozen one', () => {
    const played = [...days('2026-10-01', 5), ...days('2026-10-07', 2)]
    expect(daysToNextFreeze(played, [], '2026-10-09', 0)).toBe(5)
    // Bridged: 5 + 2 = 7 played, so a token was just earned.
    expect(daysToNextFreeze(played, ['2026-10-06'], '2026-10-09', 0)).toBe(7)
    expect(daysToNextFreeze([...played, '2026-10-09'], ['2026-10-06'], '2026-10-09', 0)).toBe(6)
  })

  it('is null at the cap', () => {
    expect(daysToNextFreeze(days('2026-10-01', 20), [], '2026-10-21', 2)).toBeNull()
  })
})

describe('win rate and week', () => {
  const history = [
    day('2026-10-01', 0.02, 0.01),
    day('2026-10-02', -0.01, 0.01),
    day('2026-10-03', 0.05, 0, true),
    day('2026-10-05', 0.01, 0.01), // a tie is not a win
    day('2026-10-06', 0.03, -0.02),
  ]

  it('skips abandoned rounds', () => {
    expect(winRate(history)).toEqual({ played: 4, beat: 2 })
    expect(winRate([])).toEqual({ played: 0, beat: 0 })
  })

  it('counts Monday to today', () => {
    // 2026-10-05 is a Monday.
    expect(weekSummary(history, '2026-10-07')).toEqual({ played: 2, beat: 1 })
    expect(weekSummary(history, '2026-10-04')).toEqual({ played: 2, beat: 1 })
  })
})

describe('calendarState', () => {
  const today = '2026-10-10'
  const frozen = new Set(['2026-10-04'])
  it('labels every kind of day', () => {
    expect(calendarState('2026-10-02', today, day('2026-10-02', 0.1, 0), frozen)).toBe('beat')
    expect(calendarState('2026-10-02', today, day('2026-10-02', 0, 0.1), frozen)).toBe('behind')
    expect(calendarState('2026-10-02', today, day('2026-10-02', 0.1, 0, true), frozen)).toBe('abandoned')
    expect(calendarState('2026-10-04', today, undefined, frozen)).toBe('frozen')
    expect(calendarState('2026-10-04', today, day('2026-10-04', 0.1, 0, true), frozen)).toBe('frozen')
    expect(calendarState('2026-10-05', today, undefined, frozen)).toBe('missed')
    expect(calendarState('2026-09-30', today, undefined, frozen)).toBe('before')
    expect(calendarState(today, today, undefined, frozen)).toBe('today')
    expect(calendarState(today, today, day(today, 0.1, 0), frozen)).toBe('beat')
    expect(calendarState('2026-10-11', today, undefined, frozen)).toBe('future')
  })
})

describe('canReplay', () => {
  it('allows day #1 up to yesterday only', () => {
    expect(canReplay('2026-10-01', '2026-10-04')).toBe(true)
    expect(canReplay('2026-10-03', '2026-10-04')).toBe(true)
    expect(canReplay('2026-10-04', '2026-10-04')).toBe(false)
    expect(canReplay('2026-10-05', '2026-10-04')).toBe(false)
    expect(canReplay('2026-09-30', '2026-10-04')).toBe(false)
  })
})

describe('unseenSeason', () => {
  const past = [{ season: '2026-10' }, { season: '2026-11' }]
  it('returns the newest season not dismissed', () => {
    expect(unseenSeason(past, [])?.season).toBe('2026-11')
    expect(unseenSeason(past, ['2026-11'])?.season).toBe('2026-10')
    expect(unseenSeason(past, ['2026-10', '2026-11'])).toBeNull()
    expect(unseenSeason([], [])).toBeNull()
  })
})
