import { HABIT_KEYS, tickVolatility, tradesFrom, TYPE_MIN, type HabitKey, type Profile, type RoundHabits } from './habits'
import { TICKS_PER_SECOND, type Market } from './market'
import type { RoundResult } from './round'

/**
 * Habit missions: one concrete, task-level goal at a time, picked from the
 * player's strongest measured habit, judged from the same per-round numbers
 * the habit diagnosis already computes (see docs/MODEL.md §4).
 *
 * Design rules (learning-design report §3):
 *   - Guard G0 on every mission: at least one trade, held at least 20% of
 *     the round, at most 8 trades per 40 seconds. Doing nothing can't pass
 *     a mission, and neither can mashing.
 *   - A round where the mission can't be measured (no losing trade for a
 *     stop-loss mission, no rumor for a rumor mission) is "판정 없음": it
 *     counts neither way.
 *   - Passed when the rule holds in 2 of the last 3 judged rounds (the
 *     machine mission needs 3 in a row).
 *   - No mission rewards trading more.
 *
 * Everything here is pure; storage and screens wrap it.
 */

export type MissionId =
  | 'stopLine'
  | 'lossFirst'
  | 'winsLonger'
  | 'fewTrades'
  | 'longHold'
  | 'waitBeat'
  | 'skipRumor'
  | 'filingOnly'
  | 'stayIn'
  | 'rules3'

export const MISSION_IDS: readonly MissionId[] = [
  'stopLine',
  'lossFirst',
  'winsLonger',
  'fewTrades',
  'longHold',
  'waitBeat',
  'skipRumor',
  'filingOnly',
  'stayIn',
  'rules3',
]

export const isMissionId = (x: unknown): x is MissionId => typeof x === 'string' && (MISSION_IDS as readonly string[]).includes(x)

export type Verdict = 'pass' | 'fail' | 'ineligible'
export type Attempt = 'pass' | 'fail'

/** Guard G0. */
export const G0 = { minTrades: 1, minHeld: 0.2, maxT40: 8 } as const
/** Days before a passed mission can come back, as a "유지 확인" recheck. */
export const RECHECK_DAYS = 14
/** Judged rounds kept per mission (only the last `window` matter). */
const MAX_ATTEMPTS = 12

/** Everything a mission looks at, from one finished round. */
export type RoundMetrics = {
  trades: number
  /** Trades per 40 seconds, so short and long rounds compare. */
  t40: number
  heldRatio: number
  /**
   * How far this chart usually moves in 2 seconds (one standard deviation),
   * as a return. A wall-clock unit on purpose: reaction time is the same in
   * short and long rounds, so the loss line is too.
   */
  swing: number
  /** Average worst point of the losing trades, in swings (0 with no loser). */
  lossDepth: number
  avgLossWorst: number
  /** Longest single holding stretch, as a share of the round. */
  longestShare: number
  lossTrades: number
  winTrades: number
  avgWinHoldSec: number
  avgLossHoldSec: number
  comparableRates: boolean
  sellRateUp: number
  sellRateDown: number
  chaseEntries: number
  rumors: number
  rumorReactions: number
  filings: number
  filingReactions: number
  isLong: boolean
  /** Ticks per simulated day, to speak in days in long mode. */
  ticksPerDay: number
  playTicks: number
}

export function roundMetrics(market: Market, result: Pick<RoundResult, 'heldRatio' | 'held'>, habits: RoundHabits): RoundMetrics {
  const f = habits.facts
  const swing = tickVolatility(market) * Math.sqrt(SWING_TICKS)
  const trades = tradesFrom(market, result.held)
  const longest = trades.reduce((a, t) => Math.max(a, t.exit - t.entry), 0)
  return {
    trades: habits.trades,
    t40: (habits.trades * 400) / market.playTicks,
    heldRatio: result.heldRatio,
    swing,
    lossDepth: f.lossTrades ? -f.avgLossWorst / swing : 0,
    avgLossWorst: f.avgLossWorst,
    longestShare: longest / market.playTicks,
    lossTrades: f.lossTrades,
    winTrades: f.winTrades,
    avgWinHoldSec: f.avgWinHoldSec,
    avgLossHoldSec: f.avgLossHoldSec,
    comparableRates: f.comparableRates,
    sellRateUp: f.sellRateUp,
    sellRateDown: f.sellRateDown,
    chaseEntries: f.chaseEntries,
    rumors: f.rumors,
    rumorReactions: f.rumorReactions,
    filings: f.filings,
    filingReactions: f.filingReactions,
    isLong: market.length === 'long',
    ticksPerDay: market.ticksPerDay,
    playTicks: market.playTicks,
  }
}

