import { cleanName } from './challenge'
import { decodeHeld, encodeHeld } from './codec'
import { HABIT_KEYS, type HabitCounts, type HabitEvidence, type HabitKey, type HabitRecord, type HabitScores } from './habits'
import { PRODUCT_ORDER, PRODUCTS, type ProductKey } from './products'
import {
  archiveSeason,
  dailyHistory,
  seasonSummary,
  seasonsToClose,
  type ArchivedSeason,
  type DailyHistoryItem,
  type SeasonSummary,
} from './records'
import { accountAfter, accountBefore, seasonOf } from './season'
import { emptyMissionState, isMissionId, type ActiveMission, type MissionState } from './missions'
import { freezesToApply, playedDays, streakDays, streakState, type StreakState } from './streak'
import { DEFAULT_SETTINGS, TOGGLE_KEYS, type Settings } from './types'

/**
 * The save file: one JSON document under one key.
 *
 * Schema versions live inside the document (`v`), not in the key, so the key
 * stays 'hold.save.v1' for continuity with every save already out there.
 * Loading runs the migrations chain up to SAVE_VERSION, then normalize()
 * checks every field's type and repairs or drops what is broken. Nothing is
 * written on load; the next change writes the upgraded file.
 *
 * Safety rules:
 *   - A file from newer code (v > SAVE_VERSION) is never written over. The
 *     store goes read-only: changes live in memory for this session only.
 *   - Before a corrupt or repaired file can be replaced, its raw text is
 *     copied to BACKUP_KEY.
 *   - Every change is read-modify-write against the backend, so two tabs
 *     don't erase each other's progress, and a daily recorded in one tab
 *     can't be played again in another.
 *   - Write failures (full storage, private mode) are flagged, not hidden:
 *     see lastWriteFailed(). The game keeps working from memory.
 */
export const SAVE_KEY = 'hold.save.v1'
export const BACKUP_KEY = 'hold.save.bak'
export const SAVE_VERSION = 2
/** Analyzed rounds kept for the habit profile and history screens. */
export const HABIT_HISTORY = 200

export type SavedDaily = {
  yourReturn: number
  buyHoldReturn: number
  held: boolean[]
  trades: number
  title: string
  product?: ProductKey
  /**
   * Set when a daily round started but never finished (reload, app kill).
   * It counts in the season account with its last checkpointed return, does
   * not count as a played day for the streak, and is never overwritten
   * except by the session that started it.
   */
  abandoned?: boolean
}

/** A daily as stored: held is run-length coded (see codec.ts). */
type StoredDaily = Omit<SavedDaily, 'held'> & { held: string }

type SaveFile = {
  v: typeof SAVE_VERSION
  daily: Record<string, StoredDaily>
  practice: {
    /** Every practice round finished. */
    rounds: number
    /** Practice rounds with at least one trade; these open products. */
    traded: number
    best: number | null
  }
  /**
   * Rounds credited when migrating from v1, which counted idle rounds toward
   * unlocks. Keeps every existing player's unlock progress where it was.
   */
  unlockCredit: number
  seenIntro: boolean
  /** Analyzed rounds that had at least one trade, oldest first. */
  habits: HabitRecord[]
  settings: Settings
  /** Missed days covered by a streak freeze, oldest first. */
  frozen: string[]
  /** Finished months by 'yyyy-mm', frozen once by closeSeasons. */
  seasons: Record<string, ArchivedSeason>
  // --- coaching (optional in older files; normalize fills defaults) ---
  coach: CoachSave
  /** Closed seasons whose recap card was opened or dismissed ('yyyy-mm'). */
  seenSeasons: string[]
  /**
   * A friend's challenge code that could not be played yet (today's daily
   * was not done). Cleared once it is used.
   */
  pendingChallenge: string | null
}

/** Missions and micro-lessons (see missions.ts, lessons.ts). */
export type CoachSave = MissionState & {
  /** Lesson ids already shown in the result screen's lesson slot. */
  lessons: string[]
}

export type { ArchivedSeason, DailyHistoryItem, SeasonSummary, StreakState }

function emptySave(): SaveFile {
  return {
    v: SAVE_VERSION,
    daily: {},
    practice: { rounds: 0, traded: 0, best: null },
    unlockCredit: 0,
    seenIntro: false,
    habits: [],
    settings: { ...DEFAULT_SETTINGS },
    frozen: [],
    seasons: {},
    coach: { ...emptyMissionState(), lessons: [] },
    seenSeasons: [],
    pendingChallenge: null,
  }
}

// ---------------------------------------------------------------------------
// Validation helpers

type Json = Record<string, unknown>

const isObj = (x: unknown): x is Json => typeof x === 'object' && x !== null && !Array.isArray(x)
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const isCount = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0
const isBool = (x: unknown): x is boolean => typeof x === 'boolean'
const isStr = (x: unknown): x is string => typeof x === 'string'
const isProduct = (x: unknown): x is ProductKey => isStr(x) && Object.hasOwn(PRODUCTS, x)
const isLength = (x: unknown): x is HabitRecord['length'] => x === 'short' || x === 'long'
/** A challenge link code as it appears in ?c= (base64url, bounded). */
const isChallengeCode = (x: unknown): x is string => isStr(x) && /^[A-Za-z0-9_-]{1,256}$/.test(x)

