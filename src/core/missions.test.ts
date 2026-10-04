import { describe, expect, it } from 'vitest'
import { analyzeRound, tickVolatility, type Profile } from './habits'
import { generateMarket, playPrice, type Market, type RoundLength } from './market'
import {
  advanceMission,
  emptyMissionState,
  G0,
  filingNeed,
  isComplete,
  judgeMission,
  LONG_HOLD_SEC,
  MISSION_IDS,
  MISSIONS,
  pickMission,
  progressOf,
  progressShort,
  progressText,
  roundMetrics,
  STARTER_SWITCH_REASON,
  stopAllowance,
  stopChanceCount,
  WEEK_SWITCH_REASON,
  weekOf,
  type Attempt,
  type MissionId,
  type MissionState,
  type RoundMetrics,
  type Verdict,
} from './missions'
import type { ProductKey } from './products'
import { createRng, type Rng } from './rng'

const PRODUCTS: ProductKey[] = ['stock', 'coin', 'gold', 'bond', 'lev2']

type Style = (m: Market, rng: Rng) => boolean[]

/** Ticks scale: short rounds are 400 ticks, long ones 7.5 times that. */
const scale = (m: Market) => m.playTicks / 400

function randomRuns(m: Market, rng: Rng, want: number, lo: number, hi: number) {
  const held = new Array<boolean>(m.playTicks).fill(false)
  for (let placed = 0, tries = 0; placed < want && tries < 50 * want + 500; tries++) {
    const len = rng.int(lo, hi)
    const a = rng.int(0, m.playTicks - len - 1)
    let free = true
    for (let t = Math.max(0, a - 2); t < Math.min(m.playTicks, a + len + 2); t++) if (held[t]) free = false
    if (!free) continue
    for (let t = a; t < a + len; t++) held[t] = true
    placed++
  }
  return held
}

/** Random presses, blind to profit and loss: 3-6 trades per 40 s, 1-8 s each. */
const random: Style = (m, rng) => randomRuns(m, rng, Math.round(rng.int(3, 6) * scale(m)), 10, 80)

/** Sells at the first small gain, never at a loss. */
const bagHolder: Style = (m, rng) => {
  const target = tickVolatility(m) * Math.sqrt(10)
  const held = new Array<boolean>(m.playTicks).fill(false)
  let t = rng.int(5, 30)
  while (t < m.playTicks) {
    const entry = playPrice(m, t)
    while (t < m.playTicks) {
      held[t] = true
      t++
      if (t < m.playTicks && playPrice(m, t) > entry * (1 + target)) break
    }
    t += rng.int(5, 30)
  }
  return held
}

/** A bag holder who adds four 0.2-0.4 s taps, to dilute an average-depth rule. */
const bagHolderTaps: Style = (m, rng) => {
  const held = bagHolder(m, rng)
  let added = 0
  for (let tries = 0; tries < 400 && added < 4; tries++) {
    const a = rng.int(2, m.playTicks - 8)
    const len = rng.int(2, 4)
    let free = true
    for (let t = a - 2; t < a + len + 2; t++) if (held[t]) free = false
    if (!free) continue
    for (let t = a; t < a + len; t++) held[t] = true
    added++
  }
  return held
}

/** Stays in, cuts a loser at 1.5 two-second swings, back in half a second later. */
const disciplined: Style = (m) => {
  const stop = 1.5 * tickVolatility(m) * Math.sqrt(20)
  const held = new Array<boolean>(m.playTicks).fill(false)
  let holding = false
  let entry = 0
  let rest = 0
  for (let t = 0; t < m.playTicks; t++) {
    const p = playPrice(m, t)
    if (holding && p < entry * (1 - stop)) {
      holding = false
      rest = t + 5
    } else if (!holding && t >= rest) {
      holding = true
      entry = p
    }
    held[t] = holding
  }
  return held
}

/** Cuts a loser at 1.5 two-second swings, then waits 2 to 6 s before buying again. */
const restingCutter: Style = (m, rng) => {
  const stop = 1.5 * tickVolatility(m) * Math.sqrt(20)
  const held = new Array<boolean>(m.playTicks).fill(false)
  let holding = false
  let entry = 0
  let rest = 0
  for (let t = 0; t < m.playTicks; t++) {
    const p = playPrice(m, t)
    if (holding && p < entry * (1 - stop)) {
      holding = false
      rest = t + rng.int(20, 60)
    } else if (!holding && t >= rest) {
      holding = true
      entry = p
    }
    held[t] = holding
  }
  return held
}

/** 12 to 16 short taps per 40 s. */
const masher: Style = (m, rng) => {
  const held = new Array<boolean>(m.playTicks).fill(false)
  const k = Math.round(rng.int(12, 16) * scale(m))
  const slot = Math.floor(m.playTicks / k)
  for (let i = 0; i < k; i++) {
    const a = i * slot + rng.int(0, Math.max(0, slot - 12))
    for (let t = a; t < Math.min(m.playTicks, a + rng.int(3, 10)); t++) held[t] = true
  }
  return held
}

