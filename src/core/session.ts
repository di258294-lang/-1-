import { analyzeRound, profileFrom, roundInsight, type HabitRecord, type RoundHabits } from './habits'
import { pickLesson, type CoachLesson } from './lessons'
import type { Market } from './market'
import { advanceMission, roundMetrics, type MissionOutcome } from './missions'
import type { ProductKey } from './products'
import { setHolding, advanceTo, summarize, type Round, type RoundResult } from './round'
import { dateKey } from './daily'
import { save } from './storage'
import type { Mode } from './types'

/** What the coach says about one round: the mission verdict and one lesson. */
export type Coaching = {
  /** Null for replays and tutorial rounds, which never count toward missions. */
  mission: MissionOutcome | null
  /** The lesson for the result screen's slot, already marked as seen. */
  lesson: CoachLesson | null
}

export type RoundOutcome = Coaching & {
  result: RoundResult
  habits: RoundHabits
  /** The stored habit record, or null when the round had no trades (or was a replay). */
  record: HabitRecord | null
  /** Products this round opened in practice. */
  unlocked: ProductKey[]
}

/**
 * The coaching for each finished round, keyed by its result object, so the
 * result screen can find it without a new route field (main.ts passes the
 * route's fields one by one).
 */
const coachingByResult = new WeakMap<RoundResult, Coaching>()

export function coachingFor(result: RoundResult): Coaching | null {
  return coachingByResult.get(result) ?? null
}

export type CompleteOptions = {
  /**
   * False for rounds that must not coach or count: the guided tutorial.
   * Replays (mode.replayOf) are detected from the mode.
   */
  coach?: boolean
}

/**
 * Closes a round at the bell and persists everything it produced: the daily
 * or practice record, the habit record, any unlocks, the mission verdict and
 * the lesson shown. Screens call this once and route on the outcome; they
 * never write to storage themselves.
 */
export function completeRound(mode: Mode, market: Market, round: Round, opts: CompleteOptions = {}): RoundOutcome {
  const replay = mode.kind === 'practice' && !!mode.replayOf
  const counts = !replay && opts.coach !== false
  const unlockedBefore = save.unlockedProducts()
  if (round.holding) setHolding(round, false)
  advanceTo(round, market.playTicks)
  const result = summarize(round)
  const today = mode.kind === 'daily' ? mode.key : dateKey()

  if (mode.kind === 'daily') {
    save.recordDaily(mode.key, {
      yourReturn: result.yourReturn,
      buyHoldReturn: result.buyHoldReturn,
      held: result.held,
      trades: result.trades,
      title: result.grade.title,
      product: market.product,
    })
  } else if (counts) {
    save.recordPractice(result.yourReturn, result.trades)
  }

  const habits = analyzeRound(market, result.held, result.fees)
  let record: HabitRecord | null = null
  if (habits.trades > 0 && counts) {
    record = {
      id: mode.kind === 'daily' ? `d:${mode.key}` : `p:${Date.now()}`,
      at: today,
      product: market.product,
      length: market.length,
      trades: habits.trades,
      heldRatio: result.heldRatio,
      scores: habits.scores,
      measurable: habits.measurable,
      counts: habits.counts,
      luckPct: null,
      evidence: habits.evidence,
    }
    save.recordHabit(record)
  }

  // Missions: judge this round against the active mission (practice and long
  // rounds count too), then move on if it was passed or the week turned.
  let mission: MissionOutcome | null = null
  if (counts) {
    const metrics = roundMetrics(market, result, habits)
    const profile = profileFrom(save.habitRecords())
    save.updateCoach((c) => {
      const step = advanceMission(c, metrics, profile, today)
      mission = step.outcome
      return { ...c, ...step.state }
    })
  }

  // One lesson at most, never on top of a mission success.
  let lesson: CoachLesson | null = null
  const passed = (mission as MissionOutcome | null)?.outcome === 'pass'
  if (opts.coach !== false && !passed) {
    lesson = pickLesson({ market, result, habits, insight: roundInsight(habits) }, save.coach().lessons)
    if (lesson) save.markLessonSeen(lesson.id)
  }

  const unlocked = save.unlockedProducts().filter((k) => !unlockedBefore.includes(k))
  const coaching: Coaching = { mission, lesson }
  coachingByResult.set(result, coaching)
  return { result, habits, record, unlocked, ...coaching }
}