// ---------------------------------------------------------------------------
// Copy helpers

const pct1 = (x: number) => `${(Math.abs(x) * 100).toFixed(1)}%`
const pct0 = (x: number) => `${Math.round(x * 100)}%`
const per40 = (m: RoundMetrics) => (m.isLong ? `40초당 ${m.t40.toFixed(1)}번` : `${m.trades}번`)
/** A holding time in the round's own unit: seconds in a short round, days in a long one. */
const span = (m: RoundMetrics, sec: number) =>
  m.isLong ? `${Math.round((sec * TICKS_PER_SECOND) / m.ticksPerDay)}일` : `${Number(sec.toFixed(1))}초`
const roundSec = (m: RoundMetrics) => m.playTicks / TICKS_PER_SECOND
/** "30초였어요", "41일이었어요", "45%였어요": the past copula after a number with its unit. */
const was = (word: string) => {
  const code = word.charCodeAt(word.length - 1) - 0xac00
  return `${word}${code >= 0 && code <= 11171 && code % 28 !== 0 ? '이었어요' : '였어요'}`
}

export type MissionCheck = { verdict: Verdict; measure: string }

export type MissionDef = {
  id: MissionId
  /** The habit it works on, or 'skill' for the 관망형/기계형 and starter missions. */
  habit: HabitKey | 'skill'
  /** Task-level title: what to do, never who you are. */
  title: string
  /** The rule in plain words. */
  goal: string
  /** One line: why this matters. */
  why: string
  /** Passes needed among the last `window` judged rounds. */
  need: number
  window: number
  /** Judged after G0 has passed. */
  judge(m: RoundMetrics): MissionCheck
}

/**
 * The loss line, in 2-second swings. The report's 1.5 failed a scripted
 * trader who cuts at 1.5 swings (the price overshoots the stop, 13% passed);
 * at 2 that trader passes 73-96% of short rounds, a random presser 50-67%
 * and a bag holder 13-21% (see missions.test.ts).
 */
export const LOSS_LINE = 2
const SWING_TICKS = 2 * TICKS_PER_SECOND

/** The rules mission's four rules, as one sentence per broken rule. */
const ruleBreaks = (m: RoundMetrics) => {
  const out: string[] = []
  if (m.lossTrades && m.lossDepth > LOSS_LINE) {
    out.push(`손실 매매가 평균 -${pct1(m.avgLossWorst)}까지 내려갔어요. 기준선은 -${pct1(LOSS_LINE * m.swing)}였어요.`)
  }
  if (m.chaseEntries > 0) out.push(`급등 직후에 ${m.chaseEntries}번 샀어요.`)
  if (m.rumorReactions > 0) out.push(`소문에 ${m.rumorReactions}번 먼저 움직였어요.`)
  if (m.t40 > 6) out.push(`매매가 ${per40(m)}으로 6번을 넘었어요.`)
  return out
}