/** One 0.3 s tap. */
const tapper: Style = (m, rng) => {
  const held = new Array<boolean>(m.playTicks).fill(false)
  const a = rng.int(0, m.playTicks - 4)
  for (let t = a; t < a + 3; t++) held[t] = true
  return held
}

/** Presses in the first 0.3 s and holds to the bell. */
const buyHold: Style = (m, rng) => {
  const held = new Array<boolean>(m.playTicks).fill(false)
  for (let t = rng.int(0, 3); t < m.playTicks; t++) held[t] = true
  return held
}

/** Random background, plus buying right after a 2.5-sigma jump in 2 s and holding 2 s. */
const chaser: Style = (m, rng) => {
  const vol = tickVolatility(m)
  const held = random(m, rng)
  for (let t = 20; t < m.playTicks; t++) {
    if (Math.log(playPrice(m, t) / playPrice(m, t - 20)) > 2.5 * vol * Math.sqrt(20)) {
      held[t - 1] = false
      for (let k = t; k < Math.min(m.playTicks, t + 20); k++) held[k] = true
      if (t + 20 < m.playTicks) held[t + 20] = false
      t += 25
    }
  }
  return held
}

/** Random background, plus acting in a rumor's direction before the price moves. */
const rumorFollower: Style = (m, rng) => {
  const held = random(m, rng)
  for (const n of m.news) {
    if (n.kind !== 'rumor' || n.at >= m.playTicks) continue
    const act = Math.min(n.at + rng.int(2, 8), n.impactAt - 1)
    const want = n.implied > 0
    for (let t = Math.max(0, n.at - 5); t < act; t++) held[t] = !want
    const until = Math.min(m.playTicks, n.impactAt + rng.int(10, 40))
    for (let t = act; t < until; t++) held[t] = want
    if (until < m.playTicks) held[until] = !want
  }
  return held
}

/** Random background, plus acting on each filing's headline before the price moves. */
const filingFollower: Style = (m, rng) => {
  const held = random(m, rng)
  for (const n of m.news) {
    if (n.kind !== 'filing' || n.at >= m.playTicks) continue
    const act = Math.min(n.at + rng.int(2, 8), n.impactAt - 1)
    const want = n.implied > 0
    for (let t = Math.max(0, n.at - 5); t < act; t++) held[t] = !want
    const until = Math.min(m.playTicks, n.impactAt + rng.int(10, 40))
    for (let t = act; t < until; t++) held[t] = want
    if (until < m.playTicks) held[until] = !want
  }
  return held
}

/** Metrics per style and round, computed once: many tests judge the same rounds. */
const metricsCache = new Map<Style, Map<string, RoundMetrics>>()

function metricsOf(style: Style, product: ProductKey, seed: number, length: RoundLength = 'short') {
  const byStyle = metricsCache.get(style) ?? new Map<string, RoundMetrics>()
  metricsCache.set(style, byStyle)
  const key = `${product}|${seed}|${length}`
  const hit = byStyle.get(key)
  if (hit) return hit
  const market = generateMarket(seed, product, length)
  const held = style(market, createRng(seed * 7 + 1))
  const habits = analyzeRound(market, held, 0)
  const m = roundMetrics(market, { held, heldRatio: held.filter(Boolean).length / held.length }, habits)
  byStyle.set(key, m)
  return m
}

/** Verdicts of one style on one mission, `rounds` per product. */
function verdicts(style: Style, id: MissionId, rounds = 60, length: RoundLength = 'short', seed0 = 4_000, products = PRODUCTS) {
  const out: Verdict[] = []
  for (const product of products) for (let s = 0; s < rounds; s++) out.push(judgeMission(id, metricsOf(style, product, seed0 + s, length)).verdict)
  return out
}

/** Pass rate among judged rounds, and the share of rounds judged. */
function rates(style: Style, id: MissionId, rounds = 60, length: RoundLength = 'short', products = PRODUCTS) {
  const vs = verdicts(style, id, rounds, length, 4_000, products)
  const judged = vs.filter((v) => v !== 'ineligible')
  return { pass: judged.length ? judged.filter((v) => v === 'pass').length / judged.length : 0, judged: judged.length / vs.length }
}

/**
 * Chance that a player drawing rounds from this pool completes the mission
 * within `maxJudged` judged rounds, by the mission's real pass rule.
 */
