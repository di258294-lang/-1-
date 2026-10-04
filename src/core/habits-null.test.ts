import { describe, expect, it } from 'vitest'
import {
  analyzeRound,
  HABIT_KEYS,
  habitTrend,
  profileFrom,
  roundInsight,
  tickVolatility,
  TYPES,
  type HabitRecord,
  type RoundHabits,
  NO_HABIT_TYPES,
  type TypeKey,
} from './habits'
import { luckTest } from './luck'
import { generateMarket, playPrice, type Market, type RoundLength } from './market'
import type { ProductKey } from './products'
import { createRng, type Rng } from './rng'
import { skillCopy, skillTest } from './skill'

/**
 * Calibration against traders with no habit at all, and scripted traders
 * with one strong habit each. The engine's volatility and tails may change;
 * these checks are about the diagnosis staying honest whatever they are.
 */

const PRODUCTS: ProductKey[] = ['stock', 'coin', 'gold', 'bond', 'lev2']

type Style = (m: Market, rng: Rng) => boolean[]

/** Presses at random times for random lengths, blind to profit and loss. */
const randomTrader: Style = (m, rng) => {
  const n = m.playTicks
  const held = new Array<boolean>(n).fill(false)
  const want = rng.int(3, 6)
  let placed = 0
  for (let tries = 0; placed < want && tries < 500; tries++) {
    const len = rng.int(10, 80)
    const a = rng.int(0, n - len - 1)
    let free = true
    for (let t = Math.max(0, a - 2); t < Math.min(n, a + len + 2); t++) if (held[t]) free = false
    if (!free) continue
    for (let t = a; t < a + len; t++) held[t] = true
    placed++
  }
  return held
}

/** Buys, sells at the first small gain, and never sells at a loss. */
const bagHolder: Style = (m, rng) => {
  const n = m.playTicks
  const target = tickVolatility(m) * Math.sqrt(10)
  const held = new Array<boolean>(n).fill(false)
  let t = rng.int(5, 30)
  while (t < n) {
    const entry = playPrice(m, t)
    while (t < n) {
      held[t] = true
      t++
      if (t < n && playPrice(m, t) > entry * (1 + target)) break
    }
    t += rng.int(5, 30)
  }
  return held
}

/** Taps over and over, 12 to 16 short trades a round. */
const masher: Style = (m, rng) => {
  const n = m.playTicks
  const held = new Array<boolean>(n).fill(false)
  const k = rng.int(12, 16)
  const slot = Math.floor(n / k)
  for (let i = 0; i < k; i++) {
    const a = i * slot + rng.int(0, Math.max(0, slot - 12))
    for (let t = a; t < Math.min(n, a + rng.int(3, 10)); t++) held[t] = true
  }
  return held
}

/** Buys right after the price jumped more than 2.5 sigma in 2 seconds. */
const chaser: Style = (m) => {
  const n = m.playTicks
  const vol = tickVolatility(m)
  const held = new Array<boolean>(n).fill(false)
  for (let t = 20; t < n; t++) {
    if (Math.log(playPrice(m, t) / playPrice(m, t - 20)) > 2.5 * vol * Math.sqrt(20)) {
      for (let k = t; k < Math.min(n, t + 20); k++) held[k] = true
      t += 25
    }
  }
  return held
}

/**
 * Stays in the market, cuts a loser at -1.5 sigma over 2 s and is back in
 * 0.5 s later, steps aside before bad filings and buys good ones, and ignores
 * rumors. A long cool-down after each stop would make the returns skewed
 * (many small cuts, one long ride): under the luck test's run-placement null
 * that ranks below the median even with no loss on average. Even this
 * version's edge (mean luck about 0.64) takes more rounds than a profile
 * window for the records skill card to tell it from luck, so it is rightly
 * left as 탐색 중 (not 기계형) until then.
 */
