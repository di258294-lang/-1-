import { describe, expect, it, vi } from 'vitest'
import type { HabitRecord } from './habits'
import { SEASON_START } from './season'
import {
  createStore,
  hydrate,
  memoryBackend,
  parseSave,
  save,
  SAVE_VERSION,
  type SavedDaily,
  type StorageBackend,
} from './storage'

/** A fresh store over an in-memory backend that records writes and backups. */
function setup(raw: string | null = null) {
  const writes: string[] = []
  const backups: string[] = []
  const backend = memoryBackend(raw, (s) => void writes.push(s), (r) => void backups.push(r))
  return { backend, writes, backups, store: createStore(backend) }
}

const stored = (b: { peek(): string | null }) => JSON.parse(b.peek()!)

function finished(over: Partial<SavedDaily> = {}): SavedDaily {
  return { yourReturn: 0.05, buyHoldReturn: 0.02, held: [false, true, true, false], trades: 1, title: '감이 좋아요', product: 'stock', ...over }
}

function record(id: string): HabitRecord {
  return {
    id,
    at: '2026-10-01',
    product: 'stock',
    length: 'short',
    trades: 2,
    heldRatio: 0.4,
    scores: { holder: 0.1, chicken: 0.2, scalper: 0.3, chaser: 0, rumor: 0 },
    measurable: { holder: true, chicken: true, scalper: true, chaser: true, rumor: false },
    counts: { sellUp: 1, expUp: 2, sellDown: 0, expDown: 1 },
    luckPct: null,
  }
}

const V1_FIXTURE = {
  v: 1,
  daily: {
    '2026-10-01': { yourReturn: 0.1, buyHoldReturn: 0.05, held: [false, true, true, false], trades: 1, title: '감이 좋아요', product: 'stock' },
    // Idle finished daily: v1 counted it toward unlocks.
    '2026-10-02': { yourReturn: 0.001, buyHoldReturn: -0.02, held: [false, false], trades: 0, title: '현금이 정답이었어요', product: 'lev2' },
    '2026-10-03': { yourReturn: -0.03, buyHoldReturn: 0.01, held: [], trades: 0, title: '중간에 나갔어요', abandoned: true },
  },
  practice: { rounds: 3, best: 0.2 },
  seenIntro: true,
  habits: [
    // Saved before full records existed.
    { id: 'p:1', scores: { holder: 0.5, chicken: 0.1, scalper: 0, chaser: 0, rumor: 0 } },
    { ...record('d:2026-10-01'), extra: 'kept' },
  ],
}

describe('migration v1 → v2', () => {
  it('keeps every field and the unlock progress of an existing player', () => {
    const { store, backend, backups } = setup(JSON.stringify(V1_FIXTURE))
    expect(store.daily('2026-10-01')?.held).toEqual([false, true, true, false])
    expect(store.daily('2026-10-03')?.abandoned).toBe(true)
    expect(store.seenIntro()).toBe(true)
    expect(store.practice()).toEqual({ rounds: 3, traded: 3, best: 0.2 })
    // v1: 3 practice + 2 finished dailies. v2 counts the same for old data.
    expect(store.roundsPlayed()).toBe(5)
    expect(store.getSettings()).toEqual({ sound: true, haptics: true, tapToggle: false })

    const [legacy, full] = store.habitRecords()
    expect(legacy.at).toBe('')
    expect(legacy.measurable.chaser).toBe(true)
    expect(legacy.counts).toEqual({ sellUp: 0, expUp: 0, sellDown: 0, expDown: 0 })
    expect(legacy.scores.holder).toBe(0.5)
    expect((full as HabitRecord & { extra?: string }).extra).toBe('kept')

    // Loading writes nothing; the first change writes v2 with compact held.
    expect(backend.peek()).toBe(JSON.stringify(V1_FIXTURE))
    store.recordPractice(0.01, 1)
    const file = stored(backend)
    expect(file.v).toBe(SAVE_VERSION)
    expect(file.daily['2026-10-01'].held).toBe('1.2.1')
    expect(backups).toEqual([JSON.stringify(V1_FIXTURE)])
    expect(store.roundsPlayed()).toBe(6)
  })

  it('fills missing fields of a minimal v1 save', () => {
    const { store } = setup(JSON.stringify({ v: 1, daily: { '2026-10-01': { yourReturn: 0.02, buyHoldReturn: 0.01 } } }))
    expect(store.daily('2026-10-01')).toEqual({ yourReturn: 0.02, buyHoldReturn: 0.01, held: [], trades: 0, title: '' })
    expect(store.practice()).toEqual({ rounds: 0, traded: 0, best: null })
    expect(store.habitRecords()).toEqual([])
    expect(store.seenIntro()).toBe(false)
  })
})

