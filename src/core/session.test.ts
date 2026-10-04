import { beforeEach, describe, expect, it } from 'vitest'
import { generateMarket, type Market } from './market'
import { advanceTo, createRound, setHolding } from './round'
import { coachingFor, completeRound } from './session'
import { configureStorage, memoryBackend, save } from './storage'

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

  it('leaves no trace for a replay of a past daily', () => {
    const m = generateMarket(7)
    const before = save.practice()
    const out = completeRound({ kind: 'practice', replayOf: '2026-10-01' }, m, longHold(m))
    expect(out.record).toBeNull()
    expect(out.mission).toBeNull()
    expect(out.unlocked).toEqual([])
    expect(save.practice()).toEqual(before)
    expect(save.habitRecords()).toHaveLength(0)
    expect(save.coach().active).toBeNull()
  })

  it('skips missions and lessons for the tutorial', () => {
    const m = generateMarket(8)
    const out = completeRound(practice, m, longHold(m), { coach: false })
    expect(out.mission).toBeNull()
    expect(out.lesson).toBeNull()
    expect(save.coach().active).toBeNull()
  })
})