const disciplined: Style = (m) => {
  const n = m.playTicks
  const stop = 1.5 * tickVolatility(m) * Math.sqrt(20)
  const held = new Array<boolean>(n).fill(false)
  const outUntil = new Array<number>(n).fill(-1)
  for (const ev of m.news) {
    if (ev.kind !== 'filing' || ev.implied > 0) continue
    for (let t = ev.at + 1; t < Math.min(n, ev.impactAt + 10); t++) outUntil[t] = ev.impactAt + 10
  }
  const goodAt = new Set(m.news.filter((e) => e.kind === 'filing' && e.implied > 0).map((e) => e.at + 1))
  let holding = false
  let entry = 0
  let rest = 0
  for (let t = 0; t < n; t++) {
    const p = playPrice(m, t)
    if (holding) {
      if (outUntil[t] > t || p < entry * (1 - stop)) {
        holding = false
        rest = t + 5
      }
    } else if (outUntil[t] <= t && (t >= rest || goodAt.has(t))) {
      holding = true
      entry = p
    }
    held[t] = holding
  }
  return held
}

/** Buys only on good filings and holds through the move: clearly better timing, no habit. */
const filingReader: Style = (m) => {
  const held = new Array<boolean>(m.playTicks).fill(false)
  for (const e of m.news) {
    if (e.kind !== 'filing' || e.implied < 0) continue
    for (let t = e.at + 1; t < Math.min(m.playTicks, e.impactAt + 10); t++) held[t] = true
  }
  return held
}

/** One 0.3 s tap a round, to farm the "no bad habit" type. */
const tapper =
  (taps: number): Style =>
  (m, rng) => {
    const held = new Array<boolean>(m.playTicks).fill(false)
    for (let k = 0; k < taps; k++) {
      const a = rng.int(0, m.playTicks - 4)
      for (let t = a; t < a + 3; t++) held[t] = true
    }
    return held
  }

type Played = { market: Market; held: boolean[]; habits: RoundHabits; record: HabitRecord }

function play(style: Style, product: ProductKey, seed: number, length: RoundLength = 'short', rng?: Rng, luck = false): Played {
  const market = generateMarket(seed, product, length)
  const held = style(market, rng ?? createRng(seed ^ 0x5bd1e995))
  const habits = analyzeRound(market, held, 0)
  const record: HabitRecord = {
    id: `p:${seed}`,
    at: '',
    product,
    length,
    trades: habits.trades,
    heldRatio: held.filter(Boolean).length / held.length,
    scores: habits.scores,
    measurable: habits.measurable,
    counts: habits.counts,
    luckPct: luck ? (luckTest(market, held, 200)?.percentile ?? null) : null,
    evidence: habits.evidence,
  }
  return { market, held, habits, record }
}

/** Profiles of consecutive windows of rounds with trades, as the game stores them. */
function profiles(style: Style, product: ProductKey, rounds: number, window: number, seed0: number, luck = false) {
  const types: TypeKey[] = []
  const recs: HabitRecord[] = []
  for (let s = 0; recs.length < rounds && s < rounds * 3; s++) {
    const p = play(style, product, seed0 + s, 'short', undefined, luck)
    if (p.habits.trades > 0) recs.push(p.record)
  }
  for (let i = 0; i + window <= recs.length; i += window) types.push(profileFrom(recs.slice(i, i + window))!.type)
  return types
}

