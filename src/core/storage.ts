import { previousKey } from './daily'
import { HABIT_KEYS, type HabitRecord, type HabitScores } from './habits'
import { PRODUCT_ORDER, PRODUCTS, type ProductKey } from './products'
import { accountAfter, accountBefore } from './season'

export type SavedDaily = {
  yourReturn: number
  buyHoldReturn: number
  held: boolean[]
  trades: number
  title: string
  product?: ProductKey
  /** Set when a daily round started but never finished (reload, app kill). */
  abandoned?: boolean
}

type SaveFile = {
  v: 1
  daily: Record<string, SavedDaily>
  practice: { rounds: number; best: number | null }
  seenIntro: boolean
  /**
   * Analyzed rounds that had at least one trade, oldest first. Saves from
   * before records existed hold only { id, scores }; see asRecord().
   */
  habits: Array<HabitRecord | { id: string; scores: HabitScores }>
}

const HABIT_HISTORY = 30

/** Fills defaults for habit entries saved before full records existed. */
function asRecord(h: HabitRecord | { id: string; scores: HabitScores }): HabitRecord {
  if ('measurable' in h) return h
  const all = Object.fromEntries(HABIT_KEYS.map((k) => [k, true])) as HabitRecord['measurable']
  return {
    id: h.id,
    at: '',
    product: 'stock',
    length: 'short',
    trades: 1,
    heldRatio: 0,
    scores: h.scores,
    measurable: all,
    counts: { sellUp: 0, expUp: 0, sellDown: 0, expDown: 0 },
    luckPct: null,
  }
}

const KEY = 'hold.save.v1'

function empty(): SaveFile {
  return { v: 1, daily: {}, practice: { rounds: 0, best: null }, seenIntro: false, habits: [] }
}

function load(): SaveFile {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return empty()
    const parsed = JSON.parse(raw) as SaveFile
    return parsed?.v === 1 ? { ...empty(), ...parsed } : empty()
  } catch {
    return empty()
  }
}

function persist(file: SaveFile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(file))
  } catch {
    // Private mode or full storage. The game still works for this session.
  }
}

let cache: SaveFile | null = null
const file = () => (cache ??= load())

export const save = {
  daily(key: string): SavedDaily | undefined {
    return file().daily[key]
  },
  /**
   * Called the moment a daily round goes live, so reloading mid-round cannot
   * be used to fish for a better chart run. Finishing overwrites it.
   */
  startDaily(key: string, buyHoldReturn: number) {
    const f = file()
    if (f.daily[key]) return
    f.daily[key] = { yourReturn: 0, buyHoldReturn, held: [], trades: 0, title: '중간에 나갔어요', abandoned: true }
    persist(f)
  },
  recordDaily(key: string, entry: SavedDaily) {
    const f = file()
    const existing = f.daily[key]
    if (existing && !existing.abandoned) return
    f.daily[key] = entry
    persist(f)
  },
  recordPractice(yourReturn: number) {
    const f = file()
    f.practice.rounds += 1
    f.practice.best = f.practice.best === null ? yourReturn : Math.max(f.practice.best, yourReturn)
    persist(f)
  },
  practice() {
    return file().practice
  },
  /** Consecutive days played, counting today if played, else ending yesterday. */
  streak(today: string) {
    const d = file().daily
    let key = d[today] ? today : previousKey(today)
    let n = 0
    while (d[key]) {
      n++
      key = previousKey(key)
    }
    return n
  },
  recordHabit(record: HabitRecord) {
    const f = file()
    if (f.habits.some((h) => h.id === record.id)) return
    f.habits.push(record)
    f.habits = f.habits.slice(-HABIT_HISTORY)
    persist(f)
  },
  habitRecords(): HabitRecord[] {
    return file().habits.map(asRecord)
  },
  /** Attach the luck-test percentile once the result screen has computed it. */
  setLuck(id: string, percentile: number) {
    const f = file()
    const i = f.habits.findIndex((h) => h.id === id)
    if (i < 0) return
    f.habits[i] = { ...asRecord(f.habits[i]), luckPct: percentile }
    persist(f)
  },
  /**
   * Checkpoint a live daily round, so quitting by reload or app kill keeps
   * the result so far instead of 0%. Only touches unfinished entries.
   */
  progressDaily(key: string, progress: { yourReturn: number; held: boolean[] }) {
    const f = file()
    const entry = f.daily[key]
    if (!entry?.abandoned) return
    f.daily[key] = { ...entry, yourReturn: progress.yourReturn, held: progress.held }
    persist(f)
  },
  accountBefore(key: string) {
    return accountBefore(file().daily, key)
  },
  accountAfter(key: string) {
    return accountAfter(file().daily, key)
  },
  /** Finished rounds of any kind; opens new products in practice. */
  roundsPlayed() {
    const f = file()
    return f.practice.rounds + Object.values(f.daily).filter((d) => !d.abandoned).length
  },
  /** A product is open once you have played enough, or met it as a daily chart. */
  isUnlocked(key: ProductKey) {
    const f = file()
    if (this.roundsPlayed() >= PRODUCTS[key].unlockAt) return true
    return Object.values(f.daily).some((d) => d.product === key)
  },
  unlockedProducts(): ProductKey[] {
    return PRODUCT_ORDER.filter((k) => this.isUnlocked(k))
  },
  seenIntro() {
    return file().seenIntro
  },
  markIntroSeen() {
    const f = file()
    f.seenIntro = true
    persist(f)
  },
}