describe('corrupt and invalid saves', () => {
  it('backs up corrupt JSON before resetting', () => {
    const raw = '{"v":1,"daily":{'
    const { store, backups, backend } = setup(raw)
    expect(store.daily('2026-10-01')).toBeUndefined()
    expect(backups).toEqual([raw])
    store.markIntroSeen()
    expect(stored(backend).seenIntro).toBe(true)
    expect(backups).toHaveLength(1)
  })

  it('treats non-object JSON as corrupt', () => {
    for (const raw of ['null', '[]', '42', '"hi"']) {
      const { store, backups } = setup(raw)
      expect(store.roundsPlayed()).toBe(0)
      expect(backups).toEqual([raw])
    }
  })

  it('normalizes null and wrongly typed fields instead of crashing', () => {
    const raw = JSON.stringify({ v: 1, daily: null, practice: null, habits: null, seenIntro: 'yes' })
    const { store, backups } = setup(raw)
    expect(store.daily('2026-10-01')).toBeUndefined()
    expect(store.streak('2026-10-01')).toBe(0)
    expect(store.accountAfter('2026-10-01')).toBe(SEASON_START)
    expect(store.unlockedProducts()).toContain('stock')
    expect(store.seenIntro()).toBe(false)
    expect(backups).toEqual([raw])
  })

  it('drops bad entries and keeps good ones', () => {
    const raw = JSON.stringify({
      v: 2,
      daily: {
        '2026-10-01': finished({ held: [] }),
        '2026-10-02': { yourReturn: 'big', buyHoldReturn: 0 },
        '2026-13-40': finished(),
        nonsense: finished(),
        '2026-10-04': { ...finished(), held: '??', product: 'tulips', trades: -3 },
      },
      habits: [record('a'), 42, { id: 'b' }, record('a')],
      frozen: ['2026-10-03', 'x', '2026-10-03'],
      seasons: { '2026-09': { final: 1, market: 0, cash: 0, days: 1, beatDays: 0, medal: false }, bad: {} },
      settings: { sound: false, haptics: 'no' },
    })
    const { store, backups } = setup(raw)
    expect(store.dailyHistory().map((d) => d.key)).toEqual(['2026-10-01', '2026-10-04'])
    expect(store.daily('2026-10-04')).toEqual({ ...finished(), held: [], product: undefined, trades: 0 })
    expect(store.habitRecords().map((h) => h.id)).toEqual(['a'])
    expect(store.streakState('2026-10-05').frozen).toEqual(['2026-10-03'])
    expect(store.pastSeasons().map((s) => s.season)).toEqual(['2026-09'])
    expect(store.getSettings()).toEqual({ sound: false, haptics: true, tapToggle: false })
    expect(backups).toHaveLength(1)
  })

  it('salvages a save with no version', () => {
    const { store, backups } = setup(JSON.stringify({ daily: { '2026-10-01': finished({ held: [] }) } }))
    expect(store.daily('2026-10-01')?.yourReturn).toBe(0.05)
    expect(backups).toHaveLength(1)
  })

  it('never writes over a save from newer code', () => {
    const raw = JSON.stringify({ v: SAVE_VERSION + 1, daily: { '2026-10-01': finished({ held: [] }) }, future: { x: 1 } })
    const { store, backend, writes, backups } = setup(raw)
    expect(store.readOnly()).toBe(true)
    expect(store.daily('2026-10-01')?.yourReturn).toBe(0.05)
    store.recordPractice(0.1, 2)
    store.markIntroSeen()
    expect(store.startDaily('2026-10-02', 0.01)).toBe(true)
    expect(writes).toEqual([])
    expect(backups).toEqual([])
    expect(backend.peek()).toBe(raw)
    // The session still sees its own changes.
    expect(store.practice().rounds).toBe(1)
    expect(store.seenIntro()).toBe(true)
  })

  it('parses without throwing for any garbage', () => {
    for (const raw of ['', '{', '{"v":"2"}', '{"v":-1}', '{"v":2,"daily":[1,2]}', '{"v":1,"habits":{"a":1}}']) {
      expect(() => parseSave(raw)).not.toThrow()
    }
  })
})