function completion(pool: Verdict[], id: MissionId, maxJudged = 10, players = 4000, seed = 1) {
  const judged = pool.filter((v): v is Attempt => v !== 'ineligible')
  if (!judged.length) return 0
  const rng = createRng(seed)
  let done = 0
  for (let p = 0; p < players; p++) {
    const attempts: Attempt[] = []
    for (let r = 0; r < maxJudged; r++) {
      attempts.push(judged[rng.int(0, judged.length - 1)])
      if (isComplete(progressOf(id, attempts))) {
        done++
        break
      }
    }
  }
  return done / players
}

const base: RoundMetrics = {
  trades: 3,
  t40: 3,
  heldRatio: 0.5,
  swing: 0.01,
  stopLosers: 1,
  stopLate: 0,
  stopLateSec: 0,
  stopChance: 0.3,
  longestShare: 0.3,
  longestSec: 12,
  lossTrades: 1,
  winTrades: 2,
  avgWinHoldSec: 5,
  avgLossHoldSec: 3,
  upSec: 8,
  downSec: 6,
  sellsUp: 1,
  sellsDown: 2,
  sellRateUp: 0.1,
  sellRateDown: 0.2,
  chaseEntries: 0,
  chaseChance: 0.1,
  rumors: 2,
  rumorReactions: 0,
  rumorChance: 0.2,
  filings: 1,
  filingReactions: 1,
  filingChance: 0.2,
  isLong: false,
  ticksPerDay: 20,
  playTicks: 400,
}

describe('guard G0: a mission cannot be passed by not playing or by mashing', () => {
  it('leaves rounds with no trade, little time held or too many trades unjudged', () => {
    for (const id of MISSION_IDS) {
      expect(judgeMission(id, { ...base, trades: 0, t40: 0, heldRatio: 0 }).verdict).toBe('ineligible')
      // Holding too little is the very thing fewTrades and longHold ask about,
      // so it can fail them; it never passes them, and other missions skip it.
      const light = judgeMission(id, { ...base, heldRatio: G0.minHeld - 0.01 }).verdict
      // (longHold may still pass: in a long round a 30 s hold is only 10%.)
      if (id === 'fewTrades') expect(light).not.toBe('pass')
      else if (id === 'longHold') expect(light).not.toBe('ineligible')
      else expect(light).toBe('ineligible')
      // Mashing is unjudged, except on the mission about trading less, where it fails.
      expect(judgeMission(id, { ...base, trades: 9, t40: G0.maxT40 + 0.5 }).verdict).toBe(id === 'fewTrades' ? 'fail' : 'ineligible')
      expect(judgeMission(id, base).verdict).not.toBe('ineligible')
    }
  })

  it('never passes the one-tap player, and judges the masher only to fail fewTrades', () => {
    for (const id of MISSION_IDS) {
      if (id === 'fewTrades' || id === 'longHold') {
        // A single short tap is judged here, and it can only fail.
        expect(verdicts(tapper, id, 20).every((v) => v !== 'pass'), id).toBe(true)
      } else {
        expect(rates(tapper, id, 20).judged, id).toBe(0)
      }
      if (id === 'fewTrades') continue
      if (id === 'longHold') {
        expect(verdicts(masher, id, 20).every((v) => v !== 'pass'), id).toBe(true)
        continue
      }
      expect(rates(masher, id, 20).judged, id).toBe(0)
    }
    const mash = verdicts(masher, 'fewTrades', 20)
    expect(mash.every((v) => v === 'fail')).toBe(true)
  })

  it('says why a round was not judged, and quotes numbers when it was', () => {
    for (const id of MISSION_IDS) {
      for (const product of PRODUCTS) {
        for (let s = 0; s < 6; s++) {
          for (const length of ['short', 'long'] as const) {
            for (const style of [random, bagHolder, buyHold]) {
              const { measure } = judgeMission(id, metricsOf(style, product, 50 + s, length))
              expect(measure).toMatch(/요\.$/)
              expect(measure).not.toMatch(/NaN|Infinity|undefined|지라시|공시|기준선/)
            }
          }
        }
      }
    }
  })
})