export const MISSIONS: Record<MissionId, MissionDef> = {
  stopLine: {
    id: 'stopLine',
    habit: 'holder',
    title: '손실이 깊어지기 전에 손 떼기',
    goal: '손실 난 매매를 기준선 안에서 정리하기. 기준선은 그 차트가 2초 동안 보통 움직이는 폭의 2배로, 주식이면 -2~3% 정도예요.',
    why: '손실을 오래 버틸수록 되돌리기 어려워져요.',
    need: 2,
    window: 3,
    judge(m) {
      const line = `-${pct1(LOSS_LINE * m.swing)}`
      if (!m.lossTrades) return { verdict: 'ineligible', measure: '손실 난 매매가 없어서 이번엔 판정하지 않았어요.' }
      const ok = m.lossDepth <= LOSS_LINE
      return {
        verdict: ok ? 'pass' : 'fail',
        measure: `손실 매매의 평균 최저점 -${pct1(m.avgLossWorst)}, 기준선 ${line}${ok ? ' 안이었어요.' : '보다 깊었어요.'}`,
      }
    },
  },
  lossFirst: {
    id: 'lossFirst',
    habit: 'holder',
    title: '손실 난 것부터 놓기',
    goal: '손실 중일 때 파는 빈도가 수익 중일 때보다 낮지 않게 하기',
    why: '수익은 빨리 팔고 손실은 쥐고 있는 습관을 거꾸로 연습해요.',
    need: 2,
    window: 3,
    judge(m) {
      if (!m.comparableRates) {
        return { verdict: 'ineligible', measure: '수익 중·손실 중에 들고 있던 시간이나 판 횟수가 적어서 판정하지 않았어요.' }
      }
      const ok = m.sellRateDown >= m.sellRateUp
      return {
        verdict: ok ? 'pass' : 'fail',
        measure: `1초 안에 팔 확률이 손실 중 ${pct0(m.sellRateDown)}, 수익 중 ${pct0(m.sellRateUp)}였어요.`,
      }
    },
  },
  winsLonger: {
    id: 'winsLonger',
    habit: 'chicken',
    title: '수익도 손실만큼 들고 있기',
    goal: '수익 난 매매를 손실 난 매매보다 짧지 않게 들고 있기',
    why: '오르는 건 금방 팔고 내리는 건 오래 들면, 작게 벌고 크게 잃기 쉬워요.',
    need: 2,
    window: 3,
    judge(m) {
      if (!m.winTrades || !m.lossTrades) {
        return { verdict: 'ineligible', measure: '수익 난 매매와 손실 난 매매가 둘 다 있어야 판정해요.' }
      }
      const ok = m.avgWinHoldSec >= m.avgLossHoldSec
      return {
        verdict: ok ? 'pass' : 'fail',
        measure: `평균 보유 시간이 수익 매매 ${span(m, m.avgWinHoldSec)}, 손실 매매 ${was(span(m, m.avgLossHoldSec))}.`,
      }
    },
  },
  fewTrades: {
    id: 'fewTrades',
    habit: 'scalper',
    title: '적게 사고팔고 오래 들기',
    goal: '40초에 매매 4번 이하, 들고 있는 시간은 40% 이상',
    why: '사고팔 때마다 수수료가 빠져서, 잦을수록 넘어야 할 기준이 높아져요.',
    need: 2,
    window: 3,
    judge(m) {
      const ok = m.t40 <= 4 && m.heldRatio >= 0.4
      return {
        verdict: ok ? 'pass' : 'fail',
        measure: `매매는 ${per40(m)}, 들고 있던 시간은 ${was(pct0(m.heldRatio))}. 목표는 매매 4번 이하, 시간 40% 이상이에요.`,
      }
    },
  },
  longHold: {
    id: 'longHold',
    habit: 'skill',
    title: '한 번은 길게 들고 있기',
    goal: '한 번에 판의 4분의 1 이상 계속 누르고 있기, 매매는 40초에 6번 이하',
    why: '짧게 톡톡 치면 수수료만 나가고 움직임은 놓치기 쉬워요.',
    need: 2,
    window: 3,
    judge(m) {
      const target = roundSec(m) / 4
      const longest = m.longestShare * roundSec(m)
      const ok = m.longestShare >= 0.25 && m.t40 <= 6
      return {
        verdict: ok ? 'pass' : 'fail',
        measure:
          `가장 길게 든 매매는 ${was(span(m, longest))}. 목표는 ${span(m, target)} 이상이에요.` +
          (m.t40 > 6 ? ` 매매가 ${per40(m)}으로 6번을 넘었어요.` : ''),
      }
    },
  },
  waitBeat: {
    id: 'waitBeat',
    habit: 'chaser',
    title: '급등 직후엔 한 박자 쉬기',
    goal: '2초 사이 크게 오른 직후에는 사지 않기 (매매 2번 이상인 판에서)',
    why: '급하게 오른 걸 보고 사면 꼭대기 근처에서 사는 일이 잦아요.',
    need: 2,
    window: 3,
    judge(m) {
      if (m.trades < 2) return { verdict: 'ineligible', measure: '매매가 2번 이상인 판에서 판정해요.' }
      const ok = m.chaseEntries === 0
      return {
        verdict: ok ? 'pass' : 'fail',
        measure: ok ? `${m.trades}번 산 것 중 급등 직후에 산 건 없었어요.` : `${m.trades}번 산 것 중 ${m.chaseEntries}번이 급등 직후였어요.`,
      }
    },
  },
  skipRumor: {
    id: 'skipRumor',
    habit: 'rumor',
    title: '소문엔 먼저 움직이지 않기',
    goal: '소문이 뜨면 가격이 실제로 움직일 때까지 누르거나 떼지 않기',
    why: '이 게임의 소문은 반쯤 틀려서, 먼저 움직이면 동전 던지기와 비슷해요.',
    need: 2,
    window: 3,
    judge(m) {
      if (!m.rumors) return { verdict: 'ineligible', measure: '소문이 없는 판이라 판정하지 않았어요.' }
      const ok = m.rumorReactions === 0
      return { verdict: ok ? 'pass' : 'fail', measure: `소문 ${m.rumors}개 중 먼저 움직인 건 ${m.rumorReactions}개였어요.` }
    },
  },
  filingOnly: {
    id: 'filingOnly',
    habit: 'rumor',
    title: '공식 발표에만 움직이기',
    goal: '소문은 거르고, 공식 발표에는 가격보다 먼저 맞는 방향으로 움직이기',
    why: '확인된 소식과 소문을 가려 읽는 연습이에요.',
    need: 2,
    window: 3,
    judge(m) {
      if (!m.rumors || !m.filings) return { verdict: 'ineligible', measure: '소문과 공식 발표가 둘 다 나온 판에서 판정해요.' }
      const ok = m.rumorReactions === 0 && m.filingReactions >= 1
      return {
        verdict: ok ? 'pass' : 'fail',
        measure: `소문에 먼저 움직인 건 ${m.rumors}개 중 ${m.rumorReactions}개, 공식 발표에 맞게 움직인 건 ${m.filings}개 중 ${m.filingReactions}개였어요.`,
      }
    },
  },
  stayIn: {
    id: 'stayIn',
    habit: 'skill',
    title: '시장에 머물기',
    goal: '판의 절반 이상 들고 있기, 매매는 40초에 3번 이하',
    why: '지켜보기만 하면 습관도 실력도 드러나지 않아요. 들어가서 버텨 보는 연습이에요.',
    need: 2,
    window: 3,
    judge(m) {
      const ok = m.t40 <= 3 && m.heldRatio >= 0.5
      return {
        verdict: ok ? 'pass' : 'fail',
        measure: `들고 있던 시간은 ${pct0(m.heldRatio)}, 매매는 ${was(per40(m))}. 목표는 시간 50% 이상, 매매 3번 이하예요.`,
      }
    },
  },
  rules3: {
    id: 'rules3',
    habit: 'skill',
    title: '네 가지 규칙으로 3판 연속',
    goal: '손실은 기준선 안에서 정리, 급등 직후엔 안 사기, 소문엔 먼저 안 움직이기, 매매는 40초에 6번 이하',
    why: '한 판 잘하는 것보다 같은 규칙을 여러 판 지키는 게 어려워요.',
    need: 3,
    window: 3,
    judge(m) {
      const broke = ruleBreaks(m)
      return broke.length
        ? { verdict: 'fail', measure: broke[0] }
        : { verdict: 'pass', measure: '네 가지 규칙을 모두 지켰어요.' }
    },
  },
}