const share = (types: TypeKey[], k: TypeKey) => types.filter((t) => t === k).length / types.length
const majority = (types: TypeKey[]) => {
  const c = new Map<TypeKey, number>()
  for (const t of types) c.set(t, (c.get(t) ?? 0) + 1)
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

describe('tickVolatility', () => {
  it('matches the standard deviation of ordinary tick returns on every product', () => {
    for (const product of PRODUCTS) {
      const ratios: number[] = []
      const exceed: number[] = []
      for (let s = 0; s < 120; s++) {
        const m = generateMarket(9_000 + s, product)
        // History ticks have no news: the cleanest sample of everyday moves.
        const r: number[] = []
        for (let i = 1; i < m.historyTicks + m.playTicks; i++) {
          const t = i - m.historyTicks
          if (m.news.some((n) => Math.abs(n.impactAt - t) <= 1)) continue
          r.push(Math.log(m.prices[i] / m.prices[i - 1]))
        }
        const mu = r.reduce((a, b) => a + b, 0) / r.length
        const sd = Math.sqrt(r.reduce((a, x) => a + (x - mu) ** 2, 0) / (r.length - 1))
        const vol = tickVolatility(m)
        ratios.push(vol / sd)
        // "2 sigma over 2 seconds" should be about as rare as it sounds (2.3%).
        let hits = 0
        let windows = 0
        for (let t = 20; t <= m.playTicks; t += 5) {
          if (m.news.some((n) => n.impactAt > t - 20 && n.impactAt <= t)) continue
          windows++
          if (Math.log(playPrice(m, t) / playPrice(m, t - 20)) > 2 * vol * Math.sqrt(20)) hits++
        }
        exceed.push(hits / windows)
      }
      ratios.sort((a, b) => a - b)
      const median = ratios[ratios.length >> 1]
      expect(median, product).toBeGreaterThan(0.9)
      expect(median, product).toBeLessThan(1.1)
      const rate = exceed.reduce((a, b) => a + b, 0) / exceed.length
      expect(rate, product).toBeGreaterThan(0.005)
      expect(rate, product).toBeLessThan(0.06)
    }
  })
})

describe('traders with no habit', () => {
  const ROUNDS = 300
  const stats = PRODUCTS.map((product) => {
    const rng = createRng(4242)
    let holder = 0
    let warn = 0
    const recs: HabitRecord[] = []
    const insights: Array<{ h: RoundHabits; line: string; title: string; habit?: string }> = []
    for (let s = 0; s < ROUNDS; s++) {
      const p = play(randomTrader, product, 20_000 + s, 'short', rng)
      if (p.habits.scores.holder >= 0.5) holder++
      const ins = roundInsight(p.habits)
      if (ins.tone === 'warn') warn++
      insights.push({ h: p.habits, ...ins })
      if (p.habits.trades > 0) recs.push(p.record)
    }
    const types: TypeKey[] = []
    for (let i = 0; i + 10 <= recs.length; i += 5) types.push(profileFrom(recs.slice(i, i + 10))!.type)
    return { product, holder: holder / ROUNDS, warn: warn / ROUNDS, types, insights }
  })

  it('rarely shows a strong holder score in a round', () => {
    for (const s of stats) expect(s.holder, s.product).toBeLessThan(0.1)
  })

  it('rarely gets a warning card', () => {
    for (const s of stats) expect(s.warn, s.product).toBeLessThan(0.25)
  })

  it('gets the same holder share in its profile on every product', () => {
    const shares = stats.map((s) => share(s.types, 'holder'))
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThan(0.15)
    for (const x of shares) expect(x).toBeLessThan(0.15)
  })

  it('never hears a sentence its numbers contradict', () => {
    for (const s of stats) for (const i of s.insights) expectHonest(i.h, i)
  })
})

const expectNear = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol)