describe('missions separate the habit from its absence', () => {
  it('stopLine judges reaction time: a loss cutter passes on every product and length, a bag holder rarely', () => {
    for (const length of ['short', 'long'] as const) {
      for (const product of PRODUCTS) {
        const cut = rates(disciplined, 'stopLine', length === 'short' ? 30 : 6, length, [product])
        expect(cut.pass, `${product} ${length}`).toBeGreaterThanOrEqual(0.95)
      }
    }
    expect(rates(bagHolder, 'stopLine').pass).toBeLessThan(0.25)
  })

  it('stopLine cannot be gamed by adding tiny losing taps', () => {
    const plain = rates(bagHolder, 'stopLine').pass
    const taps = rates(bagHolderTaps, 'stopLine').pass
    expect(taps).toBeLessThan(0.2)
    expect(taps - plain).toBeLessThan(0.08)
  })

  it('stopLine allows what exits blind to the line give: random pressers pass about as often in long rounds as in short ones', () => {
    // Was 1% in long rounds against 48% in short ones, with no late exit allowed at all.
    const short = rates(random, 'stopLine', 60).pass
    const long = rates(random, 'stopLine', 20, 'long').pass
    expect(short).toBeGreaterThan(0.35)
    expect(short).toBeLessThan(0.6)
    expect(long).toBeGreaterThan(0.3)
    expect(Math.abs(long - short)).toBeLessThan(0.15)
    // Bag holders still fail in long rounds, taps or not.
    expect(rates(bagHolder, 'stopLine', 20, 'long').pass).toBeLessThan(0.1)
    expect(rates(bagHolderTaps, 'stopLine', 20, 'long').pass).toBeLessThan(0.1)
  })

  it('stopLine: the allowance is one fewer than chance gives, and the copy says so', () => {
    expect(stopAllowance({ stopChance: 1.4 })).toBe(0)
    expect(stopAllowance({ stopChance: 1.5 })).toBe(1)
    expect(stopAllowance({ stopChance: 5.2 })).toBe(4)
    const m = { ...base, stopLosers: 17, stopLate: 4, stopLateSec: 3, stopChance: 5.2 }
    const ok = judgeMission('stopLine', m)
    expect(ok.verdict).toBe('pass')
    expect(ok.measure).toContain(`아무 때나 팔아도 ${stopChanceCount(m)}개쯤은 늦어서, 4개까지는 괜찮아요.`)
    expect(judgeMission('stopLine', { ...m, stopLate: 5 }).verdict).toBe('fail')
    expect(judgeMission('rules3', { ...m, stopLate: 5 }).verdict).toBe('fail')
    expect(judgeMission('rules3', m).verdict).toBe('pass')
    // One losing trade ridden past the line always fails: chance can never excuse a single one.
    expect(judgeMission('stopLine', { ...base, stopLosers: 1, stopLate: 1, stopChance: 0.9 }).verdict).toBe('fail')
  })

  it('stopLine chance does not grow with how long you hold losers: it is the chart times your losing trades', () => {
    let compared = 0
    for (let s = 4_000; s < 4_006; s++) {
      const a = metricsOf(bagHolder, 'stock', s, 'long')
      const b = metricsOf(random, 'stock', s, 'long')
      if (!a.stopLosers || !b.stopLosers) continue
      expect(a.stopChance / a.stopLosers).toBeCloseTo(b.stopChance / b.stopLosers, 9)
      compared++
    }
    expect(compared).toBeGreaterThan(2)
  })

  it('lossFirst is judged in most rounds of someone who cuts losses and rests, not only rounds with 3 sells', () => {
    // Was judged in 29% of short rounds, so a real change completed only 60% of the time within 10 played rounds.
    const r = rates(restingCutter, 'lossFirst')
    expect(r.judged).toBeGreaterThan(0.6)
    expect(r.pass).toBeGreaterThan(0.95)
    expect(rates(bagHolder, 'lossFirst').pass).toBe(0)
    expect(rates(bagHolder, 'lossFirst', 12, 'long').pass).toBe(0)
  })

  it('filingOnly in long rounds needs more filing reactions than pressing at your own pace gives', () => {
    expect(filingNeed({ filingChance: 0.3 })).toBe(1)
    expect(filingNeed({ filingChance: 3.6 })).toBe(5)
    // Random pressers passed 46% of long rounds with "one filing is enough".
    expect(rates(random, 'filingOnly', 12, 'long').pass).toBeLessThan(0.25)
    expect(rates(filingFollower, 'filingOnly', 12, 'long').pass).toBeGreaterThan(0.6)
    expect(rates(filingFollower, 'filingOnly', 60).pass).toBeGreaterThan(0.5)
    expect(rates(random, 'filingOnly', 60).pass).toBeLessThan(0.3)
  })

  it('lossFirst: a bag holder never passes, a loss cutter nearly always does', () => {
    expect(rates(bagHolder, 'lossFirst').pass).toBe(0)
    expect(rates(disciplined, 'lossFirst').pass).toBeGreaterThan(0.9)
  })

  it('winsLonger: a bag holder (quick wins, long losses) mostly fails', () => {
    expect(rates(bagHolder, 'winsLonger').pass).toBeLessThan(0.3)
    expect(rates(disciplined, 'winsLonger').pass).toBeGreaterThan(0.6)
  })

  it('waitBeat compares with chance: a chaser mostly fails, a random presser mostly passes in both lengths', () => {
    const c = rates(chaser, 'waitBeat')
    expect(c.pass).toBeLessThan(0.25)
    expect(rates(chaser, 'waitBeat', 8, 'long').pass).toBeLessThan(0.1)
    expect(rates(random, 'waitBeat').pass).toBeGreaterThan(0.6)
    // Was 9% with "no chase at all" in long rounds.
    expect(rates(random, 'waitBeat', 8, 'long').pass).toBeGreaterThan(0.4)
  })

  it('skipRumor compares with chance: a rumor follower fails, a random presser can pass long rounds', () => {
    expect(rates(rumorFollower, 'skipRumor').pass).toBeLessThan(0.05)
    expect(rates(rumorFollower, 'skipRumor', 8, 'long').pass).toBeLessThan(0.05)
    expect(rates(random, 'skipRumor').pass).toBeGreaterThan(0.6)
    // Was 20% with "no reaction at all".
    expect(rates(random, 'skipRumor', 8, 'long').pass).toBeGreaterThan(0.35)
  })

  it('skill missions are not free for a random presser', () => {
    expect(rates(random, 'longHold').pass).toBeLessThan(0.1)
    expect(rates(random, 'stayIn').pass).toBeLessThan(0.1)
    expect(rates(random, 'fewTrades').pass).toBeLessThan(0.3)
    expect(rates(random, 'filingOnly').pass).toBeLessThan(0.35)
  })

  it('longHold, stayIn, fewTrades and rules3 cannot be farmed by pressing once and holding to the bell', () => {
    for (const id of ['longHold', 'stayIn', 'fewTrades', 'rules3'] as const) {
      expect(rates(buyHold, id, 20).judged, id).toBe(0)
      expect(rates(buyHold, id, 4, 'long').judged, id).toBe(0)
    }
  })

  it('longHold asks 10 s of a short round and 30 s of a long one, and says both', () => {
    expect(LONG_HOLD_SEC).toEqual({ short: 10, long: 30 })
    const long = { ...base, isLong: true, playTicks: 3000, ticksPerDay: 12 }
    expect(judgeMission('longHold', { ...base, longestSec: 10, longestShare: 0.25 }).verdict).toBe('pass')
    expect(judgeMission('longHold', { ...base, longestSec: 9.9, longestShare: 0.25 }).verdict).toBe('fail')
    expect(judgeMission('longHold', { ...long, longestSec: 30, longestShare: 0.1 }).verdict).toBe('pass')
    const short = judgeMission('longHold', { ...long, longestSec: 29.9, longestShare: 0.1 })
    expect(short.verdict).toBe('fail')
    expect(short.measure).toContain('목표는 30초 이상이에요')
    expect(MISSIONS.longHold.goal).toContain('한 번에 10초(긴 판은 30초) 이상')
  })

  it('longHold is not free in long rounds: a random presser and a 0.5-15 s presser fail, someone who stays in passes', () => {
    const dontCare: Style = (m, rng) => randomRuns(m, rng, Math.max(1, Math.round(rng.int(1, 6) * scale(m))), 5, 150)
    // Was 100% with a flat 10 s.
    expect(rates(dontCare, 'longHold', 8, 'long').pass).toBeLessThan(0.1)
    expect(rates(random, 'longHold', 8, 'long').pass).toBe(0)
    expect(rates(restingCutter, 'longHold', 8, 'long').pass).toBeGreaterThan(0.9)
    // Short rounds keep 10 s.
    expect(rates(dontCare, 'longHold').pass).toBeGreaterThan(0.4)
  })

  it('rules3 is reachable for a disciplined trader: 3 in a row in a fair share of tries', () => {
    expect(rates(disciplined, 'rules3').pass).toBeGreaterThan(0.6)
    expect(rates(disciplined, 'rules3', 8, 'long').pass).toBeGreaterThan(0.5)
    expect(rates(bagHolder, 'rules3').pass).toBeLessThan(0.2)
  })

  it('uses the same loss line on short and long rounds (2-second swings, not days)', () => {
    const short = metricsOf(random, 'stock', 1)
    const long = metricsOf(random, 'stock', 1, 'long')
    // A day is 2 s in a short round and 1.2 s in a long one; the swing unit is 2 s in both.
    expect(short.swing).toBeGreaterThan(0)
    expect(long.swing).toBeGreaterThan(0)
    expect(long.ticksPerDay).not.toBe(short.ticksPerDay)
  })
})