/** Judge one round against a mission, with guard G0 first. */
export function judgeMission(id: MissionId, m: RoundMetrics): MissionCheck {
  if (m.trades < G0.minTrades) return { verdict: 'ineligible', measure: '매매가 없어서 이번엔 판정하지 않았어요.' }
  if (m.heldRatio < G0.minHeld) {
    return { verdict: 'ineligible', measure: `들고 있던 시간이 ${pct0(m.heldRatio)}로 20%보다 짧아서 판정하지 않았어요.` }
  }
  if (m.t40 > G0.maxT40) return { verdict: 'ineligible', measure: `매매가 ${per40(m)}으로 너무 잦아서 판정하지 않았어요.` }
  return MISSIONS[id].judge(m)
}

// ---------------------------------------------------------------------------
// State, picking and progress

export type ActiveMission = {
  id: MissionId
  /** Date key it was assigned. */
  since: string
  /** Passed before: this time it checks the habit stayed fixed. */
  recheck?: boolean
  /** Assigned before a profile existed. */
  starter?: boolean
  /** Judged rounds, oldest first. */
  attempts: Attempt[]
}

export type MissionState = {
  active: ActiveMission | null
  /** Passed missions, oldest first. */
  done: Array<{ id: MissionId; at: string }>
}

export const emptyMissionState = (): MissionState => ({ active: null, done: [] })

