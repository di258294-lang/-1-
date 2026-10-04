import { beforeEach, describe, expect, it } from 'vitest'
import { generateMarket, type Market } from './market'
import { advanceTo, createRound, setHolding } from './round'
import { coachingFor, completeRound, roundKind, roundPolicy } from './session'
import { createStore, configureStorage, memoryBackend, save } from './storage'

/** Holds one long stretch: passes the starter mission (hold a quarter of the round). */
function longHold(market: Market) {
  const r = createRound(market)
  advanceTo(r, 20)
  setHolding(r, true)
  advanceTo(r, 20 + Math.floor(market.playTicks * 0.6))
  setHolding(r, false)
  return r
}

/** Taps a few times briefly: judged, but fails the starter mission. */
function shortTaps(market: Market) {
  const r = createRound(market)
  for (let i = 0; i < 3; i++) {
    advanceTo(r, 30 + i * 120)
    setHolding(r, true)
    advanceTo(r, 30 + i * 120 + 40)
    setHolding(r, false)
  }
  return r
}

const practice = { kind: 'practice' } as const

describe('completeRound coaching', () => {
  beforeEach(() => configureStorage(memoryBackend()))

  it('assigns a mission after the first round, then judges the next ones', () => {
    const m1 = generateMarket(1)
    const first = completeRound(practice, m1, longHold(m1))
    expect(first.mission).toMatchObject({ id: 'longHold', outcome: 'new' })
    expect(coachingFor(first.result)).toEqual({ mission: first.mission, lesson: first.lesson })

    const m2 = generateMarket(2)
    const second = completeRound(practice, m2, longHold(m2))
    expect(second.mission).toMatchObject({ id: 'longHold', outcome: 'pass' })
    // Never a lesson on top of a mission success.
    expect(second.lesson).toBeNull()

    const m3 = generateMarket(3)
    const third = completeRound(practice, m3, shortTaps(m3))
    expect(third.mission?.outcome).toBe('fail')

    const m4 = generateMarket(4)
    const fourth = completeRound(practice, m4, longHold(m4))
    expect(fourth.mission).toMatchObject({ outcome: 'pass', completed: true })
    expect(save.coach().done.map((d) => d.id)).toEqual(['longHold'])
    expect(save.coach().active?.id).not.toBe('longHold')
  })

  it('counts long rounds too', () => {
    const m = generateMarket(5, 'stock', 'long')
    completeRound(practice, m, longHold(m))
    const m2 = generateMarket(6, 'stock', 'long')
    expect(completeRound(practice, m2, longHold(m2)).mission?.outcome).toBe('pass')
  })

  it('shows each lesson at most once', () => {
    const shown: string[] = []
    for (let s = 0; s < 12; s++) {
      const m = generateMarket(100 + s, s % 2 ? 'coin' : 'bond')
      const out = completeRound(practice, m, shortTaps(m))
      if (out.lesson) shown.push(out.lesson.id)
    }
    expect(shown.length).toBeGreaterThan(0)
    expect(new Set(shown).size).toBe(shown.length)
    expect(save.coach().lessons).toEqual(shown)
  })

  it('leaves no trace for a replay of a past daily, and does not use up its lesson', () => {
    const before = save.practice()
    let shown = 0
    for (let s = 0; s < 6; s++) {
      const m = generateMarket(200 + s, s % 2 ? 'coin' : 'bond')
      const out = completeRound({ kind: 'practice', replayOf: '2026-10-01' }, m, shortTaps(m))
      expect(out.record).toBeNull()
      expect(out.mission).toBeNull()
      expect(out.unlocked).toEqual([])
      if (out.lesson) shown++
    }
    expect(shown).toBeGreaterThan(0)
    expect(save.practice()).toEqual(before)
    expect(save.habitRecords()).toHaveLength(0)
    expect(save.coach()).toEqual({ active: null, done: [], lessons: [] })
  })

  it('records nothing for the tutorial, and ends the intro', () => {
    const m = generateMarket(8)
    const out = completeRound(practice, m, longHold(m), { kind: 'tutorial' })
    expect(out.mission).toBeNull()
    expect(out.lesson).toBeNull()
    expect(out.record).toBeNull()
    expect(save.seenIntro()).toBe(true)
    expect(save.practice().rounds).toBe(0)
    expect(save.habitRecords()).toHaveLength(0)
    expect(save.coach().active).toBeNull()
  })

  it("records nothing at all for a friend's challenge", () => {
    const m = generateMarket(9)
    const out = completeRound(practice, m, longHold(m), { kind: 'challenge' })
    expect(out).toMatchObject({ record: null, mission: null, lesson: null, unlocked: [] })
    expect(out.habits.trades).toBeGreaterThan(0)
    expect(save.practice().rounds).toBe(0)
    expect(save.seenIntro()).toBe(false)
    expect(save.coach()).toEqual({ active: null, done: [], lessons: [] })
  })

  it('counts a no-trade practice round but keeps no habit record', () => {
    const m = generateMarket(10)
    const out = completeRound(practice, m, createRound(m))
    expect(out.record).toBeNull()
    expect(save.practice()).toMatchObject({ rounds: 1, traded: 0 })
    expect(save.habitRecords()).toHaveLength(0)
  })

  it('dates practice records with the clock it is given', () => {
    const m = generateMarket(11)
    const now = Date.parse('2026-10-11T15:30:00Z') // Monday 00:30 KST
    const out = completeRound(practice, m, longHold(m), { now })
    expect(out.record).toMatchObject({ id: `p:${now}`, at: '2026-10-12' })
  })

  it('writes the whole round once', () => {
    const writes: string[] = []
    configureStorage(memoryBackend(null, (s) => void writes.push(s)))
    const m = generateMarket(12)
    completeRound(practice, m, longHold(m))
    expect(writes).toHaveLength(1)
    const file = JSON.parse(writes[0])
    expect(file.practice.rounds).toBe(1)
    expect(file.habits).toHaveLength(1)
    expect(file.coach.active).not.toBeNull()
  })
})