describe('completing a mission takes a changed habit, not luck (3 of the last 4 judged rounds)', () => {
  const bag = verdicts(bagHolder, 'stopLine', 100, 'short', 70_000)
  const cut = verdicts(disciplined, 'stopLine', 40, 'short', 70_000)

  it('stopLine: a bag holder who never changes completes within 10 judged rounds at most 10% of the time', () => {
    expect(completion(bag, 'stopLine')).toBeLessThanOrEqual(0.1)
  })

  it('stopLine: a loss cutter completes within 10 judged rounds at least 90% of the time', () => {
    expect(completion(cut, 'stopLine')).toBeGreaterThanOrEqual(0.9)
  })

  it('stopLine in long rounds: a loss cutter completes, a bag holder does not', () => {
    expect(completion(verdicts(disciplined, 'stopLine', 8, 'long', 74_000), 'stopLine')).toBeGreaterThanOrEqual(0.9)
    expect(completion(verdicts(bagHolder, 'stopLine', 12, 'long', 74_000), 'stopLine')).toBeLessThanOrEqual(0.1)
  })

  it('lossFirst: someone who changed completes within 10 played rounds at least 90% of the time', () => {
    // Played, not judged: rounds that can't be judged use up the player's rounds too.
    const pool = verdicts(restingCutter, 'lossFirst', 60, 'short', 75_000)
    const rng = createRng(3)
    let done = 0
    for (let p = 0; p < 4000; p++) {
      const attempts: Attempt[] = []
      for (let r = 0; r < 10; r++) {
        const v = pool[rng.int(0, pool.length - 1)]
        if (v === 'ineligible') continue
        attempts.push(v)
        if (isComplete(progressOf('lossFirst', attempts))) {
          done++
          break
        }
      }
    }
    expect(done / 4000).toBeGreaterThanOrEqual(0.9)
  })

  it('lossFirst: a bag holder never completes it, a loss cutter does', () => {
    expect(completion(verdicts(bagHolder, 'lossFirst', 40, 'short', 71_000), 'lossFirst')).toBe(0)
    expect(completion(verdicts(disciplined, 'lossFirst', 40, 'short', 71_000), 'lossFirst')).toBeGreaterThanOrEqual(0.9)
  })

  it('a random presser rarely completes the holding missions', () => {
    for (const id of ['longHold', 'stayIn'] as const) {
      expect(completion(verdicts(random, id, 60, 'short', 72_000), id), id).toBeLessThanOrEqual(0.05)
    }
    // fewTrades judges the behaviour itself: a random round with few, long presses did trade little.
    expect(completion(verdicts(random, 'fewTrades', 60, 'short', 72_000), 'fewTrades')).toBeLessThanOrEqual(0.2)
  })

  it('a chaser and a rumor follower rarely complete their missions, even in long rounds', () => {
    expect(completion(verdicts(chaser, 'waitBeat', 60, 'short', 73_000), 'waitBeat')).toBeLessThanOrEqual(0.06)
    expect(completion(verdicts(rumorFollower, 'skipRumor', 60, 'short', 73_000), 'skipRumor')).toBeLessThanOrEqual(0.02)
    expect(completion(verdicts(rumorFollower, 'skipRumor', 8, 'long', 73_000), 'skipRumor')).toBeLessThanOrEqual(0.02)
  })
})