/** 'yyyy-mm-dd' naming a real day. Years are bounded so streak walks stay short. */
export function isDateKey(x: unknown): x is string {
  if (!isStr(x) || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false
  const y = Number(x.slice(0, 4))
  if (y < 2020 || y > 2199) return false
  const d = new Date(`${x}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === x
}

const isSeasonKey = (x: unknown): x is string => isStr(x) && /^\d{4}-\d{2}$/.test(x) && isDateKey(`${x}-01`)

/**
 * obj[key] if it passes `ok`, else the fallback. A missing field is normal
 * (older saves lack newer fields); a present field of the wrong type is
 * recorded as an issue so the raw file gets backed up before repair.
 */
function field<T>(obj: Json, key: string, ok: (v: unknown) => v is T, fallback: T, issues: string[], path: string): T {
  const v = obj[key]
  if (v === undefined) return fallback
  if (ok(v)) return v
  issues.push(`${path}.${key}`)
  return fallback
}

// ---------------------------------------------------------------------------
// Normalize: repair or drop every bad field, so screens can trust the shape.

function normDaily(x: unknown, issues: string[], path: string): StoredDaily | null {
  if (!isObj(x)) return null
  const okReturn = (v: unknown): v is number => isNum(v) && v >= -1
  if (!okReturn(x.yourReturn) || !okReturn(x.buyHoldReturn)) return null
  let held = ''
  if (isStr(x.held) && decodeHeld(x.held) !== null) held = x.held
  else if (Array.isArray(x.held)) held = encodeHeld(x.held.map(Boolean)) // v1 boolean[]
  else if (x.held !== undefined) issues.push(`${path}.held`)
  const out: StoredDaily = {
    yourReturn: x.yourReturn,
    buyHoldReturn: x.buyHoldReturn,
    held,
    trades: field(x, 'trades', isCount, 0, issues, path),
    title: field(x, 'title', isStr, '', issues, path),
  }
  const product = field(x, 'product', isProduct, undefined, issues, path)
  if (product) out.product = product
  if (x.abandoned === true) out.abandoned = true
  return out
}

const EVIDENCE_COUNTS = ['exits', 'losses', 'rumors', 'rumorHits', 'chases'] as const
const EVIDENCE_SUMS = ['exitZ', 'depth', 'depthBase', 'rumorChance', 'chaseChance'] as const

/** HabitEvidence with every field present and finite (counts never negative). */
function isEvidence(x: unknown): x is HabitEvidence {
  if (!isObj(x)) return false
  return EVIDENCE_COUNTS.every((k) => isNum(x[k]) && x[k] >= 0) && EVIDENCE_SUMS.every((k) => isNum(x[k]))
}

/**
 * Habit records are owned by habits.ts; unknown extra fields are kept as-is,
 * except `evidence`, which the profile pools: a malformed one is dropped.
 * v1 entries hold only { id, scores } and get the defaults below.
 */
function normHabit(x: unknown, issues: string[], path: string): HabitRecord | null {
  if (!isObj(x) || !isStr(x.id) || !isObj(x.scores)) return null
  const raw = x.scores
  const scores = Object.fromEntries(
    HABIT_KEYS.map((k) => [k, isNum(raw[k]) ? Math.min(1, Math.max(0, raw[k])) : 0]),
  ) as HabitScores
  const m = isObj(x.measurable) ? x.measurable : {}
  if (x.measurable !== undefined && !isObj(x.measurable)) issues.push(`${path}.measurable`)
  const measurable = Object.fromEntries(HABIT_KEYS.map((k) => [k, isBool(m[k]) ? m[k] : true])) as Record<
    HabitKey,
    boolean
  >
  const c = isObj(x.counts) ? x.counts : {}
  if (x.counts !== undefined && !isObj(x.counts)) issues.push(`${path}.counts`)
  const count = (k: keyof HabitCounts) => (isNum(c[k]) && c[k] >= 0 ? c[k] : 0)
  const luck = x.luckPct
  const { evidence, ...rest } = x
  const out: HabitRecord = {
    ...rest,
    id: x.id,
    at: field(x, 'at', isStr, '', issues, path),
    product: field(x, 'product', isProduct, 'stock', issues, path),
    length: field(x, 'length', isLength, 'short', issues, path),
    trades: field(x, 'trades', isCount, 1, issues, path),
    heldRatio: field(x, 'heldRatio', isNum, 0, issues, path),
    scores,
    measurable,
    counts: { sellUp: count('sellUp'), expUp: count('expUp'), sellDown: count('sellDown'), expDown: count('expDown') },
    luckPct: isNum(luck) && luck >= 0 && luck <= 1 ? luck : null,
  }
  if (isEvidence(evidence)) out.evidence = { ...evidence }
  else if (evidence !== undefined) issues.push(`${path}.evidence`)
  return out
}

// --- coaching ---------------------------------------------------------------

const MAX_LESSONS = 100
const MAX_DONE = 50

function normCoach(x: unknown, issues: string[]): CoachSave {
  const out: CoachSave = { ...emptyMissionState(), lessons: [] }
  if (x === undefined) return out
  if (!isObj(x)) {
    issues.push('coach')
    return out
  }
  const a = x.active
  if (isObj(a) && isMissionId(a.id)) {
    const attempts = Array.isArray(a.attempts) ? a.attempts.filter((v): v is 'pass' | 'fail' => v === 'pass' || v === 'fail') : []
    const active: ActiveMission = { id: a.id, since: isDateKey(a.since) ? a.since : '', attempts: attempts.slice(-12) }
    if (a.recheck === true) active.recheck = true
    if (a.starter === true) active.starter = true
    out.active = active
  } else if (a !== undefined && a !== null) {
    issues.push('coach.active')
  }
  if (Array.isArray(x.done)) {
    out.done = x.done
      .filter((d): d is { id: MissionState['done'][number]['id']; at: string } => isObj(d) && isMissionId(d.id) && isDateKey(d.at))
      .map((d) => ({ id: d.id, at: d.at }))
      .slice(-MAX_DONE)
  } else if (x.done !== undefined) {
    issues.push('coach.done')
  }
  if (Array.isArray(x.lessons)) {
    out.lessons = [...new Set(x.lessons.filter((v): v is string => isStr(v) && v.length <= 40))].slice(-MAX_LESSONS)
  } else if (x.lessons !== undefined) {
    issues.push('coach.lessons')
  }
  return out
}

function normSeason(x: unknown): ArchivedSeason | null {
  if (!isObj(x)) return null
  if (!isNum(x.final) || !isNum(x.market) || !isNum(x.cash)) return null
  if (!isCount(x.days) || !isCount(x.beatDays) || !isBool(x.medal)) return null
  return { final: x.final, market: x.market, cash: x.cash, days: x.days, beatDays: x.beatDays, medal: x.medal }
}

/** A record of entries, keeping the ones `norm` accepts and the keys `okKey` accepts. */
function normRecord<T>(
  x: unknown,
  okKey: (k: string) => boolean,
  norm: (v: unknown, path: string) => T | null,
  issues: string[],
  path: string,
): Record<string, T> {
  const out: Record<string, T> = {}
  if (x === undefined) return out
  if (!isObj(x)) {
    issues.push(path)
    return out
  }
  for (const [k, v] of Object.entries(x)) {
    const n = okKey(k) ? norm(v, `${path}.${k}`) : null
    if (n === null) issues.push(`${path}.${k}`)
    else out[k] = n
  }
  return out
}

/** Turns any object into a valid current-version save, noting every repair in `issues`. */
export function normalize(data: Json, issues: string[] = []): SaveFile {
  const f = emptySave()
  f.daily = normRecord(data.daily, isDateKey, (v, p) => normDaily(v, issues, p), issues, 'daily')

  if (isObj(data.practice)) {
    const p = data.practice
    f.practice.rounds = field(p, 'rounds', isCount, 0, issues, 'practice')
    f.practice.traded = field(p, 'traded', isCount, 0, issues, 'practice')
    f.practice.best = field(p, 'best', (v): v is number | null => v === null || isNum(v), null, issues, 'practice')
  } else if (data.practice !== undefined) {
    issues.push('practice')
  }

  f.unlockCredit = field(data, 'unlockCredit', isCount, 0, issues, '')
  f.seenIntro = field(data, 'seenIntro', isBool, false, issues, '')

  if (Array.isArray(data.habits)) {
    const seen = new Set<string>()
    data.habits.forEach((h, i) => {
      const r = normHabit(h, issues, `habits.${i}`)
      if (!r) issues.push(`habits.${i}`)
      else if (!seen.has(r.id)) {
        seen.add(r.id)
        f.habits.push(r)
      }
    })
    f.habits = f.habits.slice(-HABIT_HISTORY)
  } else if (data.habits !== undefined) {
    issues.push('habits')
  }

  if (isObj(data.settings)) {
    const s = data.settings
    for (const k of TOGGLE_KEYS) f.settings[k] = field(s, k, isBool, DEFAULT_SETTINGS[k], issues, 'settings')
    if (s.nick !== undefined) {
      const nick = s.nick === '' ? '' : cleanName(s.nick)
      if (nick === null) issues.push('settings.nick')
      f.settings.nick = nick ?? ''
    }
  } else if (data.settings !== undefined) {
    issues.push('settings')
  }

  if (Array.isArray(data.frozen)) {
    const good = data.frozen.filter(isDateKey)
    if (good.length !== data.frozen.length) issues.push('frozen')
    f.frozen = [...new Set(good)].sort()
  } else if (data.frozen !== undefined) {
    issues.push('frozen')
  }

  f.seasons = normRecord(data.seasons, isSeasonKey, normSeason, issues, 'seasons')

  // --- coaching ---
  f.coach = normCoach(data.coach, issues)
  if (Array.isArray(data.seenSeasons)) {
    f.seenSeasons = [...new Set(data.seenSeasons.filter(isSeasonKey))].sort().slice(-36)
  } else if (data.seenSeasons !== undefined) {
    issues.push('seenSeasons')
  }
  f.pendingChallenge = field(data, 'pendingChallenge', (v): v is string | null => v === null || isChallengeCode(v), null, issues, '')
  return f
}

// ---------------------------------------------------------------------------
// Migrations: MIGRATIONS[n] turns a version-n document into version n + 1.
// Each must tolerate garbage (normalize runs afterwards and cleans up).

const MIGRATIONS: Record<number, (d: Json) => Json> = {
  /**
   * v1 → v2: held becomes run-length coded (normalize does it), settings,
   * freezes and the season archive appear (defaults), and unlocks start
   * counting only rounds with trades. Existing players keep their progress:
   * old practice rounds all count as traded, and finished dailies without a
   * trade (which v1 counted) move into unlockCredit.
   */
  1(d) {
    let idleDailies = 0
    if (isObj(d.daily)) {
      for (const e of Object.values(d.daily)) {
        if (isObj(e) && e.abandoned !== true && !(isNum(e.trades) && e.trades > 0)) idleDailies++
      }
    }
    const practice = isObj(d.practice)
      ? { ...d.practice, traded: isCount(d.practice.rounds) ? d.practice.rounds : 0 }
      : d.practice
    return { ...d, v: 2, practice, unlockCredit: idleDailies }
  },
}

export type Loaded = {
  file: SaveFile
  /** Stored by newer code: never write. */
  readOnly: boolean
  /** The raw text was corrupt, repaired or migrated; back it up before any write. */
  backup: boolean
  issues: string[]
}

/** Raw stored text → a valid save. Pure; never throws. */
export function parseSave(raw: string | null): Loaded {
  if (raw === null || raw === '') return { file: emptySave(), readOnly: false, backup: false, issues: [] }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = undefined
  }
  if (!isObj(parsed)) return { file: emptySave(), readOnly: false, backup: true, issues: ['json'] }

  const issues: string[] = []
  const v = parsed.v
  if (Number.isSafeInteger(v) && (v as number) > SAVE_VERSION) {
    // Best effort view of a newer file; the fields we know are kept compatible.
    return { file: normalize(parsed, []), readOnly: true, backup: false, issues: [] }
  }
  let data = parsed
  let from = v as number
  if (!Number.isSafeInteger(v) || from < 1) {
    // No usable version: salvage what we can as if it were v1.
    issues.push('v')
    from = 1
  }
  for (let n = from; n < SAVE_VERSION; n++) data = MIGRATIONS[n](data)
  const file = normalize(data, issues)
  // Migrated files are backed up too: a safety net should a migration be wrong.
  return { file, readOnly: false, backup: issues.length > 0 || from < SAVE_VERSION, issues }
}

// ---------------------------------------------------------------------------
// The live checkpoint: a small record under its own key, so a running daily
// round never rewrites the whole save. Loading folds it into the abandoned
// placeholder it belongs to; finishing the round removes it.

export const LIVE_KEY = 'hold.live'

type LiveCheckpoint = { key: string; yourReturn: number; held: string }

export function parseLive(raw: string | null): LiveCheckpoint | null {
  if (!raw) return null
  try {
    const x: unknown = JSON.parse(raw)
    if (!isObj(x) || !isDateKey(x.key) || !isNum(x.yourReturn) || x.yourReturn < -1) return null
    if (!isStr(x.held) || decodeHeld(x.held) === null) return null
    return { key: x.key, yourReturn: x.yourReturn, held: x.held }
  } catch {
    return null
  }
}

/** Applies a checkpoint to its day, only while that day is still an abandoned placeholder. */
function foldLive(f: SaveFile, live: LiveCheckpoint | null): boolean {
  const entry = live && f.daily[live.key]
  if (!live || !entry?.abandoned) return false
  if (entry.yourReturn === live.yourReturn && entry.held === live.held) return false
  f.daily[live.key] = { ...entry, yourReturn: live.yourReturn, held: live.held }
  return true
}

// ---------------------------------------------------------------------------
// Backends

/**
 * Where the save text lives. read() may throw when storage is blocked; the
 * store then plays from memory and never writes blind. write() signals
 * failure by throwing, or by returning a promise that rejects (async native
 * storage). backup() stores a copy of a corrupt file somewhere else.
 * readLive()/writeLive() hold the live checkpoint (null removes it); a
 * backend without them gets checkpoints written into the save itself.
 */
export type StorageBackend = {
  read(): string | null
  write(s: string): void | Promise<unknown>
  backup?(raw: string): void
  readLive?(): string | null
  writeLive?(s: string | null): void | Promise<unknown>
}

function localStorageBackend(key = SAVE_KEY, backupKey = BACKUP_KEY, liveKey = LIVE_KEY): StorageBackend {
  return {
    read: () => localStorage.getItem(key),
    write: (s) => localStorage.setItem(key, s),
    backup: (raw) => localStorage.setItem(backupKey, raw),
    readLive: () => localStorage.getItem(liveKey),
    writeLive: (s) => (s === null ? localStorage.removeItem(liveKey) : localStorage.setItem(liveKey, s)),
  }
}

/**
 * Keeps the text in memory and mirrors every write to `write`. Used by
 * hydrate() for platforms whose storage loads asynchronously, and by tests.
 * The live checkpoint is kept in memory too, mirrored to `live.write`.
 */
export function memoryBackend(
  initial: string | null = null,
  write: (s: string) => void | Promise<unknown> = () => {},
  backup?: (raw: string) => void,
  live: { initial?: string | null; write?: (s: string | null) => void | Promise<unknown> } = {},
): Required<Pick<StorageBackend, 'readLive' | 'writeLive'>> & StorageBackend & { peek(): string | null; peekLive(): string | null } {
  let mem = initial
  let liveMem = live.initial ?? null
  return {
    read: () => mem,
    write(s) {
      mem = s
      return write(s)
    },
    backup,
    readLive: () => liveMem,
    writeLive(s) {
      liveMem = s
      return live.write?.(s)
    },
    peek: () => mem,
    peekLive: () => liveMem,
  }
}

/** Storage that has not answered yet: the store goes blind (memory only, nothing written). */
export function blindBackend(): StorageBackend {
  const notLoaded = () => {
    throw new Error('storage not loaded')
  }
  return { read: notLoaded, write: notLoaded }
}

// ---------------------------------------------------------------------------
// The store

const isPromise = (x: unknown): x is Promise<unknown> => isObj(x) && typeof (x as { then?: unknown }).then === 'function'

type Snapshot = { raw: string | null; file: SaveFile; readOnly: boolean }

export function createStore(backend: StorageBackend) {
  /**
   * Parsed file for the raw text last seen. Reads use it as long as it is
   * not stale; every change re-reads the backend first (read-modify-write).
   * It goes stale when another tab writes (invalidate) or the backend changes.
   */
  let cache: Snapshot | null = null
  let stale = true
  /** The backend could not be read: play from memory, never overwrite blind. */
  let blind = false
  let writeFailed = false
  /** Set inside batch(): changes collect here and are written once at the end. */
  let batching: { snap: Snapshot; dirty: boolean } | null = null
  /** Daily keys whose placeholder this store instance (session) created. */
  const live = new Set<string>()
  const listeners = new Set<() => void>()

  /** A fresh read of the backend; parses again only when the text changed. */
  function load(): Snapshot {
    if (batching) return batching.snap
    let raw: string | null
    try {
      raw = backend.read()
      blind = false
    } catch {
      blind = true
      stale = false
      return (cache ??= { raw: null, file: emptySave(), readOnly: false })
    }
    stale = false
    if (cache && cache.raw === raw) return cache
    const loaded = parseSave(raw)
    if (loaded.backup && raw) {
      try {
        backend.backup?.(raw)
      } catch {
        // Nowhere to put it; the repaired file is still better than a white screen.
      }
    }
    try {
      foldLive(loaded.file, parseLive(backend.readLive?.() ?? null))
    } catch {
      // No live checkpoint to read.
    }
    cache = { raw, file: loaded.file, readOnly: loaded.readOnly }
    return cache
  }

  /** The cached file for reads; re-reads only when stale. */
  function current(): Snapshot {
    if (batching) return batching.snap
    if (cache && !stale) return cache
    return load()
  }

  const file = () => current().file

  /** Writes a changed snapshot out (or keeps it in memory when it must not be written). */
  function commit(snap: Snapshot) {
    if (snap.readOnly || blind) {
      // Newer save or unreadable storage: keep the change for this session only.
      if (blind) writeFailed = true
      cache = snap
      return
    }
    const text = JSON.stringify(snap.file)
    try {
      const result = backend.write(text)
      writeFailed = false
      cache = { raw: text, file: snap.file, readOnly: false }
      if (isPromise(result)) result.catch(() => (writeFailed = true))
    } catch {
      // Full or blocked storage. Keep the change in memory against the old
      // raw text, so this session still sees it and the next write retries.
      writeFailed = true
      cache = { raw: snap.raw, file: snap.file, readOnly: false }
    }
  }

  /**
   * Read-modify-write: fresh read, apply `change`, write the whole file.
   * `change` returns false when it changed nothing, which skips the write.
   * Inside batch() the change joins the batch's single write.
   */
  function mutate(change: (f: SaveFile) => boolean) {
    if (batching) {
      if (change(batching.snap.file)) batching.dirty = true
      return
    }
    const snap = load()
    if (change(snap.file)) commit(snap)
  }

  function writeLive(text: string | null): boolean {
    if (!backend.writeLive) return false
    try {
      const result = backend.writeLive(text)
      if (isPromise(result)) result.catch(() => (writeFailed = true))
    } catch {
      writeFailed = true
    }
    return true
  }

  const decode = (d: StoredDaily): SavedDaily => ({ ...d, held: decodeHeld(d.held) ?? [] })

  const store = {
    /**
     * Runs `fn` as one read-modify-write: every change inside it lands in a
     * single write at the end, against one fresh read at the start. Reads
     * inside see the changes made so far. Nested batches join the outer one.
     */
    batch<T>(fn: () => T): T {
      if (batching) return fn()
      batching = { snap: load(), dirty: false }
      try {
        return fn()
      } finally {
        const b = batching
        batching = null
        if (b.dirty) commit(b.snap)
      }
    },
    daily(key: string): SavedDaily | undefined {
      const d = file().daily[key]
      return d && decode(d)
    },
    /**
     * Fresh check for play at go-live: true when today's daily has no entry
     * at all, in this tab or any other.
     */
    canStartDaily(key: string): boolean {
      return !load().file.daily[key]
    },
    /**
     * Called the moment a daily round goes live, so reloading mid-round cannot
     * be used to fish for a better chart run. Returns false when an entry
     * already exists (finished or abandoned, maybe by another tab), or when
     * the round could not be recorded (read-only or unreadable storage, or
     * the placeholder write failed): the round must not be played. Only the
     * store that created the placeholder may checkpoint or finish it.
     */
    startDaily(key: string, buyHoldReturn: number): boolean {
      const snap = load()
      if (snap.readOnly || blind) return false
      let started = false
      mutate((f) => {
        if (f.daily[key]) return false
        f.daily[key] = { yourReturn: 0, buyHoldReturn, held: '', trades: 0, title: '중간에 나갔어요', abandoned: true }
        live.add(key)
        return (started = true)
      })
      if (started && writeFailed && !batching) {
        // Not stored: a reload could play it again, so don't play it at all.
        delete current().file.daily[key]
        live.delete(key)
        return false
      }
      return started
    },
    /**
     * Saves a finished daily. Writes only over a missing entry or this
     * session's own placeholder, so a day is never recorded twice. Returns
     * whether it was saved.
     */
    recordDaily(key: string, entry: SavedDaily): boolean {
      let saved = false
      mutate((f) => {
        const existing = f.daily[key]
        if (existing && !(existing.abandoned && live.has(key))) return false
        f.daily[key] = { ...entry, held: encodeHeld(entry.held) }
        // Finishing our own round in a month another tab already closed: the
        // archive took the checkpoint, so take the final result instead.
        // (Any other late entry leaves a closed month alone.)
        const season = seasonOf(key)
        if (existing && f.seasons[season]) f.seasons[season] = archiveSeason(f.daily, season)
        return (saved = true)
      })
      if (saved && live.delete(key)) writeLive(null)
      return saved
    },
    /**
     * Checkpoint a live daily round, so quitting by reload or app kill keeps
     * the result so far instead of 0%. Only touches this session's
     * placeholder. Cheap: it writes the small live record (LIVE_KEY), not the
     * save; loading folds it back in.
     */
    progressDaily(key: string, progress: { yourReturn: number; held: boolean[] }) {
      const snap = current()
      const entry = snap.file.daily[key]
      if (!entry?.abandoned || !live.has(key)) return
      const checkpoint: LiveCheckpoint = { key, yourReturn: progress.yourReturn, held: encodeHeld(progress.held) }
      // This session sees it at once.
      snap.file.daily[key] = { ...entry, yourReturn: checkpoint.yourReturn, held: checkpoint.held }
      if (snap.readOnly || blind) return
      if (!writeLive(JSON.stringify(checkpoint))) {
        // No live slot: into the save itself (the whole file, so it costs more).
        mutate((f) => {
          foldLive(f, checkpoint)
          return true
        })
      }
    },
    /** `trades` decides whether the round counts toward unlocks. */
    recordPractice(yourReturn: number, trades: number) {
      mutate((f) => {
        f.practice.rounds += 1
        if (trades > 0) f.practice.traded += 1
        f.practice.best = f.practice.best === null ? yourReturn : Math.max(f.practice.best, yourReturn)
        return true
      })
    },
    practice(): SaveFile['practice'] {
      return { ...file().practice }
    },
    practiceBest(): number | null {
      return file().practice.best
    },
    /**
     * Consecutive days played, counting today if played, else ending
     * yesterday. Abandoned days don't count; frozen days bridge the gap.
     */
    streak(today: string) {
      const f = file()
      return streakDays(playedDays(f.daily), new Set(f.frozen), today)
    },
    streakState(today: string): StreakState {
      const f = file()
      return streakState(playedDays(f.daily), new Set(f.frozen), today)
    },
    /**
     * Run on app open: spends freeze tokens on the days missed since the
     * last played day, if there are enough. Returns the newly frozen days,
     * newest first (empty when nothing changed).
     */
    applyStreakFreezes(today: string): string[] {
      let added: string[] = []
      mutate((f) => {
        added = freezesToApply(playedDays(f.daily), new Set(f.frozen), today)
        if (!added.length) return false
        f.frozen = [...f.frozen, ...added].sort()
        return true
      })
      return added
    },
    recordHabit(record: HabitRecord) {
      mutate((f) => {
        if (f.habits.some((h) => h.id === record.id)) return false
        f.habits.push(record)
        f.habits = f.habits.slice(-HABIT_HISTORY)
        return true
      })
    },
    habitRecords(): HabitRecord[] {
      return [...file().habits]
    },
    /** Attach the luck-test percentile once the result screen has computed it. */
    setLuck(id: string, percentile: number) {
      mutate((f) => {
        const i = f.habits.findIndex((h) => h.id === id)
        if (i < 0) return false
        f.habits[i] = { ...f.habits[i], luckPct: percentile }
        return true
      })
    },
    accountBefore(key: string) {
      return accountBefore(file().daily, key)
    },
    accountAfter(key: string) {
      return accountAfter(file().daily, key)
    },
    /** Account, market and cash ghosts for the season `key` is in, up to `key`. */
    seasonSummary(key: string): SeasonSummary {
      return seasonSummary(file().daily, key)
    },
    /**
     * Run on app open: archives every past month not archived yet. An
     * archive is computed once; only a daily finishing late into an archived
     * month (recordDaily) updates it. Returns the closed months.
     */
    closeSeasons(today: string): string[] {
      let closed: string[] = []
      mutate((f) => {
        closed = seasonsToClose(f.daily, f.seasons, today)
        for (const s of closed) f.seasons[s] = archiveSeason(f.daily, s)
        return closed.length > 0
      })
      return closed
    },
    /** Archived seasons, oldest first. */
    pastSeasons(): Array<ArchivedSeason & { season: string }> {
      const seasons = file().seasons
      return Object.keys(seasons)
        .sort()
        .map((season) => ({ season, ...seasons[season] }))
    },
    /** Every daily round, oldest first. */
    dailyHistory(): DailyHistoryItem[] {
      return dailyHistory(file().daily)
    },
    /**
     * Rounds that open new products: practice rounds with a trade, finished
     * dailies with a trade, plus credit carried over from v1 saves.
     */
    roundsPlayed() {
      const f = file()
      const dailies = Object.values(f.daily).filter((d) => !d.abandoned && d.trades > 0).length
      return f.practice.traded + f.unlockCredit + dailies
    },
    /** A product is open once you have played enough, or met it as a daily chart. */
    isUnlocked(key: ProductKey) {
      if (store.roundsPlayed() >= PRODUCTS[key].unlockAt) return true
      return Object.values(file().daily).some((d) => d.product === key)
    },
    unlockedProducts(): ProductKey[] {
      return PRODUCT_ORDER.filter((k) => store.isUnlocked(k))
    },
    seenIntro() {
      return file().seenIntro
    },
    markIntroSeen() {
      mutate((f) => {
        if (f.seenIntro) return false
        return (f.seenIntro = true)
      })
    },
    getSettings(): Settings {
      return { ...file().settings }
    },
    /**
     * Changes some settings. A nick that fails challenge.cleanName is stored
     * as '' (no name); otherwise it is stored cleaned.
     */
    updateSettings(partial: Partial<Settings>): Settings {
      mutate((f) => {
        let changed = false
        for (const k of TOGGLE_KEYS) {
          const v = partial[k]
          if (isBool(v) && f.settings[k] !== v) {
            f.settings[k] = v
            changed = true
          }
        }
        if (partial.nick !== undefined) {
          const nick = cleanName(partial.nick) ?? ''
          if (f.settings.nick !== nick) {
            f.settings.nick = nick
            changed = true
          }
        }
        return changed
      })
      return store.getSettings()
    },
    /** A friend's challenge code kept for after today's daily, or null. */
    pendingChallenge(): string | null {
      return file().pendingChallenge
    },
    /** Keep a challenge code to play later (null clears it, e.g. once used). Bad codes are ignored. */
    setPendingChallenge(code: string | null) {
      if (code !== null && !isChallengeCode(code)) return
      mutate((f) => {
        if (f.pendingChallenge === code) return false
        f.pendingChallenge = code
        return true
      })
    },
    // --- coaching -------------------------------------------------------------
    /** Mission state and seen lessons (a copy). */
    coach(): CoachSave {
      const c = file().coach
      return { active: c.active && { ...c.active, attempts: [...c.active.attempts] }, done: [...c.done], lessons: [...c.lessons] }
    },
    /**
     * Read-modify-write of the coaching state, so a round's mission verdict
     * is applied to the freshest file. `change` returns the new state, or
     * null to leave it alone. Returns what was stored.
     */
    updateCoach(change: (c: CoachSave) => CoachSave | null): CoachSave {
      mutate((f) => {
        const next = change(store.coach())
        if (!next) return false
        f.coach = normCoach(next, [])
        return true
      })
      return store.coach()
    },
    markLessonSeen(id: string) {
      store.updateCoach((c) => (c.lessons.includes(id) ? null : { ...c, lessons: [...c.lessons, id] }))
    },
    seenSeasons(): string[] {
      return [...file().seenSeasons]
    },
    markSeasonsSeen(seasons: string[]) {
      mutate((f) => {
        const all = [...new Set([...f.seenSeasons, ...seasons.filter(isSeasonKey)])].sort().slice(-36)
        if (all.length === f.seenSeasons.length && all.every((s, i) => s === f.seenSeasons[i])) return false
        f.seenSeasons = all
        return true
      })
    },
    /**
     * True after the latest write failed (storage full or blocked, or not
     * loaded yet); cleared by the next success. Async writes (Toss) set it
     * when their promise rejects.
     */
    lastWriteFailed() {
      return writeFailed
    },
    /** True when the save came from a newer app version: changes are not saved. */
    readOnly() {
      return current().readOnly
    },
    /**
     * Another tab wrote (or the backend was swapped): the next read goes back
     * to the backend, and subscribers are told. `reset` also forgets the
     * cached file and the write-failure flag (a new backend).
     */
    invalidate(reset = false) {
      stale = true
      if (reset) {
        cache = null
        writeFailed = false
        blind = false
      }
      for (const fn of listeners) fn()
    },
    /** Called when another tab changes the save. Returns an unsubscribe function. */
    onChange(fn: () => void): () => void {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
  return store
}

export type Store = ReturnType<typeof createStore>

// ---------------------------------------------------------------------------
// The app's store. Its backend can be swapped before first render.

let backend: StorageBackend = localStorageBackend()

export const save: Store = createStore({
  read: () => backend.read(),
  write: (s) => backend.write(s),
  backup: (raw) => backend.backup?.(raw),
  readLive: () => backend.readLive?.() ?? null,
  get writeLive() {
    const b = backend
    return b.writeLive && ((s: string | null) => b.writeLive!(s))
  },
})

/** Swap where the save lives (default: localStorage). */
export function configureStorage(next: StorageBackend) {
  backend = next
  save.invalidate(true)
}

/** Where builds before the save's settings.nick kept the challenge nickname. */
export const LEGACY_NICK_KEY = 'hold.nick'

/**
 * Moves a nickname left under LEGACY_NICK_KEY into settings.nick, once. The
 * old key is removed only after the save took the name, and a name already
 * in the save wins. Run at boot, after the store is ready. Never throws.
 */
export function migrateLegacyNick(store: Store = save) {
  try {
    const raw = localStorage.getItem(LEGACY_NICK_KEY)
    if (raw === null) return
    const name = cleanName(raw)
    if (name && !store.getSettings().nick) store.updateSettings({ nick: name })
    if (store.lastWriteFailed() || store.readOnly()) return
    localStorage.removeItem(LEGACY_NICK_KEY)
  } catch {
    // No localStorage (node) or blocked: nothing to migrate.
  }
}

/**
 * For platforms whose storage loads asynchronously (Toss mini-app native
 * storage): load the text first, then call this before the first render.
 * Reads come from memory; every write is mirrored to `write`, whose thrown
 * error or rejected promise sets lastWriteFailed().
 */
export function hydrate(
  raw: string | null,
  write: (s: string) => void | Promise<unknown>,
  backup?: (raw: string) => void,
  live?: { initial?: string | null; write?: (s: string | null) => void | Promise<unknown> },
) {
  configureStorage(memoryBackend(raw, write, backup, live))
}

/**
 * Sends only the latest text: while one write is in flight, newer texts
 * replace each other and the last one goes next. Every caller gets a promise
 * that settles when the queue drains, and rejects if the last write failed.
 */
export function coalescedWriter<T>(set: (value: T) => Promise<unknown>): (value: T) => Promise<void> {
  let queued: { value: T } | null = null
  let running: Promise<void> | null = null
  return (value) => {
    queued = { value }
    running ??= (async () => {
      // Let changes made in the same task join the first write.
      await Promise.resolve()
      let failed = false
      try {
        while (queued) {
          const next: { value: T } = queued
          queued = null
          try {
            await set(next.value)
            failed = false
          } catch {
            failed = true
          }
        }
      } finally {
        running = null
      }
      if (failed) throw new Error('storage write failed')
    })()
    return running
  }
}

/** A timeout is not a value: a stored null and "no answer yet" stay apart. */
export type Timed<T> = { status: 'value'; value: T } | { status: 'timeout' } | { status: 'error'; error: unknown }

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<Timed<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<Timed<T>>((resolve) => {
    timer = setTimeout(() => resolve({ status: 'timeout' }), ms)
  })
  const settled = p.then(
    (value): Timed<T> => ({ status: 'value', value }),
    (error): Timed<T> => ({ status: 'error', error }),
  )
  return Promise.race([settled, timeout]).finally(() => clearTimeout(timer))
}

/** The shell's async key-value storage (Platform.storage). */
export type AsyncStorage = {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

/**
 * Boot for async storage (Toss). Waits up to `timeoutMs` for the save and
 * the live checkpoint. In time: the store reads them from memory and mirrors
 * writes back, coalesced so only the latest text goes out. Too slow: the
 * store goes blind (empty, memory-only, never writes, lastWriteFailed) so a
 * slow read can never overwrite the real save; when the answer comes, the
 * store is hydrated with it and `onLate` runs (re-render). A failed read
 * keeps the store blind for the session. Returns whether it loaded in time.
 */
export async function hydrateAsync(
  storage: AsyncStorage,
  opts: { timeoutMs: number; onLate?: () => void; onError?: (err: unknown) => void },
): Promise<boolean> {
  const loading = Promise.all([storage.get(SAVE_KEY), storage.get(LIVE_KEY).catch(() => null)])
  const ready = ([raw, liveRaw]: [string | null, string | null]) =>
    hydrate(
      raw,
      coalescedWriter((s: string) => storage.set(SAVE_KEY, s)),
      (backup) => void storage.set(BACKUP_KEY, backup).catch(() => {}),
      { initial: liveRaw, write: coalescedWriter((s: string | null) => storage.set(LIVE_KEY, s ?? '')) },
    )
  const first = await withTimeout(loading, opts.timeoutMs)
  if (first.status === 'value') {
    ready(first.value)
    return true
  }
  configureStorage(blindBackend())
  if (first.status === 'error') {
    opts.onError?.(first.error)
    return false
  }
  loading.then(
    (late) => {
      ready(late)
      opts.onLate?.()
    },
    (err) => opts.onError?.(err),
  )
  return false
}

// Another tab wrote the save: the next read goes back to storage, and
// screens can re-render through save.onChange.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e.key === null || e.key === SAVE_KEY) save.invalidate()
  })
}