describe('completeRound for the daily', () => {
  beforeEach(() => configureStorage(memoryBackend()))
  const daily = { kind: 'daily', key: '2026-10-07', day: 7 } as const

  it('records the day, a d: habit record dated by the day, and coaches', () => {
    const m = generateMarket(13)
    expect(save.startDaily(daily.key, 0.01)).toBe(true)
    // Finished after midnight: still that day's record.
    const out = completeRound(daily, m, longHold(m), { now: Date.parse('2026-10-08T01:00:00Z') })
    expect(save.daily(daily.key)).toMatchObject({ yourReturn: out.result.yourReturn, product: m.product })
    expect(save.daily(daily.key)?.abandoned).toBeUndefined()
    expect(out.record).toMatchObject({ id: `d:${daily.key}`, at: daily.key })
    expect(out.mission).toMatchObject({ outcome: 'new' })
    expect(save.practice().rounds).toBe(0)
  })

  it('leaves nothing else behind when the day was already recorded elsewhere', () => {
    const backend = memoryBackend()
    configureStorage(backend)
    const other = createStore(backend)
    expect(other.startDaily(daily.key, 0.01)).toBe(true)
    const m = generateMarket(14)
    const out = completeRound(daily, m, longHold(m))
    expect(out).toMatchObject({ record: null, mission: null, lesson: null })
    expect(save.daily(daily.key)?.abandoned).toBe(true)
    expect(save.habitRecords()).toHaveLength(0)
    expect(save.coach().active).toBeNull()
  })
})

describe('round policy', () => {
  it('derives the kind and decides each one in one place', () => {
    expect(roundKind({ kind: 'daily', key: '2026-10-07', day: 7 }, { tutorial: true })).toBe('daily')
    expect(roundKind({ kind: 'practice' }, { tutorial: true })).toBe('tutorial')
    expect(roundKind({ kind: 'practice' }, { challenge: true })).toBe('challenge')
    expect(roundKind({ kind: 'practice', replayOf: '2026-10-01' })).toBe('replay')
    expect(roundKind({ kind: 'practice' })).toBe('practice')
    expect(roundPolicy('replay')).toMatchObject({ record: false, coach: false, markLesson: false })
    expect(roundPolicy('tutorial')).toMatchObject({ record: false, lesson: false, finishesIntro: true })
    expect(roundPolicy('challenge')).toEqual({ record: false, coach: false, lesson: false, markLesson: false, finishesIntro: false })
  })
})