export type MissionProgress = { passes: number; need: number; window: number; recent: Attempt[] }

export function progressOf(id: MissionId, attempts: readonly Attempt[]): MissionProgress {
  const def = MISSIONS[id]
  const recent = attempts.slice(-def.window)
  return { passes: recent.filter((a) => a === 'pass').length, need: def.need, window: def.window, recent }
}

export const isComplete = (p: MissionProgress) => p.passes >= p.need

/** "최근 3판 중 1판 성공 · 2판이면 완료" (판정된 판만 셈). */
export function progressText(p: MissionProgress) {
  if (p.need === p.window) {
    let streak = 0
    for (let i = p.recent.length - 1; i >= 0 && p.recent[i] === 'pass'; i--) streak++
    return `연속 ${streak}판 성공 · ${p.need}판 연속이면 완료`
  }
  return `판정한 최근 ${p.window}판 중 ${p.passes}판 성공 · ${p.need}판이면 완료`
}

/** "1/2" for a chip. */
export function progressShort(p: MissionProgress) {
  if (p.need === p.window) {
    let streak = 0
    for (let i = p.recent.length - 1; i >= 0 && p.recent[i] === 'pass'; i--) streak++
    return `${streak}/${p.need}`
  }
  return `${p.passes}/${p.need}`
}

/** Missions per habit, most direct first. */
const BY_HABIT: Record<HabitKey, MissionId[]> = {
  holder: ['stopLine', 'lossFirst'],
  chicken: ['winsLonger', 'lossFirst'],
  scalper: ['fewTrades', 'longHold'],
  chaser: ['waitBeat'],
  rumor: ['skipRumor', 'filingOnly'],
}
/** Before a profile exists (fewer than 5 rounds): learn to hold first. */
const STARTER: MissionId[] = ['longHold', 'fewTrades', 'waitBeat']
const WATCHER: MissionId[] = ['stayIn', 'longHold', 'rules3']
const MACHINE: MissionId[] = ['rules3', 'filingOnly', 'longHold']

const DAY_MS = 86_400_000
const dayIndex = (key: string) => {
  const t = Date.parse(`${key}T00:00:00Z`)
  return Number.isNaN(t) ? 0 : Math.round(t / DAY_MS)
}
export const daysBetween = (from: string, to: string) => dayIndex(to) - dayIndex(from)
/** Monday-based week number (1970-01-05 was a Monday, day 4). */
export const weekOf = (key: string) => Math.floor((dayIndex(key) - 4) / 7)

export type MissionPick = { id: MissionId; recheck?: boolean; starter?: boolean }

/**
 * The mission to work on next. Habits are ranked by the profile's pooled
 * scores and only a significant one (TYPE_MIN, the 5% level) gets a habit
 * mission; otherwise the 관망형/기계형 skill missions. A mission passed in
 * the last RECHECK_DAYS days is skipped; after that it may come back as a
 * recheck. `avoid` skips a habit (no habit more than two weeks running) or a
 * mission (the one just passed).
 */
