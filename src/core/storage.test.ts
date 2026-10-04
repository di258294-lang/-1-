import { describe, expect, it, vi } from 'vitest'
import type { HabitRecord } from './habits'
import { SEASON_START } from './season'
import { DEFAULT_SETTINGS } from './types'
import {
  blindBackend,
  coalescedWriter,
  createStore,
  hydrate,
  hydrateAsync,
  LIVE_KEY,
  parseLive,
  SAVE_KEY,
  withTimeout,
  LEGACY_NICK_KEY,
  memoryBackend,
  migrateLegacyNick,
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
    expect(store.getSettings()).toEqual(DEFAULT_SETTINGS)

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
    expect(store.getSettings()).toEqual({ ...DEFAULT_SETTINGS, sound: false })
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
    // A daily that can't be recorded can't be played (a reload would replay it).
    expect(store.startDaily('2026-10-02', 0.01)).toBe(false)
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
    expect(store.updateSettings({ tapToggle: true })).toEqual({ ...DEFAULT_SETTINGS, tapToggle: true })
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

describe('coaching state', () => {
  it('defaults when missing, without counting as a repair', () => {
    const v2 = JSON.stringify({ v: 2, daily: {}, habits: [], seenIntro: true })
    const loaded = parseSave(v2)
    expect(loaded.backup).toBe(false)
    expect(loaded.file.coach).toEqual({ active: null, done: [], lessons: [] })
    expect(loaded.file.seenSeasons).toEqual([])
  })

  it('keeps a valid mission and drops what is broken', () => {
    const raw = JSON.stringify({
      v: 2,
      coach: {
        active: { id: 'stopLine', since: '2026-10-05', attempts: ['pass', 'nope', 'fail'], recheck: true },
        done: [{ id: 'longHold', at: '2026-10-01' }, { id: 'bogus', at: '2026-10-02' }, { id: 'fewTrades', at: 'x' }],
        lessons: ['L1', 'L1', 7, 'p:coin'],
      },
      seenSeasons: ['2026-09', 'junk', '2026-09'],
    })
    const { file } = parseSave(raw)
    expect(file.coach.active).toEqual({ id: 'stopLine', since: '2026-10-05', attempts: ['pass', 'fail'], recheck: true })
    expect(file.coach.done).toEqual([{ id: 'longHold', at: '2026-10-01' }])
    expect(file.coach.lessons).toEqual(['L1', 'p:coin'])
    expect(file.seenSeasons).toEqual(['2026-09'])
    // An unknown mission id is dropped, not trusted.
    expect(parseSave(JSON.stringify({ v: 2, coach: { active: { id: 'x' } } })).file.coach.active).toBeNull()
    expect(parseSave(JSON.stringify({ v: 2, coach: 'garbage' })).issues).toContain('coach')
  })

  it('updates read-modify-write and survives a reload', () => {
    const { backend, store } = setup()
    store.updateCoach((c) => ({ ...c, active: { id: 'waitBeat', since: '2026-10-05', attempts: ['pass'] } }))
    store.markLessonSeen('L3')
    store.markLessonSeen('L3')
    store.markSeasonsSeen(['2026-09', '2026-08'])
    const again = createStore(memoryBackend(backend.peek()))
    expect(again.coach()).toEqual({
      active: { id: 'waitBeat', since: '2026-10-05', attempts: ['pass'] },
      done: [],
      lessons: ['L3'],
    })
    expect(again.seenSeasons()).toEqual(['2026-08', '2026-09'])
  })

  it('skips the write when nothing changed', () => {
    const { store, writes } = setup()
    store.updateCoach(() => null)
    store.markSeasonsSeen([])
    expect(writes).toHaveLength(0)
  })
})

describe('nickname and pending challenge', () => {
  it('keep a clean nickname in the settings', () => {
    const { store, backend } = setup()
    expect(store.getSettings().nick).toBe('')
    expect(store.updateSettings({ nick: '  민수  ' }).nick).toBe('민수')
    // Not a valid name: stored as no name.
    expect(store.updateSettings({ nick: '<b>' }).nick).toBe('')
    store.updateSettings({ nick: '지영' })
    expect(createStore(memoryBackend(backend.peek())).getSettings().nick).toBe('지영')
    // A broken stored name is dropped (and the file backed up).
    const bad = parseSave(JSON.stringify({ v: 2, settings: { nick: 42, sound: false } }))
    expect(bad.file.settings).toEqual({ ...DEFAULT_SETTINGS, sound: false })
    expect(bad.issues).toContain('settings.nick')
  })

  it('keep a challenge code until it is used', () => {
    const { store, backend, writes } = setup()
    expect(store.pendingChallenge()).toBeNull()
    store.setPendingChallenge('AQIDBAUG_-x')
    expect(store.pendingChallenge()).toBe('AQIDBAUG_-x')
    expect(createStore(memoryBackend(backend.peek())).pendingChallenge()).toBe('AQIDBAUG_-x')
    store.setPendingChallenge('not a code!')
    expect(store.pendingChallenge()).toBe('AQIDBAUG_-x')
    store.setPendingChallenge(null)
    expect(store.pendingChallenge()).toBeNull()
    store.setPendingChallenge(null)
    expect(writes).toHaveLength(2)
    expect(parseSave(JSON.stringify({ v: 2, pendingChallenge: 7 })).file.pendingChallenge).toBeNull()
  })

  it('moves the old hold.nick key into the save once', () => {
    const ls = new Map<string, string>([[LEGACY_NICK_KEY, '민수']])
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => ls.get(k) ?? null,
      setItem: (k: string, v: string) => void ls.set(k, v),
      removeItem: (k: string) => void ls.delete(k),
    })
    try {
      const { store } = setup()
      migrateLegacyNick(store)
      expect(store.getSettings().nick).toBe('민수')
      expect(ls.has(LEGACY_NICK_KEY)).toBe(false)
      // A name already in the save wins over a stale old key.
      ls.set(LEGACY_NICK_KEY, '하늘')
      migrateLegacyNick(store)
      expect(store.getSettings().nick).toBe('민수')
      // Storage that can't be written keeps the old key for next time.
      const blind = createStore({
        read: () => {
          throw new Error('blocked')
        },
        write: () => {},
      })
      ls.set(LEGACY_NICK_KEY, '지영')
      migrateLegacyNick(blind)
      expect(ls.get(LEGACY_NICK_KEY)).toBe('지영')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('read cache', () => {
  it('reads the backend once until a write or an invalidation', () => {
    const backend = memoryBackend(JSON.stringify({ v: 2, seenIntro: true }))
    const read = vi.spyOn(backend, 'read')
    const store = createStore(backend)
    for (let i = 0; i < 10; i++) store.seenIntro()
    expect(read).toHaveBeenCalledTimes(1)
    store.recordPractice(0.1, 1) // read-modify-write: one fresh read
    store.practice()
    expect(read).toHaveBeenCalledTimes(2)
    store.invalidate()
    store.practice()
    store.practice()
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('still re-reads before starting or recording a daily (two tabs)', () => {
    const backend = memoryBackend()
    const a = createStore(backend)
    const b = createStore(backend)
    expect(b.daily('2026-10-04')).toBeUndefined() // b's cache: no entry
    expect(a.startDaily('2026-10-04', 0)).toBe(true)
    expect(b.canStartDaily('2026-10-04')).toBe(false)
    expect(b.startDaily('2026-10-04', 0)).toBe(false)
  })
})

describe('batch', () => {
  it('writes several changes once, and reads inside see them', () => {
    const { store, writes } = setup()
    const out = store.batch(() => {
      store.recordPractice(0.1, 1)
      store.recordHabit(record('p:1'))
      store.batch(() => store.markLessonSeen('L1'))
      return store.practice().rounds
    })
    expect(out).toBe(1)
    expect(writes).toHaveLength(1)
    const file = JSON.parse(writes[0])
    expect(file.practice.rounds).toBe(1)
    expect(file.habits).toHaveLength(1)
    expect(file.coach.lessons).toEqual(['L1'])
  })

  it('writes nothing when nothing changed, and keeps changes made before a throw', () => {
    const { store, writes } = setup()
    store.batch(() => store.markSeasonsSeen([]))
    expect(writes).toHaveLength(0)
    expect(() =>
      store.batch(() => {
        store.markIntroSeen()
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(writes).toHaveLength(1)
    expect(store.seenIntro()).toBe(true)
  })
})

describe('live checkpoint', () => {
  const key = '2026-10-05'

  it('writes a small record, not the save, and loading folds it in', () => {
    const { store, backend, writes } = setup()
    store.startDaily(key, 0.03)
    const before = writes.length
    for (let i = 0; i < 5; i++) store.progressDaily(key, { yourReturn: -0.01 * i, held: [true, true, false] })
    expect(writes.length).toBe(before)
    expect(backend.peekLive()!.length).toBeLessThan(200)
    expect(store.daily(key)).toMatchObject({ yourReturn: -0.04, held: [true, true, false], abandoned: true })
    // App killed: the next session sees the checkpoint, not the 0% placeholder.
    const next = createStore(backend)
    expect(next.daily(key)).toMatchObject({ yourReturn: -0.04, abandoned: true })
    expect(next.accountAfter(key)).toBeCloseTo(SEASON_START * 0.96)
    // Its next write persists the folded entry.
    next.markIntroSeen()
    expect(stored(backend).daily[key].yourReturn).toBe(-0.04)
  })

  it('is removed when the round finishes, and never touches a finished day', () => {
    const { store, backend } = setup()
    store.startDaily(key, 0.03)
    store.progressDaily(key, { yourReturn: -0.2, held: [true] })
    expect(store.recordDaily(key, finished({ yourReturn: 0.07 }))).toBe(true)
    expect(backend.peekLive()).toBeNull()
    // A stale record left behind can't rewrite a finished day.
    backend.writeLive(JSON.stringify({ key, yourReturn: -0.5, held: '1' }))
    expect(createStore(backend).daily(key)?.yourReturn).toBe(0.07)
  })

  it('ignores a malformed record', () => {
    for (const raw of ['', '{', '{"key":"x","yourReturn":0,"held":""}', '{"key":"2026-10-05","yourReturn":-3,"held":""}']) {
      expect(parseLive(raw)).toBeNull()
    }
  })

  it('falls back to the save for a backend without a live slot', () => {
    let mem: string | null = null
    const store = createStore({ read: () => mem, write: (s) => void (mem = s) })
    store.startDaily(key, 0.03)
    store.progressDaily(key, { yourReturn: -0.2, held: [true] })
    expect(JSON.parse(mem!).daily[key].yourReturn).toBe(-0.2)
  })
})

describe('live checkpoint safety (qa3 P2-6b, P2-7)', () => {
  const key = '2026-10-05'

  it("another tab's checkpoint is read even when the save text did not change", () => {
    const backend = memoryBackend()
    const a = createStore(backend)
    const b = createStore(backend)
    a.startDaily(key, 0.03)
    b.invalidate() // A's placeholder write
    expect(b.daily(key)).toMatchObject({ yourReturn: 0, abandoned: true })
    a.progressDaily(key, { yourReturn: 0.044, held: [true, true] })
    b.invalidate() // the storage event for LIVE_KEY
    expect(b.daily(key)).toMatchObject({ yourReturn: 0.044, held: [true, true], abandoned: true })
    a.progressDaily(key, { yourReturn: 0.05, held: [true, true, true] })
    b.invalidate()
    expect(b.daily(key)?.yourReturn).toBe(0.05)
  })

  it('keeps the checkpoint until the final result is written', () => {
    let full = false
    const order: string[] = []
    const backend = memoryBackend(
      null,
      (s) => {
        if (full) throw new Error('QuotaExceededError')
        order.push(JSON.parse(s).daily?.[key]?.abandoned ? 'save:placeholder' : 'save')
      },
      undefined,
      { write: (s) => void order.push(s === null ? 'rm live' : 'live') },
    )
    const store = createStore(backend)
    store.startDaily(key, 0.03)
    store.progressDaily(key, { yourReturn: 0.02, held: [true] })
    order.length = 0
    store.batch(() => {
      expect(store.recordDaily(key, finished({ yourReturn: 0.07 }))).toBe(true)
      // Inside the batch nothing is written yet, so the checkpoint stays.
      expect(backend.peekLive()).not.toBeNull()
      store.recordPractice(0, 0)
    })
    expect(order).toEqual(['save', 'rm live'])
    expect(backend.peekLive()).toBeNull()

    // The final write fails: the checkpoint is still there for a reload.
    const day2 = '2026-10-06'
    store.startDaily(day2, 0.01)
    store.progressDaily(day2, { yourReturn: -0.03, held: [true] })
    full = true
    store.batch(() => store.recordDaily(day2, finished({ yourReturn: 0.01 })))
    expect(store.lastWriteFailed()).toBe(true)
    expect(parseLive(backend.peekLive())).toMatchObject({ key: day2, yourReturn: -0.03 })
    // The next write that lands carries the result, then the checkpoint goes.
    full = false
    store.markIntroSeen()
    expect(stored(backend).daily[day2]).toMatchObject({ yourReturn: 0.01 })
    expect(backend.peekLive()).toBeNull()
  })

  it('removes the checkpoint only after an async save resolves', async () => {
    let resolve = () => {}
    const backend = memoryBackend(null, (s) =>
      JSON.parse(s).daily?.[key]?.abandoned ? undefined : new Promise<void>((r) => (resolve = r)),
    )
    const store = createStore(backend)
    store.startDaily(key, 0.03)
    store.progressDaily(key, { yourReturn: 0.02, held: [true] })
    store.recordDaily(key, finished())
    await Promise.resolve()
    expect(backend.peekLive()).not.toBeNull()
    resolve()
    await new Promise((r) => setTimeout(r, 0))
    expect(backend.peekLive()).toBeNull()
  })

  it('falls back to the save when the live slot cannot be written', () => {
    const backend = memoryBackend(null, undefined, undefined, {
      write: (s) => {
        if (s !== null) throw new Error('QuotaExceededError')
      },
    })
    const store = createStore(backend)
    store.startDaily(key, 0.03)
    store.progressDaily(key, { yourReturn: 0.04, held: [true, false] })
    expect(stored(backend).daily[key]).toMatchObject({ yourReturn: 0.04, abandoned: true })
    expect(store.lastWriteFailed()).toBe(false)
  })

  it('falls back to the save when an async live write rejects', async () => {
    const backend = memoryBackend(null, undefined, undefined, { write: () => Promise.reject(new Error('native')) })
    const store = createStore(backend)
    store.startDaily(key, 0.03)
    store.progressDaily(key, { yourReturn: 0.04, held: [true] })
    await new Promise((r) => setTimeout(r, 0))
    expect(stored(backend).daily[key]).toMatchObject({ yourReturn: 0.04, abandoned: true })
  })
})

describe('canRecord (qa3 P2-9)', () => {
  it('is true for a readable, writable, current save', () => {
    expect(setup().store.canRecord()).toBe(true)
  })

  it('is false for a save from a newer version', () => {
    expect(setup(JSON.stringify({ v: SAVE_VERSION + 1, seenIntro: true })).store.canRecord()).toBe(false)
  })

  it('is false while storage cannot be read, and true once it can', () => {
    let blocked = true
    const store = createStore({
      read: () => {
        if (blocked) throw new Error('SecurityError')
        return null
      },
      write: () => {},
    })
    expect(store.canRecord()).toBe(false)
    expect(store.blind()).toBe(true)
    blocked = false
    expect(store.canRecord()).toBe(true)
    expect(store.blind()).toBe(false)
  })

  it('is false after a failed write, until one succeeds', () => {
    let full = true
    const store = createStore(
      memoryBackend(null, () => {
        if (full) throw new Error('QuotaExceededError')
      }),
    )
    store.recordPractice(0, 0)
    expect(store.canRecord()).toBe(false)
    full = false
    store.recordPractice(0, 0)
    expect(store.canRecord()).toBe(true)
  })
})

describe('intro seen with storage that cannot be read', () => {
  it('stays seen for the session, and is stored once storage works', () => {
    let blocked = true
    let mem: string | null = null
    const store = createStore({
      read: () => {
        if (blocked) throw new Error('SecurityError')
        return mem
      },
      write: (s) => void (mem = s),
    })
    expect(store.seenIntro()).toBe(false)
    store.markIntroSeen()
    expect(store.seenIntro()).toBe(true)
    expect(mem).toBeNull()
    // Storage answers again (a stale read goes back to it): still seen.
    blocked = false
    store.invalidate()
    expect(store.seenIntro()).toBe(true)
    store.recordPractice(0, 0)
    expect(JSON.parse(mem!).seenIntro).toBe(true)
  })
})

describe('a daily that cannot be recorded', () => {
  it('is not started when the placeholder write fails', () => {
    const store = createStore(
      memoryBackend(null, () => {
        throw new Error('QuotaExceededError')
      }),
    )
    expect(store.startDaily('2026-10-05', 0)).toBe(false)
    expect(store.daily('2026-10-05')).toBeUndefined()
    expect(store.lastWriteFailed()).toBe(true)
  })

  it('is not started while storage is unreadable', () => {
    const store = createStore(blindBackend())
    expect(store.startDaily('2026-10-05', 0)).toBe(false)
  })

  it('re-archives a month another tab closed while this round ran', () => {
    const backend = memoryBackend()
    const a = createStore(backend)
    const b = createStore(backend)
    a.startDaily('2026-10-31', 0)
    a.progressDaily('2026-10-31', { yourReturn: 0.03, held: [true] })
    expect(createStore(backend).closeSeasons('2026-11-01')).toEqual(['2026-10'])
    expect(b.pastSeasons()[0].final).toBeCloseTo(SEASON_START * 1.03)
    a.recordDaily('2026-10-31', finished({ yourReturn: 0.05 }))
    b.invalidate() // the storage event
    expect(b.pastSeasons()[0].final).toBeCloseTo(SEASON_START * 1.05)
  })
})

describe('habit evidence', () => {
  it('drops a malformed evidence block on load', () => {
    const evidence = { exits: 1, exitZ: 0.5, losses: 2, depth: -0.1, depthBase: -0.05, rumors: 0, rumorHits: 0, rumorChance: 0, chases: 1, chaseChance: 0.2 }
    for (const bad of [null, 'x', {}, { ...evidence, exits: -1 }, { ...evidence, depth: 'deep' }]) {
      const loaded = parseSave(JSON.stringify({ v: 2, habits: [{ ...record('p:1'), evidence: bad }] }))
      expect(loaded.file.habits[0].evidence).toBeUndefined()
      expect(loaded.issues).toContain('habits.0.evidence')
      expect(loaded.backup).toBe(true)
    }
    const good = parseSave(JSON.stringify({ v: 2, habits: [{ ...record('p:1'), evidence }] }))
    expect(good.file.habits[0].evidence).toEqual(evidence)
    expect(good.issues).toEqual([])
  })
})

describe('coalesced writes', () => {
  it('send only the latest text after the one in flight', async () => {
    const sent: string[] = []
    let release = () => {}
    const write = coalescedWriter(async (s: string) => {
      sent.push(s)
      if (s === 'a') await new Promise<void>((r) => (release = r))
    })
    const done = write('a')
    await Promise.resolve()
    await Promise.resolve()
    void write('b')
    void write('c')
    release()
    await done
    expect(sent).toEqual(['a', 'c'])
  })

  it('reject when the last write failed', async () => {
    const write = coalescedWriter(async () => {
      throw new Error('bridge')
    })
    await expect(write('x')).rejects.toThrow()
  })
})

describe('async boot (Toss)', () => {
  const slow = (data: Map<string, string>, ms: number) => ({
    get: (k: string) => new Promise<string | null>((r) => setTimeout(() => r(data.get(k) ?? null), ms)),
    set: async (k: string, v: string) => void data.set(k, v),
  })
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  it('tells a timeout from a stored null', async () => {
    expect(await withTimeout(Promise.resolve(null), 50)).toEqual({ status: 'value', value: null })
    expect(await withTimeout(sleep(50), 5)).toEqual({ status: 'timeout' })
    expect((await withTimeout(Promise.reject(new Error('x')), 50)).status).toBe('error')
  })

  it('never overwrites the save when the read is slow, and loads it when it comes', async () => {
    const real = JSON.stringify({ v: 2, seenIntro: true, practice: { rounds: 40, traded: 40, best: 0.3 } })
    const data = new Map([[SAVE_KEY, real]])
    const onLate = vi.fn()
    expect(await hydrateAsync(slow(data, 40), { timeoutMs: 5, onLate })).toBe(false)
    // Blind: an empty view, changes stay in memory, nothing is written.
    expect(save.practice().rounds).toBe(0)
    save.markIntroSeen()
    save.recordPractice(0.1, 1)
    expect(save.lastWriteFailed()).toBe(true)
    await sleep(10)
    expect(data.get(SAVE_KEY)).toBe(real)
    // The late answer arrives: the real save is loaded and the screen told.
    await sleep(60)
    expect(onLate).toHaveBeenCalledOnce()
    expect(save.practice().rounds).toBe(40)
    expect(save.lastWriteFailed()).toBe(false)
    save.recordPractice(0.2, 1)
    await sleep(0)
    expect(JSON.parse(data.get(SAVE_KEY)!).practice.rounds).toBe(41)
  })

  it('loads in time, with the live checkpoint, and writes the latest text only', async () => {
    const data = new Map([
      [SAVE_KEY, JSON.stringify({ v: 2, daily: { '2026-10-05': { yourReturn: 0, buyHoldReturn: 0, held: '', trades: 0, title: '', abandoned: true } } })],
      [LIVE_KEY, JSON.stringify({ key: '2026-10-05', yourReturn: -0.07, held: '0.3' })],
    ])
    const set = vi.fn(async (k: string, v: string) => void data.set(k, v))
    expect(await hydrateAsync({ get: slow(data, 1).get, set }, { timeoutMs: 500 })).toBe(true)
    expect(save.daily('2026-10-05')?.yourReturn).toBe(-0.07)
    save.markIntroSeen()
    save.recordPractice(0.1, 1)
    save.recordPractice(0.2, 1)
    await sleep(0)
    const saves = set.mock.calls.filter(([k]) => k === SAVE_KEY)
    expect(saves).toHaveLength(1)
    expect(JSON.parse(saves[0][1]).practice.rounds).toBe(2)
  })
})