describe('two tabs on one save', () => {
  it("don't lose each other's writes", () => {
    const backend = memoryBackend()
    const a = createStore(backend)
    const b = createStore(backend)
    // Both tabs have read (and cached) the empty save.
    expect(a.roundsPlayed() + b.roundsPlayed()).toBe(0)
    a.recordPractice(0.1, 1)
    b.recordHabit(record('p:1'))
    a.markIntroSeen()
    b.recordPractice(0.3, 2)
    const file = stored(backend)
    expect(file.practice).toEqual({ rounds: 2, traded: 2, best: 0.3 })
    expect(file.habits.map((h: HabitRecord) => h.id)).toEqual(['p:1'])
    expect(file.seenIntro).toBe(true)
    expect(a.habitRecords()).toHaveLength(1)
  })

  it("can't play or record the same daily twice", () => {
    const backend = memoryBackend()
    const a = createStore(backend)
    const b = createStore(backend)
    const key = '2026-10-04'
    expect(b.canStartDaily(key)).toBe(true)
    expect(a.startDaily(key, 0.02)).toBe(true)
    // Tab B saw the home screen before A went live; at go-live it re-checks.
    expect(b.canStartDaily(key)).toBe(false)
    expect(b.startDaily(key, 0.02)).toBe(false)
    expect(b.recordDaily(key, finished({ yourReturn: 0.5 }))).toBe(false)
    expect(a.recordDaily(key, finished({ yourReturn: 0.1 }))).toBe(true)
    expect(b.recordDaily(key, finished({ yourReturn: 0.5 }))).toBe(false)
    expect(a.recordDaily(key, finished({ yourReturn: 0.9 }))).toBe(false)
    expect(b.daily(key)?.yourReturn).toBe(0.1)
  })

  it('refreshes after the storage event invalidates', () => {
    const backend = memoryBackend()
    const a = createStore(backend)
    const b = createStore(backend)
    const seen = vi.fn()
    b.onChange(seen)
    a.markIntroSeen()
    b.invalidate()
    expect(seen).toHaveBeenCalledOnce()
    expect(b.seenIntro()).toBe(true)
  })
})

describe('abandoned dailies', () => {
  const key = '2026-10-05'

  it('checkpoint into the season account but not the streak', () => {
    const { store, backend } = setup()
    store.recordDaily('2026-10-04', finished({ yourReturn: 0.1 }))
    store.startDaily(key, 0.03)
    store.progressDaily(key, { yourReturn: -0.2, held: [true, true, false] })
    expect(store.daily(key)).toMatchObject({ yourReturn: -0.2, held: [true, true, false], abandoned: true })
    expect(store.accountAfter(key)).toBeCloseTo(SEASON_START * 1.1 * 0.8)
    expect(store.streak(key)).toBe(1)

    // A new session (reload) can't fish for a better run over it.
    const later = createStore(backend)
    later.progressDaily(key, { yourReturn: 0.5, held: [] })
    expect(later.recordDaily(key, finished({ yourReturn: 0.5 }))).toBe(false)
    expect(later.daily(key)?.yourReturn).toBe(-0.2)
    expect(later.startDaily(key, 0.03)).toBe(false)
    // The abandoned day is a missed day: by tomorrow the streak is broken.
    expect(later.streak('2026-10-06')).toBe(0)
  })

  it('are overwritten by the same session finishing', () => {
    const { store } = setup()
    store.startDaily(key, 0.03)
    store.progressDaily(key, { yourReturn: -0.2, held: [true] })
    expect(store.recordDaily(key, finished({ yourReturn: 0.07 }))).toBe(true)
    expect(store.daily(key)?.abandoned).toBeUndefined()
    // Once finished, checkpoints stop.
    store.progressDaily(key, { yourReturn: -0.5, held: [] })
    expect(store.daily(key)?.yourReturn).toBe(0.07)
    expect(store.streak(key)).toBe(1)
  })
})