export function pickMission(
  profile: Profile | null,
  done: MissionState['done'],
  today: string,
  avoid: { habit?: HabitKey | 'skill'; id?: MissionId } = {},
): MissionPick {
  const recent = (id: MissionId) => done.some((d) => d.id === id && daysBetween(d.at, today) < RECHECK_DAYS)
  const ever = (id: MissionId) => done.some((d) => d.id === id)
  const ok = (id: MissionId) => id !== avoid.id && !recent(id) && MISSIONS[id].habit !== avoid.habit

  if (!profile) {
    const id = STARTER.find(ok) ?? STARTER.find((i) => i !== avoid.id) ?? STARTER[0]
    return { id, starter: true, recheck: ever(id) || undefined }
  }
  const ranked = HABIT_KEYS.filter((k) => profile.scores[k] >= TYPE_MIN).sort((a, b) => profile.scores[b] - profile.scores[a])
  for (const habit of ranked) {
    const id = BY_HABIT[habit].find(ok)
    if (id) return { id, recheck: ever(id) || undefined }
  }
  const chain = profile.type === 'watcher' ? WATCHER : MACHINE
  const id = chain.find(ok) ?? chain.find((i) => i !== avoid.id) ?? chain[0]
  return { id, recheck: ever(id) || undefined }
}

export type MissionOutcome = {
  /** The mission this round was judged against (or just assigned, for 'new'). */
  id: MissionId
  outcome: Verdict | 'new'
  /** This round's number against the target ('' for 'new'). */
  measure: string
  progress: MissionProgress
  recheck?: boolean
  /** True when this round completed the mission. */
  completed?: boolean
  /** The mission for the next round, when it changed. */
  next?: MissionPick
}

/**
 * One round's effect on the mission state: judge it, record the attempt,
 * and move on when the mission is passed, when a starter mission meets a
 * fresh profile, or at the weekly change (Monday). Pure.
 */
export function advanceMission(
  state: MissionState,
  metrics: RoundMetrics | null,
  profile: Profile | null,
  today: string,
): { state: MissionState; outcome: MissionOutcome } {
  const assign = (p: MissionPick): ActiveMission => ({
    id: p.id,
    since: today,
    attempts: [],
    ...(p.recheck ? { recheck: true } : {}),
    ...(p.starter ? { starter: true } : {}),
  })

  const active = state.active
  if (!active) {
    const p = pickMission(profile, state.done, today)
    return {
      state: { ...state, active: assign(p) },
      outcome: { id: p.id, outcome: 'new', measure: '', progress: progressOf(p.id, []), recheck: p.recheck, next: p },
    }
  }

  const check: MissionCheck = metrics
    ? judgeMission(active.id, metrics)
    : { verdict: 'ineligible', measure: '매매가 없어서 이번엔 판정하지 않았어요.' }
  const attempts = check.verdict === 'ineligible' ? active.attempts : [...active.attempts, check.verdict].slice(-MAX_ATTEMPTS)
  const progress = progressOf(active.id, attempts)
  const outcome: MissionOutcome = {
    id: active.id,
    outcome: check.verdict,
    measure: check.measure,
    progress,
    recheck: active.recheck,
  }

  if (check.verdict === 'pass' && isComplete(progress)) {
    const done = [...state.done, { id: active.id, at: today }].slice(-50)
    const p = pickMission(profile, done, today, { id: active.id })
    outcome.completed = true
    outcome.next = p
    return { state: { active: assign(p), done }, outcome }
  }

  let next: MissionPick | null = null
  if (active.starter && profile) {
    // The profile is in: switch from the starter to a mission that fits.
    const p = pickMission(profile, state.done, today)
    if (p.id !== active.id) next = p
  } else if (weekOf(today) > weekOf(active.since)) {
    // Weekly change: follow the profile, but never the same habit more
    // than two weeks running.
    const weeks = weekOf(today) - weekOf(active.since)
    const p = pickMission(profile, state.done, today, weeks >= 2 ? { habit: MISSIONS[active.id].habit } : {})
    if (p.id !== active.id) next = p
  }
  if (next) {
    outcome.next = next
    return { state: { ...state, active: assign(next) }, outcome }
  }
  return { state: { ...state, active: { ...active, attempts } }, outcome }
}
