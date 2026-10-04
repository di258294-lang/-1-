import { describe, expect, it } from 'vitest'
import { analyzeRound, tickVolatility, type Profile } from './habits'
import { generateMarket, playPrice, type Market } from './market'
import {
  advanceMission,
  emptyMissionState,
  G0,
  judgeMission,
  MISSION_IDS,
  MISSIONS,
  pickMission,
  progressOf,
  progressText,
  roundMetrics,
  weekOf,
  type MissionId,
  type MissionState,
  type RoundMetrics,
} from './missions'
import type { ProductKey } from './products'
import { createRng, type Rng } from './rng'

const PRODUCTS: ProductKey[] = ['stock', 'coin', 'gold', 'bond', 'lev2']

type Style = (m: Market, rng: Rng) => boolean[]

/** Random presses, blind to profit and loss. */
const random: Style = (m, rng) => {
  const held = new Array<boolean>(m.playTicks).fill(false)
  const want = rng.int(3, 6)
  for (let placed = 0, tries = 0; placed < want && tries < 500; tries++) {
    const len = rng.int(10, 80)
    const a = rng.int(0, m.playTicks - len - 1)
    let free = true
    for (let t = Math.max(0, a - 2); t < Math.min(m.playTicks, a + len + 2); t++) if (held[t]) free = false
    if (!free) continue
    for (let t = a; t < a + len; t++) held[t] = true
    placed++
  }
  return held
}

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