describe('unlocks', () => {
  it('count only rounds with at least one trade', () => {
    const { store } = setup()
    for (let i = 0; i < 6; i++) store.recordPractice(0.002, 0)
    expect(store.roundsPlayed()).toBe(0)
    expect(store.practice().rounds).toBe(6)
    expect(store.unlockedProducts()).toEqual(['stock'])
    store.recordPractice(0.05, 3)
    expect(store.roundsPlayed()).toBe(1)
    store.recordDaily('2026-10-04', finished({ trades: 0, product: 'stock' }))
    expect(store.roundsPlayed()).toBe(1)
    store.recordDaily('2026-10-05', finished({ trades: 2, product: 'stock' }))
    store.startDaily('2026-10-06', 0)
    expect(store.roundsPlayed()).toBe(2)
    expect(store.practiceBest()).toBe(0.05)
  })

  it('still open a product met as a daily chart', () => {
    const { store } = setup()
    store.recordDaily('2026-10-02', finished({ trades: 0, product: 'lev2' }))
    expect(store.isUnlocked('lev2')).toBe(true)
  })
})

describe('write failures', () => {
  it('are flagged and the session keeps its data', () => {
    let full = true
    const backend: StorageBackend = memoryBackend(null, () => {
      if (full) throw new Error('QuotaExceededError')
    })
    const store = createStore(backend)
    expect(store.lastWriteFailed()).toBe(false)
    store.recordPractice(0.1, 1)
    expect(store.lastWriteFailed()).toBe(true)
    full = false
    store.recordPractice(0.2, 1)
    expect(store.lastWriteFailed()).toBe(false)
    expect(store.practice().rounds).toBe(2)
  })

  it('keep the change in memory when the backend never stored it', () => {
    let mem: string | null = null
    const store = createStore({
      read: () => mem,
      write: () => {
        throw new Error('full')
      },
    })
    store.markIntroSeen()
    expect(mem).toBeNull()
    expect(store.seenIntro()).toBe(true)
    store.recordPractice(0.1, 1)
    expect(store.seenIntro()).toBe(true)
    expect(store.practice().rounds).toBe(1)
  })

  it('are flagged for async writes that reject', async () => {
    const store = createStore(memoryBackend(null, () => Promise.reject(new Error('native'))))
    store.markIntroSeen()
    await new Promise((r) => setTimeout(r, 0))
    expect(store.lastWriteFailed()).toBe(true)
  })

  it('never write blind when storage cannot be read', () => {
    const write = vi.fn()
    const store = createStore({
      read: () => {
        throw new Error('SecurityError')
      },
      write,
    })
    store.recordPractice(0.1, 1)
    expect(write).not.toHaveBeenCalled()
    expect(store.lastWriteFailed()).toBe(true)
    expect(store.practice().rounds).toBe(1)
  })
})

describe('default store', () => {
  it('can be hydrated from async storage', () => {
    const write = vi.fn()
    hydrate(JSON.stringify({ v: 2, seenIntro: false, practice: { rounds: 4, traded: 4, best: 0.1 } }), write)
    expect(save.practice().rounds).toBe(4)
    save.markIntroSeen()
    expect(write).toHaveBeenCalledOnce()
    expect(JSON.parse(write.mock.calls[0][0]).seenIntro).toBe(true)
  })
})

describe('habits and settings', () => {
  it('keep 200 habit records, newest last', () => {
    const { store } = setup()
    for (let i = 0; i < 230; i++) store.recordHabit(record(`p:${i}`))
    const ids = store.habitRecords().map((h) => h.id)
    expect(ids).toHaveLength(200)
    expect(ids[0]).toBe('p:30')
    expect(ids[199]).toBe('p:229')
    store.setLuck('p:229', 0.7)
    expect(store.habitRecords()[199].luckPct).toBe(0.7)
  })

  it('update settings partially', () => {
    const { store, writes } = setup()
    expect(store.updateSettings({ tapToggle: true })).toEqual({ sound: true, haptics: true, tapToggle: true })
    store.updateSettings({ tapToggle: true })
    expect(writes).toHaveLength(1)
    expect(store.updateSettings({ sound: false }).sound).toBe(false)
  })
})

describe('compact storage', () => {
  it('stores a year of dailies in a small file', () => {
    const { store, backend } = setup()
    const held = new Array(400).fill(false).map((_, t) => (t >= 40 && t < 90) || (t >= 200 && t < 310))
    let key = '2027-01-01'
    for (let i = 0; i < 365; i++) {
      store.recordDaily(key, finished({ held }))
      const d = new Date(`${key}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() + 1)
      key = d.toISOString().slice(0, 10)
    }
    expect(backend.peek()!.length).toBeLessThan(80_000)
    expect(store.daily('2027-06-01')?.held).toEqual(held)
  })
})
