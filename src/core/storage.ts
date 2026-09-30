import { previousKey } from './daily'

export type SavedDaily = {
  yourReturn: number
  buyHoldReturn: number
  held: boolean[]
  trades: number
  title: string
  /** Set when a daily round started but never finished (reload, app kill). */
  abandoned?: boolean
}

type SaveFile = {
  v: 1
  daily: Record<string, SavedDaily>
  practice: { rounds: number; best: number | null }
  seenIntro: boolean
}

const KEY = 'hold.save.v1'

function empty(): SaveFile {
  return { v: 1, daily: {}, practice: { rounds: 0, best: null }, seenIntro: false }
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
  dailyStats() {
    const entries = Object.values(file().daily)
    if (!entries.length) return null
    const beat = entries.filter((e) => e.yourReturn > e.buyHoldReturn).length
    const avg = entries.reduce((s, e) => s + e.yourReturn, 0) / entries.length
    return { played: entries.length, beat, avg }
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
