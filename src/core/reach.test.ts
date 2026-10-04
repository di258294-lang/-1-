import { describe, expect, it } from 'vitest'
import { dateKey } from './daily'
import {
  leaderboardScore,
  REMINDER_BODY,
  REMINDER_DAYS,
  REMINDER_PRESETS,
  reminderTimes,
  REVIEW_COOLDOWN_DAYS,
  reviewEligible,
  type ReviewInput,
} from './reach'
import { parseSave } from './storage'
import { DEFAULT_SETTINGS } from './types'

describe('leaderboardScore', () => {
  it('is the edge over buy-and-hold in basis points', () => {
    expect(leaderboardScore(0.0521, 0.02)).toBe(321)
    expect(leaderboardScore(-0.01, 0.0)).toBe(-100)
    expect(leaderboardScore(-0.02, -0.05)).toBe(300)
    expect(leaderboardScore(0.1, 0.1)).toBe(0)
  })

  it('rounds to a whole number', () => {
    expect(leaderboardScore(0.012345, 0)).toBe(123)
    expect(leaderboardScore(0.012355, 0)).toBe(124)
    expect(Number.isInteger(leaderboardScore(0.3333333, 0.1111111))).toBe(true)
  })

  it('never yields -0 or a non-number', () => {
    expect(Object.is(leaderboardScore(-0.000001, 0), 0)).toBe(true)
    expect(String(leaderboardScore(-0.00004, 0))).toBe('0')
    expect(leaderboardScore(Number.NaN, 0)).toBeNull()
    expect(leaderboardScore(Infinity, 0)).toBeNull()
  })
})

describe('reminderTimes', () => {
  const never = () => false
  const at = (y: number, m: number, d: number, hh: number, mm = 0) => new Date(y, m - 1, d, hh, mm).getTime()

  it('is one notification a day at the hour, starting today when it is still ahead', () => {
    const times = reminderTimes(at(2026, 10, 4, 7, 30), 8, never)
    expect(times).toHaveLength(REMINDER_DAYS)
    expect(times[0]).toEqual(new Date(2026, 9, 4, 8, 0))
    expect(times[1]).toEqual(new Date(2026, 9, 5, 8, 0))
    for (const t of times) expect([t.getHours(), t.getMinutes(), t.getSeconds()]).toEqual([8, 0, 0])
  })

  it('starts tomorrow once today’s time has passed (or is under a minute away)', () => {
    expect(reminderTimes(at(2026, 10, 4, 9), 8, never)[0]).toEqual(new Date(2026, 9, 5, 8, 0))
    expect(reminderTimes(at(2026, 10, 4, 7, 59) + 30_000, 8, never)[0]).toEqual(new Date(2026, 9, 5, 8, 0))
    expect(reminderTimes(at(2026, 10, 4, 9), 8, never)).toHaveLength(REMINDER_DAYS - 1)
  })

  it('skips the days whose chart was already played (by the KST key at fire time)', () => {
    const now = at(2026, 10, 4, 6)
    const first = reminderTimes(now, 20, never)[0]
    const played = new Set([dateKey(first.getTime())])
    const times = reminderTimes(now, 20, (k) => played.has(k))
    expect(times.map((t) => t.getTime())).not.toContain(first.getTime())
    expect(times).toHaveLength(REMINDER_DAYS - 1)
    expect(times.every((t) => !played.has(dateKey(t.getTime())))).toBe(true)
  })

  it('crosses month and year ends on the calendar', () => {
    const times = reminderTimes(at(2026, 12, 30, 21), 12, never, 4)
    expect(times).toEqual([new Date(2026, 11, 31, 12), new Date(2027, 0, 1, 12), new Date(2027, 0, 2, 12)])
  })

  it('offers three preset times and a functional, guilt-free line', () => {
    expect(REMINDER_PRESETS.map((p) => p.hour)).toEqual([8, 12, 20])
    expect(REMINDER_PRESETS.map((p) => p.label)).toEqual(['오전 8시', '낮 12시', '저녁 8시'])
    expect(REMINDER_BODY).toBe('오늘의 차트가 열렸어요 · 40초면 돼요')
    expect(REMINDER_BODY).not.toMatch(/연속|끊|놓치|잃/)
  })
})

describe('reviewEligible', () => {
  const base: ReviewInput = { completedDailies: 3, yourReturn: 0.03, buyHoldReturn: 0.01, lastAsked: '', today: '2026-10-04' }

  it('asks after the 3rd completed daily that beat buy-and-hold', () => {
    expect(reviewEligible(base)).toBe(true)
    expect(reviewEligible({ ...base, completedDailies: 2 })).toBe(false)
    expect(reviewEligible({ ...base, completedDailies: 7 })).toBe(true)
  })

  it('never after a loss', () => {
    // Trailed the market.
    expect(reviewEligible({ ...base, yourReturn: 0.005 })).toBe(false)
    // Tied it.
    expect(reviewEligible({ ...base, yourReturn: 0.01 })).toBe(false)
    // Beat a falling market but still lost money.
    expect(reviewEligible({ ...base, yourReturn: -0.01, buyHoldReturn: -0.04 })).toBe(false)
    // Stayed out of a falling market: no loss, ahead of it.
    expect(reviewEligible({ ...base, yourReturn: 0, buyHoldReturn: -0.04 })).toBe(true)
  })

  it('at most once every 90 days', () => {
    expect(reviewEligible({ ...base, lastAsked: '2026-10-04' })).toBe(false)
    expect(reviewEligible({ ...base, lastAsked: '2026-07-07' })).toBe(false) // 89 days
    expect(REVIEW_COOLDOWN_DAYS).toBe(90)
    expect(reviewEligible({ ...base, lastAsked: '2026-07-06' })).toBe(true) // 90 days
    // A clock set back never re-asks.
    expect(reviewEligible({ ...base, lastAsked: '2026-12-01' })).toBe(false)
  })
})

describe('reach settings in the save', () => {
  it('default to reminder off, noon, never asked', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ reminder: false, reminderHour: 12, reviewAsked: '' })
    expect(parseSave(JSON.stringify({ v: 2, settings: { sound: false } })).file.settings).toEqual({ ...DEFAULT_SETTINGS, sound: false })
  })

  it('keep good values and drop bad ones', () => {
    const good = parseSave(JSON.stringify({ v: 2, settings: { reminder: true, reminderHour: 20, reviewAsked: '2026-10-04' } }))
    expect(good.file.settings).toMatchObject({ reminder: true, reminderHour: 20, reviewAsked: '2026-10-04' })
    const bad = parseSave(JSON.stringify({ v: 2, settings: { reminder: 'yes', reminderHour: 24.5, reviewAsked: 'soon' } }))
    expect(bad.file.settings).toMatchObject({ reminder: false, reminderHour: 12, reviewAsked: '' })
    expect(bad.issues).toEqual(expect.arrayContaining(['settings.reminder', 'settings.reminderHour', 'settings.reviewAsked']))
  })
})
