import { daysBetween, weekIndex as weekOf } from './daily'
import { HABIT_KEYS, PROFILE_MIN_ROUNDS, tickVolatility, tradesFrom, TYPE_MIN, type HabitKey, type Profile, type RoundHabits } from './habits'
import { playPrice, TICKS_PER_SECOND, type Market } from './market'
import type { RoundResult } from './round'

/**
 * Habit missions: one concrete, task-level goal at a time, picked from the
 * player's strongest measured habit, judged from the same per-round numbers
 * the habit diagnosis already computes (see docs/MODEL.md §5).
 *
 * Design rules (learning-design report §3, stats audit §1):
 *   - Guard G0 on every mission: at least one trade, held at least 20% of
 *     the round, at most 8 trades per 40 seconds. Doing nothing can't pass
 *     a mission, and neither can mashing. (fewTrades counts mashing as a fail.)
 *   - A round where the mission can't be measured (no losing trade for a
 *     stop-loss mission, no rumor for a rumor mission) is "판정 없음": it
 *     counts neither way.
 *   - Passed when the rule holds in 3 of the last 4 judged rounds (the
 *     rules mission needs 3 in a row). With 2 of 3, a player who never
 *     changed finished most missions by luck.
 *   - Rules about rare events (buying after a spike, moving on a rumor) are
 *     judged against what random pressing gives on the same chart, so long
 *     rounds with 7.5 times the ticks aren't near-impossible.
 *   - No mission rewards trading more, and none can be farmed by pressing
 *     once and holding to the bell.
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
/** Days before a passed mission can come back, as a "다시 해보기" recheck. */
export const RECHECK_DAYS = 14
/** Judged rounds kept per mission (only the last `window` matter). */
const MAX_ATTEMPTS = 12
/** Passes needed among the last judged rounds, for every mission but rules3. */
export const PASS_NEED = 3
export const PASS_WINDOW = 4
/** longHold: one stretch at least this long, in wall-clock seconds (both round lengths). */
export const LONG_HOLD_SEC = 10
/** longHold and stayIn are not judged when held this much: pressing once and waiting for the bell is not the skill. */
export const FULL_HOLD = 0.95
/** stayIn is never assigned right after a round held at least this much: that player is already in the market. */
export const STAY_IN_SKIP_HELD = 0.5
/** A starter mission gives way to a profile mission after this many judged rounds without completing. */
export const STARTER_MAX_JUDGED = 6

export const STARTER_SWITCH_REASON = `이제 ${PROFILE_MIN_ROUNDS}판이 쌓여서, 내 습관에 맞는 미션으로 바꿨어요.`
export const WEEK_SWITCH_REASON = '이번 주 미션은 여기까지예요. 새 주가 시작돼서 최근 판에 맞는 미션으로 바꿨어요.'

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
  /** Losing trades held at least 1 s (a tap is not riding a loss). */
  stopLosers: number
  /** Of those, how many stayed more than 1 s past the loss line. */
  stopLate: number
  /** The longest time one of them stayed past the line, in seconds (0 when none crossed). */
  stopLateSec: number
  /** Longest single holding stretch, as a share of the round and in seconds. */
  longestShare: number
  longestSec: number
  lossTrades: number
  winTrades: number
  avgWinHoldSec: number
  avgLossHoldSec: number
  comparableRates: boolean
  sellRateUp: number
  sellRateDown: number
  chaseEntries: number
  /** How many buys right after a spike random pressing would give on this chart, on average. */
  chaseChance: number
  rumors: number
  rumorReactions: number
  /** How many rumor reactions random pressing would give on this chart, on average. */
  rumorChance: number
  filings: number
  filingReactions: number
  isLong: boolean
  /** Ticks per simulated day, to speak in days in long mode. */
  ticksPerDay: number
  playTicks: number
}

/**
 * The loss line, in 2-second swings: twice what the chart usually moves in
 * 2 seconds (stock short rounds: median 2.4%, 10th-90th percentile 1.8-3.5%).
 */