/** Pulls the numbers out of an insight line and checks them against the facts. */
function expectHonest(h: RoundHabits, ins: { title: string; line: string; habit?: string }) {
  const f = h.facts
  const nums = (ins.line.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
  expect(ins.line).not.toMatch(/NaN|Infinity|undefined/)
  expect(ins.line).not.toContain('—')
  if (ins.habit === 'chicken') {
    expect(f.missedAfterWin).toBeGreaterThan(0)
    expect(nums[0]).toBe(f.cleanWinExits)
    const moved = Number(ins.line.match(/([\d.]+)% 더 올랐어요/)![1])
    expect(moved).toBeGreaterThan(0)
    expectNear(moved, f.missedAfterWin * 100, 0.051)
  }
  if (ins.title === '수익은 빨리 팔고, 손실은 버텼어요') {
    expect(nums[0]).toBe(f.sellsUp)
    expect(nums[1]).toBe(f.sellsDown)
    const ratio = Number(ins.line.match(/([\d.]+)배/)![1])
    expect(ratio).toBeGreaterThanOrEqual(1.5)
    expectNear(ratio, f.sellRateUp / f.sellRateDown, 0.051)
  }
  if (ins.title === '손실을 끝까지 버텼어요') {
    expect(f.heldLossWorst).toBeLessThan(0)
    expect(Number(ins.line.match(/([\d.]+)배/)![1])).toBeGreaterThan(1)
    expectNear(Number(ins.line.match(/-([\d.]+)%/)![1]), -f.heldLossWorst * 100, 0.051)
  }
  if (ins.habit === 'scalper') expect(nums[0]).toBe(h.trades)
  if (ins.habit === 'chaser') {
    expect(nums[0]).toBe(h.trades)
    expect(nums[1]).toBe(f.chaseEntries)
    expect(f.chaseEntries).toBeGreaterThan(0)
  }
  if (ins.habit === 'rumor') {
    expect(nums[1]).toBeLessThanOrEqual(nums[0])
    expect(nums[1]).toBeGreaterThan(0)
  }
  if (ins.title === '공식 발표에 빠르게 반응했어요') expect(nums[1]).toBeLessThanOrEqual(nums[0])
  if (ins.title === '손실을 빨리 정리했어요') expect(f.lossTrades).toBeGreaterThan(0)
}

describe('scripted habits', () => {
  it('names a bag holder who never sells at a loss', () => {
    for (const product of ['stock', 'coin', 'gold'] as ProductKey[]) {
      const types = profiles(bagHolder, product, 60, 10, 31_000)
      expect(share(types, 'holder'), product).toBeGreaterThan(0.5)
    }
  })

  it('names a masher a scalper', () => {
    expect(majority(profiles(masher, 'stock', 50, 10, 32_000))).toBe('scalper')
  })

  it('names a buyer of 2.5 sigma spikes a chaser', () => {
    expect(majority(profiles(chaser, 'coin', 50, 10, 33_000))).toBe('chaser')
  })

  it('keeps random pressers out of 기계형, as the records skill card does', () => {
    // Before the shared gate, about 30% of these windows were told
    // "아무 때나 누른 것보다 타이밍이 나았어요". The card's bar (z ≥ 2.9) lets
    // about 0.2% of single looks through.
    const types = PRODUCTS.flatMap((product) => [
      ...profiles(randomTrader, product, 100, 5, 37_000, true),
      ...profiles(randomTrader, product, 100, 10, 37_500, true),
    ])
    expect(types.length).toBe(150)
    expect(share(types, 'machine')).toBeLessThan(0.02)
  })

  it('leaves a disciplined trader 탐색 중 until the skill card can tell their timing from luck', () => {
    // Mean luck about 0.64: real, but 5 rounds can't separate it from luck.
    const types = profiles(disciplined, 'stock', 50, 5, 34_000, true)
    expect(majority(types)).toBe('steady')
    for (const t of types) expect(['steady', 'machine']).toContain(t)
  })

  it('names a filing reader with clearly better timing a machine', () => {
    // Buys good filings only and holds through the move: mean luck about 0.93.
    const types = profiles(filingReader, 'stock', 50, 5, 34_500, true)
    expect(majority(types)).toBe('machine')
  })

  it('types a window 기계형 exactly when the records card shows its chance line', () => {
    let machines = 0
    let others = 0
    for (const style of [randomTrader, disciplined, filingReader]) {
      const recs: HabitRecord[] = []
      for (let s = 0; recs.length < 60 && s < 200; s++) {
        const p = play(style, 'gold', 38_000 + s, 'short', undefined, true)
        if (p.habits.trades > 0) recs.push(p.record)
      }
      for (let i = 5; i <= recs.length; i++) {
        const seen = recs.slice(0, i)
        const card = skillTest(seen.map((r) => r.luckPct))
        const type = profileFrom(seen)!.type
        expect(type === 'machine').toBe(card !== null && skillCopy(card).showsChance && NO_HABIT_TYPES.includes(type))
        if (type === 'machine') machines++
        else others++
      }
    }
    expect(machines).toBeGreaterThan(10)
    expect(others).toBeGreaterThan(10)
  })

  it('does not hand the machine type to a single-tap farmer', () => {
    for (const taps of [1, 3]) {
      const types = profiles(tapper(taps), 'stock', 50, 5, 35_000 + taps, true)
      expect(types).not.toContain('machine')
      expect(majority(types)).toBe('watcher')
    }
    expect(TYPES.watcher.name).toBe('관망형')
  })

  it('keeps every scripted insight consistent with its numbers', () => {
    const seen = new Set<string>()
    for (const style of [bagHolder, masher, chaser, disciplined]) {
      for (let s = 0; s < 30; s++) {
        const p = play(style, 'stock', 36_000 + s)
        const ins = roundInsight(p.habits)
        expectHonest(p.habits, ins)
        seen.add(ins.title)
      }
    }
    // The checks above really ran on each kind of warning.
    for (const title of ['수익은 빨리 팔고, 손실은 버텼어요', '너무 자주 사고팔았어요', '급하게 오른 뒤에 올라탔어요']) {
      expect(seen).toContain(title)
    }
  })
})

describe('habit trend: players who never change are rarely told they did', () => {
  /** Stored records of one style, cycling through the products. */
  function pool(style: Style, n: number, seed0: number) {
    const out: HabitRecord[] = []
    for (let i = 0; out.length < n && i < n * 3; i++) {
      const p = play(style, PRODUCTS[i % PRODUCTS.length], seed0 + i)
      if (p.habits.trades > 0) out.push(p.record)
    }
    return out
  }
  const pools = {
    random: pool(randomTrader, 250, 61_000),
    bagHolder: pool(bagHolder, 250, 62_000),
    chaser: pool(chaser, 250, 63_000),
    masher: pool(masher, 250, 64_000),
  }
  const draw = (rng: Rng, p: HabitRecord[]) => p[rng.int(0, p.length - 1)]
  const changed = (recs: HabitRecord[]) =>
    HABIT_KEYS.some((k) => {
      const t = habitTrend(recs, k)
      return !!t && t.change !== 'same'
    })

  it('says nothing before 25 measurable rounds', () => {
    expect(habitTrend(pools.bagHolder.slice(0, 24), 'holder')).toBeNull()
    expect(habitTrend(pools.bagHolder.slice(0, 25), 'holder')).not.toBeNull()
  })

  it('gives a false change at most 3% of the time, checked every 5 rounds from 25 to 40', () => {
    for (const [name, p] of Object.entries(pools)) {
      const rng = createRng(name.length * 977)
      const P = 300
      let ever = 0
      for (let i = 0; i < P; i++) {
        const recs = Array.from({ length: 40 }, () => draw(rng, p))
        if ([25, 30, 35, 40].some((r) => changed(recs.slice(0, r)))) ever++
      }
      expect(ever / P, name).toBeLessThanOrEqual(0.03)
    }
  })

  it('does not read regression to the mean as a change: the rounds that picked the profile are left out', () => {
    // Mixed players, never changing; keep those whose first 5 rounds looked most like a bag holder.
    const rng = createRng(5)
    const rows: Array<{ first: number; down: boolean }> = []
    for (let i = 0; i < 1500; i++) {
      const pi = rng.next() * 0.6
      const recs = Array.from({ length: 25 }, () => draw(rng, rng.next() < pi ? pools.bagHolder : pools.random))
      const first = recs.slice(0, 5).reduce((a, r) => a + r.scores.holder, 0) / 5
      rows.push({ first, down: habitTrend(recs, 'holder')?.change === 'down' })
    }
    rows.sort((a, b) => b.first - a.first)
    const top = rows.slice(0, rows.length / 5)
    expect(top.filter((r) => r.down).length / top.length).toBeLessThanOrEqual(0.03)
  })

  it('still sees a real change: bag holder for 15 rounds, then random', () => {
    const rng = createRng(78)
    const P = 300
    let seen = 0
    for (let i = 0; i < P; i++) {
      const recs = Array.from({ length: 30 }, (_, r) => draw(rng, r < 15 ? pools.bagHolder : pools.random))
      if (habitTrend(recs, 'holder')?.change === 'down') seen++
    }
    expect(seen / P).toBeGreaterThan(0.25)
  })
})
