import { describe, expect, it } from 'vitest'
import { keyForDay as challengeKeyForDay } from './challenge'
import { dayNumber, daysBetween, EPOCH_KEY, keyForDay, nextKey, previousKey, weekIndex, weekStart } from './daily'
import { daysBetween as missionDaysBetween, weekOf } from './missions'

describe('calendar math', () => {
  it('counts days across months, years and leap days', () => {
    expect(daysBetween('2026-10-01', '2026-10-01')).toBe(0)
    expect(daysBetween('2026-10-01', '2026-10-08')).toBe(7)
    expect(daysBetween('2026-10-08', '2026-10-01')).toBe(-7)
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2)
  })

  it('starts weeks on Monday', () => {
    expect(weekStart('2026-10-05')).toBe('2026-10-05') // Monday
    expect(weekStart('2026-10-07')).toBe('2026-10-05') // Wednesday
    expect(weekStart('2026-10-11')).toBe('2026-10-05') // Sunday
    expect(weekStart('2027-01-01')).toBe('2026-12-28') // across a year
    expect(weekIndex('2026-10-12') - weekIndex('2026-10-11')).toBe(1)
    expect(weekIndex('2026-10-05')).toBe(weekIndex('2026-10-11'))
  })

  it('maps chart numbers to days and back', () => {
    expect(keyForDay(1)).toBe(EPOCH_KEY)
    expect(keyForDay(32)).toBe('2026-11-01')
    for (const day of [1, 2, 31, 365, 366, 1000, 65534]) expect(dayNumber(keyForDay(day))).toBe(day)
  })

  it('agrees with the copies it replaces, day by day for two years', () => {
    let prev = '2026-09-01'
    for (let k = '2026-09-01'; k < '2028-09-01'; k = nextKey(k)) {
      expect(previousKey(nextKey(k))).toBe(k)
      expect(daysBetween(prev, k)).toBe(missionDaysBetween(prev, k))
      expect(weekIndex(k)).toBe(weekOf(k))
      expect(daysBetween(weekStart(k), k)).toBeLessThan(7)
      expect(new Date(`${weekStart(k)}T00:00:00Z`).getUTCDay()).toBe(1)
      prev = k
    }
    for (let day = 1; day < 800; day++) expect(keyForDay(day)).toBe(challengeKeyForDay(day))
  })
})