export const LOSS_LINE = 2
const SWING_TICKS = 2 * TICKS_PER_SECOND
/** Time allowed past the loss line before selling. */
const STOP_REACTION_TICKS = TICKS_PER_SECOND

export function roundMetrics(market: Market, result: Pick<RoundResult, 'heldRatio' | 'held'>, habits: RoundHabits): RoundMetrics {
  const f = habits.facts
  const swing = tickVolatility(market) * Math.sqrt(SWING_TICKS)
  const trades = tradesFrom(market, result.held)
  const longest = trades.reduce((a, t) => Math.max(a, t.exit - t.entry), 0)
  // Stop reaction: for each losing trade held 1 s or more, the first tick it
  // closed beyond the line, and how long the position stayed open after it.
  // Judging the reaction rather than the average depth means extra tiny
  // losing taps can't dilute a deep loss, and a news gap that jumps straight
  // past the line is fine as long as the exit follows.
  let stopLosers = 0
  let stopLate = 0
  let stopLateTicks = 0
  for (const t of trades) {
    if (t.ret >= 0 || t.exit - t.entry < TICKS_PER_SECOND) continue
    stopLosers++
    const floor = playPrice(market, t.entry) * (1 - LOSS_LINE * swing)
    for (let j = t.entry + 1; j <= t.exit; j++) {
      if (playPrice(market, j) < floor) {
        const late = t.exit - j
        if (late > STOP_REACTION_TICKS) {
          stopLate++
          stopLateTicks = Math.max(stopLateTicks, late)
        }
        break
      }
    }
  }
  return {
    trades: habits.trades,
    t40: (habits.trades * 400) / market.playTicks,
    heldRatio: result.heldRatio,
    swing,
    stopLosers,
    stopLate,
    stopLateSec: stopLateTicks / TICKS_PER_SECOND,
    longestShare: longest / market.playTicks,
    longestSec: longest / TICKS_PER_SECOND,
    lossTrades: f.lossTrades,
    winTrades: f.winTrades,
    avgWinHoldSec: f.avgWinHoldSec,
    avgLossHoldSec: f.avgLossHoldSec,
    comparableRates: f.comparableRates,
    sellRateUp: f.sellRateUp,
    sellRateDown: f.sellRateDown,
    chaseEntries: f.chaseEntries,
    chaseChance: habits.evidence.chaseChance,
    rumors: f.rumors,
    rumorReactions: f.rumorReactions,
    rumorChance: habits.evidence.rumorChance,
    filings: f.filings,
    filingReactions: f.filingReactions,
    isLong: market.length === 'long',
    ticksPerDay: market.ticksPerDay,
    playTicks: market.playTicks,
  }
}

/** Buys after a spike that are still fine: what random pressing gives on this chart (0 in a short round). */
export const chaseAllowance = (m: Pick<RoundMetrics, 'chaseChance'>) => Math.round(m.chaseChance)
/** Rumor reactions that are still fine: what random pressing gives on this chart (0 in a short round). */
export const rumorAllowance = (m: Pick<RoundMetrics, 'rumorChance'>) => Math.floor(m.rumorChance)

// ---------------------------------------------------------------------------
// Copy helpers

const pct1 = (x: number) => `${(Math.abs(x) * 100).toFixed(1)}%`
const pct0 = (x: number) => `${Math.round(x * 100)}%`
const per40 = (m: RoundMetrics) => (m.isLong ? `40초당 ${m.t40.toFixed(1)}번` : `${m.trades}번`)
/** A holding time in the round's own unit: seconds in a short round, days in a long one. */
const span = (m: RoundMetrics, sec: number) =>
  m.isLong ? `${Math.round((sec * TICKS_PER_SECOND) / m.ticksPerDay)}일` : `${Number(sec.toFixed(1))}초`