describe('progress: 3 of the last 4 judged rounds, in words', () => {
  it('slides over judged rounds only', () => {
    expect(MISSIONS.stopLine.need).toBe(3)
    expect(MISSIONS.stopLine.window).toBe(4)
    expect(progressOf('stopLine', ['pass']).passes).toBe(1)
    expect(progressOf('stopLine', ['pass', 'fail', 'fail', 'fail']).passes).toBe(1)
    expect(progressOf('stopLine', ['pass', 'fail', 'fail', 'fail', 'fail']).passes).toBe(0)
    expect(isComplete(progressOf('stopLine', ['pass', 'fail', 'pass', 'pass']))).toBe(true)
    expect(isComplete(progressOf('stopLine', ['pass', 'pass', 'fail']))).toBe(false)
    expect(progressText(progressOf('stopLine', ['pass']))).toBe('최근 4판 중 3번 성공하면 완료예요 · 지금 1번')
    expect(progressShort(progressOf('stopLine', ['pass']))).toBe('3번 성공하면 완료 · 지금 1번')
  })

  it('needs three in a row for the rules mission', () => {
    expect(MISSIONS.rules3.need).toBe(3)
    expect(MISSIONS.rules3.window).toBe(3)
    expect(progressText(progressOf('rules3', ['fail', 'pass', 'pass']))).toBe('3판 연속 성공하면 완료예요 · 지금 연속 2판')
    expect(progressShort(progressOf('rules3', ['pass', 'fail']))).toBe('3판 연속이면 완료 · 지금 0판')
  })

  it('never shows a bare fraction', () => {
    for (const id of MISSION_IDS) {
      expect(progressShort(progressOf(id, ['pass', 'fail']))).not.toMatch(/\d\/\d/)
      expect(progressText(progressOf(id, ['pass', 'fail']))).not.toMatch(/\d\/\d|판정/)
    }
  })
})

const profile = (scores: Partial<Profile['scores']>, type: Profile['type'], extra: Partial<Profile> = {}): Profile => ({
  type,
  rounds: 10,
  scores: { holder: 0, chicken: 0, scalper: 0, chaser: 0, rumor: 0, ...scores },
  ...extra,
})