/** 12 to 16 short taps a round. */
const masher: Style = (m, rng) => {
  const held = new Array<boolean>(m.playTicks).fill(false)
  const k = rng.int(12, 16)
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

/** Buys right after a 2.5-sigma jump in 2 s, holds 2 s. */
const chaser: Style = (m) => {
  const vol = tickVolatility(m)
  const held = new Array<boolean>(m.playTicks).fill(false)
  for (let t = 20; t < m.playTicks; t++) {
    if (Math.log(playPrice(m, t) / playPrice(m, t - 20)) > 2.5 * vol * Math.sqrt(20)) {
      for (let k = t; k < Math.min(m.playTicks, t + 20); k++) held[k] = true
      t += 25
    }
  }
  return held
}

function metricsOf(style: Style, product: ProductKey, seed: number, length: 'short' | 'long' = 'short') {
  const market = generateMarket(seed, product, length)
  const held = style(market, createRng(seed * 7 + 1))
  const habits = analyzeRound(market, held, 0)
  return roundMetrics(market, { held, heldRatio: held.filter(Boolean).length / held.length }, habits)
}

/** Pass rate among judged rounds, and the share of rounds judged. */
function rates(style: Style, id: MissionId, rounds = 60) {
  let pass = 0
  let judged = 0
  let total = 0
  for (const product of PRODUCTS) {
    for (let s = 0; s < rounds; s++) {
      const v = judgeMission(id, metricsOf(style, product, 4_000 + s)).verdict
      total++
      if (v === 'ineligible') continue
      judged++
      if (v === 'pass') pass++
    }
  }
  return { pass: judged ? pass / judged : 0, judged: judged / total }
}

const base: RoundMetrics = {
  trades: 3,
  t40: 3,
  heldRatio: 0.5,
  swing: 0.01,
  lossDepth: 1,
  avgLossWorst: -0.01,
  longestShare: 0.3,
  lossTrades: 1,
  winTrades: 2,
  avgWinHoldSec: 5,
  avgLossHoldSec: 3,
  comparableRates: true,
  sellRateUp: 0.1,
  sellRateDown: 0.2,
  chaseEntries: 0,
  rumors: 2,
  rumorReactions: 0,
  filings: 1,
  filingReactions: 1,
  isLong: false,
  ticksPerDay: 20,
  playTicks: 400,
}

describe('guard G0: a mission cannot be passed by not playing or by mashing', () => {
  it('leaves rounds with no trade, little time held or too many trades unjudged', () => {
    for (const id of MISSION_IDS) {
      expect(judgeMission(id, { ...base, trades: 0, t40: 0, heldRatio: 0 }).verdict).toBe('ineligible')
      expect(judgeMission(id, { ...base, heldRatio: G0.minHeld - 0.01 }).verdict).toBe('ineligible')
      expect(judgeMission(id, { ...base, trades: 9, t40: G0.maxT40 + 0.5 }).verdict).toBe('ineligible')
      expect(judgeMission(id, base).verdict).not.toBe('ineligible')
    }
  })

  it('never judges the mashing or one-tap scripted players', () => {
    for (const id of MISSION_IDS) {
      expect(rates(masher, id, 20).judged, id).toBe(0)
      expect(rates(tapper, id, 20).judged, id).toBe(0)
    }
  })

  it('says why a round was not judged, and quotes numbers when it was', () => {
    for (const id of MISSION_IDS) {
      for (const product of PRODUCTS) {
        for (let s = 0; s < 10; s++) {
          for (const length of ['short', 'long'] as const) {
            const { measure } = judgeMission(id, metricsOf(random, product, 50 + s, length))
            expect(measure).toMatch(/요\.$/)
            expect(measure).not.toMatch(/NaN|Infinity|undefined|지라시|공시/)
          }
        }
      }
    }
  })
})

describe('missions separate the habit from its absence', () => {
  it('stopLine: a trader who cuts losses passes, a bag holder rarely does', () => {
    const cut = rates(disciplined, 'stopLine')
    const bag = rates(bagHolder, 'stopLine')
    // This scripted trader holds through bad news gaps, so some of its losers overshoot.
    expect(cut.pass).toBeGreaterThan(0.55)
    expect(cut.pass - bag.pass).toBeGreaterThan(0.35)
    expect(bag.pass).toBeLessThan(0.3)
  })

  it('lossFirst: a bag holder never passes, a loss cutter nearly always does', () => {
    expect(rates(bagHolder, 'lossFirst').pass).toBe(0)
    expect(rates(disciplined, 'lossFirst').pass).toBeGreaterThan(0.9)
  })

  it('winsLonger: a bag holder (quick wins, long losses) mostly fails', () => {
    expect(rates(bagHolder, 'winsLonger').pass).toBeLessThan(0.3)
    expect(rates(disciplined, 'winsLonger').pass).toBeGreaterThan(0.6)
  })

  it('waitBeat: a chaser always fails when judged, a random presser mostly passes', () => {
    const c = rates(chaser, 'waitBeat')
    if (c.judged > 0) expect(c.pass).toBe(0)
    expect(rates(random, 'waitBeat').pass).toBeGreaterThan(0.6)
  })

  it('skill missions are not free for a random presser', () => {
    expect(rates(random, 'longHold').pass).toBeLessThan(0.1)
    expect(rates(random, 'stayIn').pass).toBeLessThan(0.1)
    expect(rates(random, 'fewTrades').pass).toBeLessThan(0.3)
    expect(rates(random, 'filingOnly').pass).toBeLessThan(0.35)
  })

  it('rules3 is reachable for a disciplined trader: 3 in a row in a fair share of tries', () => {
    const r = rates(disciplined, 'rules3')
    expect(r.pass).toBeGreaterThan(0.6)
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

describe('progress: 2 of the last 3 judged rounds', () => {
  it('slides over judged rounds only', () => {
    expect(progressOf('stopLine', ['pass']).passes).toBe(1)
    expect(progressOf('stopLine', ['pass', 'fail', 'fail']).passes).toBe(1)
    expect(progressOf('stopLine', ['pass', 'fail', 'fail', 'fail']).passes).toBe(0)
    expect(progressOf('stopLine', ['fail', 'pass', 'fail', 'pass']).passes).toBe(2)
    expect(progressText(progressOf('stopLine', ['pass']))).toBe('판정한 최근 3판 중 1판 성공 · 2판이면 완료')
  })

  it('needs three in a row for the rules mission', () => {
    expect(MISSIONS.rules3.need).toBe(3)
    expect(progressText(progressOf('rules3', ['fail', 'pass', 'pass']))).toBe('연속 2판 성공 · 3판 연속이면 완료')
  })
})

const profile = (scores: Partial<Profile['scores']>, type: Profile['type']): Profile => ({
  type,
  rounds: 10,
  scores: { holder: 0, chicken: 0, scalper: 0, chaser: 0, rumor: 0, ...scores },
})

describe('picking a mission', () => {
  it('starts new players on holding, before any profile', () => {
    expect(pickMission(null, [], '2026-10-05')).toEqual({ id: 'longHold', starter: true })
  })

  it('follows the strongest significant habit, or the skill track', () => {
    expect(pickMission(profile({ holder: 0.6, scalper: 0.4 }, 'holder'), [], '2026-10-05').id).toBe('stopLine')
    expect(pickMission(profile({ scalper: 0.5 }, 'scalper'), [], '2026-10-05').id).toBe('fewTrades')
    expect(pickMission(profile({ rumor: 0.5 }, 'rumor'), [], '2026-10-05').id).toBe('skipRumor')
    expect(pickMission(profile({ chaser: 0.29 }, 'watcher'), [], '2026-10-05').id).toBe('stayIn')
    expect(pickMission(profile({}, 'machine'), [], '2026-10-05').id).toBe('rules3')
  })

  it('skips a mission passed in the last two weeks, then brings it back as a recheck', () => {
    const p = profile({ holder: 0.6 }, 'holder')
    expect(pickMission(p, [{ id: 'stopLine', at: '2026-10-01' }], '2026-10-05').id).toBe('lossFirst')
    expect(pickMission(p, [{ id: 'stopLine', at: '2026-10-01' }], '2026-10-15')).toEqual({ id: 'stopLine', recheck: true })
  })
})

describe('advancing the mission state', () => {
  const pass: RoundMetrics = { ...base, longestShare: 0.5, t40: 2, heldRatio: 0.6 }
  const fail: RoundMetrics = { ...base, longestShare: 0.1 }
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

  it('completes on 2 of 3 judged rounds, ignoring unjudged ones, and moves on', () => {
    const { state, outs } = run(emptyMissionState(), [pass, pass, idle, fail, pass], null)
    expect(outs.map((o) => o.outcome)).toEqual(['new', 'pass', 'ineligible', 'fail', 'pass'])
    expect(outs[4].completed).toBe(true)
    expect(outs[4].next?.id).toBe('fewTrades')
    expect(state.done).toEqual([{ id: 'longHold', at: '2026-10-05' }])
    expect(state.active).toMatchObject({ id: 'fewTrades', attempts: [] })
  })

  it('switches from the starter mission once a profile exists', () => {
    const first = run(emptyMissionState(), [pass], null).state
    const step = advanceMission(first, fail, profile({ holder: 0.7 }, 'holder'), '2026-10-05')
    expect(step.outcome.outcome).toBe('fail')
    expect(step.outcome.next?.id).toBe('stopLine')
    expect(step.state.active?.starter).toBeUndefined()
  })

  it('changes weekly with the profile, but never keeps one habit more than two weeks', () => {
    const p = profile({ holder: 0.7, scalper: 0.4 }, 'holder')
    const start: MissionState = { active: { id: 'stopLine', since: '2026-10-05', attempts: [] }, done: [] }
    // Same week, and the next week with the same strongest habit: kept.
    expect(advanceMission(start, fail, p, '2026-10-11').outcome.next).toBeUndefined()
    expect(advanceMission(start, fail, p, '2026-10-12').outcome.next).toBeUndefined()
    // Two weeks on: the next habit.
    expect(advanceMission(start, fail, p, '2026-10-19').outcome.next?.id).toBe('fewTrades')
    // A new strongest habit changes it at the week turn.
    const q = profile({ rumor: 0.8, holder: 0.5 }, 'rumor')
    expect(advanceMission(start, fail, q, '2026-10-12').outcome.next?.id).toBe('skipRumor')
    expect(weekOf('2026-10-11')).toBe(weekOf('2026-10-05'))
    expect(weekOf('2026-10-12')).toBe(weekOf('2026-10-05') + 1)
  })

  it('treats a round with no metrics as unjudged', () => {
    const first = run(emptyMissionState(), [pass], null).state
    const step = advanceMission(first, null, null, '2026-10-05')
    expect(step.outcome.outcome).toBe('ineligible')
    expect(step.state.active?.attempts).toEqual([])
  })
})