const secs = (sec: number) => `${Number(sec.toFixed(1))}초`
/** "30초였어요", "41일이었어요", "45%였어요": the past copula after a number with its unit. */
const was = (word: string) => {
  const code = word.charCodeAt(word.length - 1) - 0xac00
  return `${word}${code >= 0 && code <= 11171 && code % 28 !== 0 ? '이었어요' : '였어요'}`
}
const lossLine = (m: RoundMetrics) => `-${pct1(LOSS_LINE * m.swing)}`

export type MissionCheck = { verdict: Verdict; measure: string }

export type MissionDef = {
  id: MissionId
  /** The habit it works on, or 'skill' for the no-habit and starter missions. */
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

/** The rules mission's four rules, as one sentence per broken rule. */
const ruleBreaks = (m: RoundMetrics) => {
  const out: string[] = []
  if (m.stopLate > 0) out.push(`손실 매매가 손절선 ${lossLine(m)} 아래에서 ${secs(m.stopLateSec)} 버텼어요.`)
  if (m.chaseEntries > chaseAllowance(m)) out.push(`급등 직후에 ${m.chaseEntries}번 샀어요.`)
  if (m.rumorReactions > rumorAllowance(m)) out.push(`소문에 ${m.rumorReactions}번 먼저 움직였어요.`)
  if (m.t40 > 6) out.push(`매매가 ${per40(m)}으로 6번을 넘었어요.`)
  return out
}

const fullHold = (m: RoundMetrics): MissionCheck | null =>
  m.heldRatio >= FULL_HOLD
    ? { verdict: 'ineligible', measure: `거의 내내(${pct0(m.heldRatio)}) 들고 있어서 이번 판은 세지 않았어요.` }
    : null

export const MISSIONS: Record<MissionId, MissionDef> = {
  stopLine: {
    id: 'stopLine',
    habit: 'holder',
    title: '손실이 깊어지기 전에 손 떼기',
    goal: '손실 난 매매가 손절선 아래로 내려가면 1초 안에 팔기. 손절선은 이 차트가 2초에 보통 움직이는 폭의 2배로, 주식이면 -2~3% 정도예요.',
    why: '손실을 오래 버틸수록 되돌리기 어려워져요.',
    need: PASS_NEED,
    window: PASS_WINDOW,
    judge(m) {
      if (!m.stopLosers) return { verdict: 'ineligible', measure: '1초 넘게 들고 있던 손실 매매가 없어서 이번엔 세지 않았어요.' }
      if (!m.stopLate) {
        return { verdict: 'pass', measure: `손실 매매 ${m.stopLosers}개 모두 손절선 ${lossLine(m)} 아래에서 1초 넘게 버티지 않았어요.` }
      }
      return {
        verdict: 'fail',
        measure: `손실 매매 ${m.stopLosers}개 중 ${m.stopLate}개가 손절선 ${lossLine(m)} 아래에서 1초 넘게 버텼어요. 가장 길게는 ${was(secs(m.stopLateSec))}.`,
      }
    },
  },
  lossFirst: {
    id: 'lossFirst',
    habit: 'holder',
    title: '손실 난 것부터 놓기',
    goal: '손실 중일 때 파는 빈도가 수익 중일 때보다 낮지 않게 하기',
    why: '수익은 빨리 팔고 손실은 쥐고 있는 습관을 거꾸로 연습해요.',
    need: PASS_NEED,
    window: PASS_WINDOW,
    judge(m) {
      if (!m.comparableRates) {
        return { verdict: 'ineligible', measure: '수익 중·손실 중에 들고 있던 시간이나 판 횟수가 적어서 세지 않았어요.' }
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
    need: PASS_NEED,
    window: PASS_WINDOW,
    judge(m) {
      if (!m.winTrades || !m.lossTrades) {
        return { verdict: 'ineligible', measure: '수익 난 매매와 손실 난 매매가 둘 다 있는 판에서만 미션을 봐요.' }
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
    need: PASS_NEED,
    window: PASS_WINDOW,
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
    goal: `한 번에 ${LONG_HOLD_SEC}초 이상 계속 누르고 있기 · 매매는 40초에 6번까지`,
    why: '짧게 톡톡 치면 수수료만 나가고 움직임은 놓치기 쉬워요.',
    need: PASS_NEED,
    window: PASS_WINDOW,
    judge(m) {
      const full = fullHold(m)
      if (full) return full
      const ok = m.longestSec >= LONG_HOLD_SEC && m.t40 <= 6
      return {
        verdict: ok ? 'pass' : 'fail',
        measure:
          `가장 길게 든 매매는 ${was(secs(m.longestSec))}. 목표는 ${LONG_HOLD_SEC}초 이상이에요.` +
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
    need: PASS_NEED,
    window: PASS_WINDOW,
    judge(m) {
      if (m.trades < 2) return { verdict: 'ineligible', measure: '매매가 2번 이상인 판에서만 미션을 봐요.' }
      // No spike on the chart: nothing to wait out, so nothing to judge.
      if (m.chaseChance <= 0) return { verdict: 'ineligible', measure: '이번 차트엔 급하게 오른 순간이 없어서 세지 않았어요.' }
      const allow = chaseAllowance(m)
      const ok = m.chaseEntries <= allow
      const extra = allow ? ` 이 차트에선 아무 때나 사도 ${allow}번쯤은 겹쳐서, ${allow}번까지는 괜찮아요.` : ''
      return {
        verdict: ok ? 'pass' : 'fail',
        measure: m.chaseEntries
          ? `${m.trades}번 산 것 중 ${m.chaseEntries}번이 급등 직후였어요.${extra}`
          : `${m.trades}번 산 것 중 급등 직후에 산 건 없었어요.`,
      }
    },
  },
  skipRumor: {
    id: 'skipRumor',
    habit: 'rumor',
    title: '소문엔 먼저 움직이지 않기',
    goal: '소문이 뜨면 가격이 실제로 움직일 때까지 누르거나 떼지 않기',
    why: '이 게임의 소문은 반쯤 틀려서, 먼저 움직이면 동전 던지기와 비슷해요.',
    need: PASS_NEED,
    window: PASS_WINDOW,
    judge(m) {
      if (!m.rumors) return { verdict: 'ineligible', measure: '소문이 없는 판이라 세지 않았어요.' }
      const allow = rumorAllowance(m)
      const ok = m.rumorReactions <= allow
      const extra = allow ? ` 소문이 많은 판이라 아무 때나 눌러도 ${allow}개쯤은 겹쳐서, ${allow}개까지는 괜찮아요.` : ''
      return { verdict: ok ? 'pass' : 'fail', measure: `소문 ${m.rumors}개 중 먼저 움직인 건 ${m.rumorReactions}개였어요.${extra}` }
    },
  },
  filingOnly: {
    id: 'filingOnly',
    habit: 'rumor',
    title: '공식 발표에만 움직이기',
    goal: '소문은 거르고, 공식 발표에는 가격보다 먼저 맞는 방향으로 움직이기',
    why: '확인된 소식과 소문을 가려 읽는 연습이에요.',
    need: PASS_NEED,
    window: PASS_WINDOW,
    judge(m) {
      if (!m.rumors || !m.filings) return { verdict: 'ineligible', measure: '소문과 공식 발표가 둘 다 나온 판에서만 미션을 봐요.' }
      const ok = m.rumorReactions <= rumorAllowance(m) && m.filingReactions >= 1
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
    why: '지켜보기만 하면 습관도 타이밍도 드러나지 않아요. 들어가서 버텨 보는 연습이에요.',
    need: PASS_NEED,
    window: PASS_WINDOW,
    judge(m) {
      const full = fullHold(m)
      if (full) return full
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
    goal: '손실은 손절선 아래로 1초 넘게 버티지 않기, 급등 직후엔 안 사기, 소문엔 먼저 안 움직이기, 매매는 40초에 6번 이하',
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
  if (m.trades < G0.minTrades) return { verdict: 'ineligible', measure: '매매가 없어서 이번엔 세지 않았어요.' }
  // Mashing is exactly what fewTrades is about: a fail, not 판정 없음.
  if (id === 'fewTrades' && m.t40 > G0.maxT40) {
    return { verdict: 'fail', measure: `매매가 ${per40(m)}으로 너무 잦았어요. 목표는 매매 4번 이하, 시간 40% 이상이에요.` }
  }
  if (m.heldRatio < G0.minHeld) {
    return { verdict: 'ineligible', measure: `들고 있던 시간이 ${pct0(m.heldRatio)}로 20%보다 짧아서 세지 않았어요.` }
  }
  if (m.t40 > G0.maxT40) return { verdict: 'ineligible', measure: `매매가 ${per40(m)}으로 너무 잦아서 세지 않았어요.` }
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

const streakOf = (p: MissionProgress) => {
  let streak = 0
  for (let i = p.recent.length - 1; i >= 0 && p.recent[i] === 'pass'; i--) streak++
  return streak
}

/** "최근 4판 중 3번 성공하면 완료예요 · 지금 1번" (rounds with no mission scene don't count). */
export function progressText(p: MissionProgress) {
  if (p.need === p.window) return `${p.need}판 연속 성공하면 완료예요 · 지금 연속 ${streakOf(p)}판`
  return `최근 ${p.window}판 중 ${p.need}번 성공하면 완료예요 · 지금 ${p.passes}번`
}

/** "3번 성공하면 완료 · 지금 1번" for the home chip. */
export function progressShort(p: MissionProgress) {
  if (p.need === p.window) return `${p.need}판 연속이면 완료 · 지금 ${streakOf(p)}판`
  return `${p.need}번 성공하면 완료 · 지금 ${p.passes}번`
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
/** 관망형 who barely holds: get into the market first. */
const WATCHER: MissionId[] = ['stayIn', 'longHold', 'rules3']
/** 기계형, 탐색 중, and 관망형 who hold but hardly trade: skill missions. */
const MACHINE: MissionId[] = ['rules3', 'filingOnly', 'longHold']
/** Every no-habit mission, for the fallback when a whole chain was passed recently. */
const SKILL_POOL: MissionId[] = [...new Set<MissionId>([...MACHINE, ...WATCHER, ...STARTER])]

// Calendar math lives in daily.ts; re-exported for callers that import it from here.
export { daysBetween, weekOf }

export type MissionPick = { id: MissionId; recheck?: boolean; starter?: boolean }

export type PickAvoid = {
  /** No habit more than two weeks running. */
  habit?: HabitKey | 'skill'
  /** The mission just passed. */
  id?: MissionId
  /** Missions that don't fit this moment (stayIn after a round held 50% or more). */
  skip?: readonly MissionId[]
}

/** The holder missions, ordered by what flagged the habit. */
const holderChain = (profile: Profile): MissionId[] =>
  profile.holderBasis === 'rates' ? ['lossFirst', 'stopLine'] : BY_HABIT.holder

/**
 * The mission to work on next. Habits are ranked by the profile's pooled
 * scores and only a significant one (TYPE_MIN, the 5% level) gets a habit
 * mission; otherwise the no-habit skill missions. A mission passed in the
 * last RECHECK_DAYS days is skipped; after that it may come back as a
 * recheck. When every candidate was passed recently, another skill mission
 * is used, and only then the one passed longest ago (never marked recheck).
 */
export function pickMission(profile: Profile | null, done: MissionState['done'], today: string, avoid: PickAvoid = {}): MissionPick {
  const lastPass = (id: MissionId) => done.reduce<string | null>((a, d) => (d.id === id && (!a || d.at > a) ? d.at : a), null)
  const recent = (id: MissionId) => {
    const at = lastPass(id)
    return at !== null && daysBetween(at, today) < RECHECK_DAYS
  }
  const allowed = (id: MissionId) => id !== avoid.id && !avoid.skip?.includes(id)
  const ok = (id: MissionId) => allowed(id) && !recent(id) && MISSIONS[id].habit !== avoid.habit
  const make = (id: MissionId, starter?: boolean): MissionPick => ({
    id,
    ...(starter ? { starter: true } : {}),
    ...(lastPass(id) !== null && !recent(id) ? { recheck: true } : {}),
  })
  const fallback = (chain: MissionId[]): MissionId => {
    const pool = [...new Set<MissionId>([...chain, ...SKILL_POOL])]
    const fresh = pool.find((id) => allowed(id) && !recent(id))
    if (fresh) return fresh
    const byAge = pool.filter(allowed).sort((a, b) => (lastPass(a) ?? '').localeCompare(lastPass(b) ?? ''))
    return byAge[0] ?? chain[0]
  }

  if (!profile) {
    const id = STARTER.find(ok) ?? fallback(STARTER)
    return make(id, true)
  }
  const ranked = HABIT_KEYS.filter((k) => profile.scores[k] >= TYPE_MIN).sort((a, b) => profile.scores[b] - profile.scores[a])
  for (const habit of ranked) {
    const id = (habit === 'holder' ? holderChain(profile) : BY_HABIT[habit]).find(ok)
    if (id) return make(id)
  }
  const chain = profile.type === 'watcher' && (profile.held ?? 0) < STAY_IN_SKIP_HELD ? WATCHER : MACHINE
  return make(chain.find(ok) ?? fallback(chain))
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
  /**
   * Why the mission changed without being completed, for the screen to say
   * (the starter gave way to a profile mission, or the week turned). When
   * set, the old mission's progress no longer applies: don't show it.
   */
  reason?: string
}

/**
 * One round's effect on the mission state: judge it, record the attempt,
 * and move on when the mission is passed. A starter mission stays until it
 * is completed; it gives way to a profile mission only at the week turn or
 * after STARTER_MAX_JUDGED judged rounds. Other missions follow the profile
 * at the week turn. Neither switch ever happens on a round that passed, so a
 * pass is never thrown away. Pure.
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
  // Someone who just held half the round or more is already in the market.
  const skip: MissionId[] = metrics && metrics.heldRatio >= STAY_IN_SKIP_HELD ? ['stayIn'] : []

  const active = state.active
  if (!active) {
    const p = pickMission(profile, state.done, today, { skip })
    return {
      state: { ...state, active: assign(p) },
      outcome: { id: p.id, outcome: 'new', measure: '', progress: progressOf(p.id, []), recheck: p.recheck, next: p },
    }
  }

  const check: MissionCheck = metrics
    ? judgeMission(active.id, metrics)
    : { verdict: 'ineligible', measure: '매매가 없어서 이번엔 세지 않았어요.' }
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
    const p = pickMission(profile, done, today, { id: active.id, skip })
    outcome.completed = true
    outcome.next = p
    return { state: { active: assign(p), done }, outcome }
  }

  let next: MissionPick | null = null
  let reason = ''
  const weekTurned = weekOf(today) > weekOf(active.since)
  if (check.verdict !== 'pass') {
    if (active.starter) {
      if (profile && (weekTurned || attempts.length >= STARTER_MAX_JUDGED)) {
        const p = pickMission(profile, state.done, today, { skip })
        if (p.id !== active.id) {
          next = p
          reason = STARTER_SWITCH_REASON
        }
      }
    } else if (weekTurned) {
      // Weekly change: follow the profile, but never the same habit more
      // than two weeks running.
      const weeks = weekOf(today) - weekOf(active.since)
      const p = pickMission(profile, state.done, today, weeks >= 2 ? { habit: MISSIONS[active.id].habit, skip } : { skip })
      if (p.id !== active.id) {
        next = p
        reason = WEEK_SWITCH_REASON
      }
    }
  }
  if (next) {
    outcome.next = next
    outcome.reason = reason
    return { state: { ...state, active: assign(next) }, outcome }
  }
  return { state: { ...state, active: { ...active, attempts } }, outcome }
}