describe('picking a mission', () => {
  it('starts new players on holding, before any profile', () => {
    expect(pickMission(null, [], '2026-10-05')).toEqual({ id: 'longHold', starter: true })
  })

  it('follows the strongest significant habit, or the skill track', () => {
    expect(pickMission(profile({ holder: 0.6, scalper: 0.4 }, 'holder'), [], '2026-10-05').id).toBe('stopLine')
    expect(pickMission(profile({ scalper: 0.5 }, 'scalper'), [], '2026-10-05').id).toBe('fewTrades')
    expect(pickMission(profile({ rumor: 0.5 }, 'rumor'), [], '2026-10-05').id).toBe('skipRumor')
    expect(pickMission(profile({ chaser: 0.29 }, 'watcher', { held: 0.1 }), [], '2026-10-05').id).toBe('stayIn')
    expect(pickMission(profile({}, 'machine'), [], '2026-10-05').id).toBe('rules3')
  })

  it('follows the evidence behind the holder flag: selling rates get lossFirst first', () => {
    expect(pickMission(profile({ holder: 0.6 }, 'holder', { holderBasis: 'rates' }), [], '2026-10-05').id).toBe('lossFirst')
    expect(pickMission(profile({ holder: 0.6 }, 'holder', { holderBasis: 'depth' }), [], '2026-10-05').id).toBe('stopLine')
  })

  it('sends 탐색 중 and a 관망형 who holds but hardly trades to the skill chain, not "시장에 머물기"', () => {
    expect(pickMission(profile({}, 'steady'), [], '2026-10-05').id).toBe('rules3')
    expect(pickMission(profile({}, 'watcher', { held: 0.9 }), [], '2026-10-05').id).toBe('rules3')
  })

  it('skips a mission passed in the last two weeks, then brings it back as a recheck', () => {
    const p = profile({ holder: 0.6 }, 'holder')
    expect(pickMission(p, [{ id: 'stopLine', at: '2026-10-01' }], '2026-10-05').id).toBe('lossFirst')
    expect(pickMission(p, [{ id: 'stopLine', at: '2026-10-01' }], '2026-10-15')).toEqual({ id: 'stopLine', recheck: true })
  })

  it('never brings a mission back inside two weeks through the fallback', () => {
    const w = profile({}, 'watcher', { held: 0.1 })
    const done = [
      { id: 'stayIn' as const, at: '2026-10-02' },
      { id: 'longHold' as const, at: '2026-10-03' },
      { id: 'rules3' as const, at: '2026-10-04' },
    ]
    const pick = pickMission(w, done, '2026-10-05')
    expect(['stayIn', 'longHold', 'rules3']).not.toContain(pick.id)
    expect(pick.recheck).toBeUndefined()
    // Every skill mission passed this week: the one passed longest ago, not as a recheck.
    const all = (['rules3', 'filingOnly', 'longHold', 'stayIn', 'fewTrades', 'waitBeat'] as const).map((id, i) => ({ id, at: `2026-10-0${i + 1}` }))
    const last = pickMission(profile({}, 'machine'), all, '2026-10-07', { id: 'waitBeat' })
    expect(last.id).toBe('rules3')
    expect(last.recheck).toBeUndefined()
  })
})

describe('advancing the mission state', () => {
  const pass: RoundMetrics = { ...base, longestShare: 0.5, longestSec: 20, t40: 2, heldRatio: 0.45 }
  const fail: RoundMetrics = { ...base, longestShare: 0.1, longestSec: 4, heldRatio: 0.3, stopLate: 1, stopLateSec: 2 }
  const idle: RoundMetrics = { ...base, trades: 0, t40: 0, heldRatio: 0 }

  function run(state: MissionState, rounds: Array<RoundMetrics | null>, p: Profile | null, day = '2026-10-05') {
    const outs = []
    for (const m of rounds) {
      const step = advanceMission(state, m, p, day)
      state = step.state
      outs.push(step.outcome)
    }
    return { state, outs }
  }

  it('assigns a mission after the first round without judging it', () => {
    const { state, outs } = run(emptyMissionState(), [pass], null)
    expect(outs[0].outcome).toBe('new')
    expect(state.active?.id).toBe('longHold')
    expect(state.active?.attempts).toEqual([])
  })

  it('completes on 3 of 4 judged rounds, ignoring unjudged ones, and moves on', () => {
    const { state, outs } = run(emptyMissionState(), [pass, pass, idle, fail, pass, pass], null)
    expect(outs.map((o) => o.outcome)).toEqual(['new', 'pass', 'ineligible', 'fail', 'pass', 'pass'])
    expect(outs[4].completed).toBeUndefined()
    expect(outs[5].completed).toBe(true)
    expect(outs[5].next?.id).toBe('fewTrades')
    expect(state.done).toEqual([{ id: 'longHold', at: '2026-10-05' }])
    expect(state.active).toMatchObject({ id: 'fewTrades', attempts: [] })
  })

  it('keeps the starter mission when a profile arrives, until it is completed', () => {
    const first = run(emptyMissionState(), [pass], null).state
    const holder = profile({ holder: 0.7 }, 'holder')
    const step = advanceMission(first, fail, holder, '2026-10-05')
    expect(step.outcome.outcome).toBe('fail')
    expect(step.outcome.next).toBeUndefined()
    expect(step.state.active).toMatchObject({ id: 'longHold', starter: true, attempts: ['fail'] })
    // Completing it moves on to the habit's mission.
    const done = run(step.state, [pass, pass, pass], holder)
    expect(done.outs[2].completed).toBe(true)
    expect(done.outs[2].next?.id).toBe('stopLine')
    expect(done.outs[2].reason).toBeUndefined()
  })

  it('says why when a starter gives way anyway (week turn), and drops its progress', () => {
    const first = run(emptyMissionState(), [pass], null, '2026-10-05').state
    const step = advanceMission(first, fail, profile({ holder: 0.7 }, 'holder'), '2026-10-12')
    expect(step.outcome.next?.id).toBe('stopLine')
    expect(step.outcome.reason).toBe(STARTER_SWITCH_REASON)
    expect(STARTER_SWITCH_REASON).toBe('이제 5판이 쌓여서, 내 습관에 맞는 미션으로 바꿨어요.')
    expect(step.state.active?.starter).toBeUndefined()
  })

  it('never assigns "시장에 머물기" right after a round held half the time or more', () => {
    const w = profile({}, 'watcher', { held: 0.1 })
    const start: MissionState = { active: { id: 'longHold', since: '2026-10-05', attempts: ['pass', 'pass'] }, done: [] }
    const held = advanceMission(start, { ...pass, heldRatio: 0.6 }, w, '2026-10-06')
    expect(held.outcome.completed).toBe(true)
    expect(held.outcome.next?.id).not.toBe('stayIn')
    const light = advanceMission(start, { ...pass, heldRatio: 0.3 }, w, '2026-10-06')
    expect(light.outcome.next?.id).toBe('stayIn')
    // Nor as the very first mission.
    expect(advanceMission(emptyMissionState(), { ...pass, heldRatio: 0.98 }, w, '2026-10-06').outcome.next?.id).not.toBe('stayIn')
  })

  it('changes weekly with the profile, but never keeps one habit more than two weeks', () => {
    const p = profile({ holder: 0.7, scalper: 0.4 }, 'holder')
    const start: MissionState = { active: { id: 'stopLine', since: '2026-10-05', attempts: [] }, done: [] }
    // Same week, and the next week with the same strongest habit: kept.
    expect(advanceMission(start, fail, p, '2026-10-11').outcome.next).toBeUndefined()
    expect(advanceMission(start, fail, p, '2026-10-12').outcome.next).toBeUndefined()
    // Two weeks on: the next habit.
    expect(advanceMission(start, fail, p, '2026-10-19').outcome.next?.id).toBe('fewTrades')
    // A new strongest habit changes it at the week turn, and says so.
    const q = profile({ rumor: 0.8, holder: 0.5 }, 'rumor')
    const turned = advanceMission(start, fail, q, '2026-10-12')
    expect(turned.outcome.next?.id).toBe('skipRumor')
    expect(turned.outcome.reason).toBe(WEEK_SWITCH_REASON)
    expect(weekOf('2026-10-11')).toBe(weekOf('2026-10-05'))
    expect(weekOf('2026-10-12')).toBe(weekOf('2026-10-05') + 1)
  })

  it('never throws a pass away at the week turn: the switch waits for a round that did not pass', () => {
    const q = profile({ rumor: 0.8 }, 'rumor')
    const start: MissionState = { active: { id: 'longHold', since: '2026-09-28', attempts: [] }, done: [] }
    const step = advanceMission(start, pass, q, '2026-10-12')
    expect(step.outcome.outcome).toBe('pass')
    expect(step.outcome.next).toBeUndefined()
    expect(step.state.active).toMatchObject({ id: 'longHold', attempts: ['pass'] })
    const after = advanceMission(step.state, fail, q, '2026-10-13')
    expect(after.outcome.next?.id).toBe('skipRumor')
    expect(after.outcome.reason).toBe(WEEK_SWITCH_REASON)
  })

  it('treats a round with no metrics as unjudged', () => {
    const first = run(emptyMissionState(), [pass], null).state
    const step = advanceMission(first, null, null, '2026-10-05')
    expect(step.outcome.outcome).toBe('ineligible')
    expect(step.state.active?.attempts).toEqual([])
  })
})
