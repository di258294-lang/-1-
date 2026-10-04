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
  /** Null for rounds that never count toward missions (replay, tutorial, challenge). */
  mission: MissionOutcome | null
  /** The lesson for the result screen's slot (marked as seen, except on replays). */
  lesson: CoachLesson | null
}

export type RoundOutcome = Coaching & {
  result: RoundResult
  habits: RoundHabits
  /** The stored habit record, or null when the round had no trades or was not recorded. */
  record: HabitRecord | null
  /** Products this round opened in practice. */
  unlocked: ProductKey[]
}

/**
 * What a round is, for deciding what it leaves behind. The play route only
 * knows daily vs practice; play.ts tells the rest apart (ui/tutorial.ts
 * isTutorial, ui/challenge.ts isChallenge, mode.replayOf) with roundKind().
 */
export type RoundKind = 'daily' | 'practice' | 'replay' | 'tutorial' | 'challenge'

export type RoundPolicy = {
  /** Enters the daily or practice record, the habit history and unlocks. */
  record: boolean
  /** Judged against the active mission. */
  coach: boolean
  /** Gets a lesson for the result screen's slot. */
  lesson: boolean
  /** That lesson counts as seen, so it is not shown again. */
  markLesson: boolean
  /** Finishing it marks the first-launch tutorial done. */
  finishesIntro: boolean
}

/**
 * The one place that decides what each kind of round leaves behind:
 *   daily, practice  recorded, coached, a lesson (marked seen)
 *   replay           a known chart: nothing recorded, a lesson but not
 *                    marked seen (it stays for a real round)
 *   tutorial         a guided lesson: nothing recorded, ends the intro
 *   challenge        a friend's chart: nothing recorded at all
 */
export function roundPolicy(kind: RoundKind): RoundPolicy {
  switch (kind) {
    case 'daily':
    case 'practice':
      return { record: true, coach: true, lesson: true, markLesson: true, finishesIntro: false }
    case 'replay':
      return { record: false, coach: false, lesson: true, markLesson: false, finishesIntro: false }
    case 'tutorial':
      return { record: false, coach: false, lesson: false, markLesson: false, finishesIntro: true }
    case 'challenge':
      return { record: false, coach: false, lesson: false, markLesson: false, finishesIntro: false }
  }
}

/** The round kind from the mode plus what only the screens know (tutorial or challenge market). */
export function roundKind(mode: Mode, flags: { tutorial?: boolean; challenge?: boolean } = {}): RoundKind {
  if (mode.kind === 'daily') return 'daily'
  if (flags.tutorial) return 'tutorial'
  if (flags.challenge) return 'challenge'
  return mode.replayOf ? 'replay' : 'practice'
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
  /** What the round is (see roundPolicy). Default: from the mode (daily, replay or practice). */
  kind?: RoundKind
  /** The clock, for tests. Default: Date.now(). */
  now?: number
}

/**
 * Closes a round at the bell and persists everything it produced, as one
 * write: the daily or practice record, the habit record, any unlocks, the
 * mission verdict and the lesson shown, as roundPolicy() allows for its
 * kind. Screens call this once for every round and route on the outcome;
 * they never write to storage themselves.
 */
export function completeRound(mode: Mode, market: Market, round: Round, opts: CompleteOptions = {}): RoundOutcome {
  // A daily mode is always a daily; a practice mode is never one.
  const kind: RoundKind = mode.kind === 'daily' ? 'daily' : opts.kind && opts.kind !== 'daily' ? opts.kind : roundKind(mode)
  const policy = roundPolicy(kind)
  const now = opts.now ?? Date.now()
  if (round.holding) setHolding(round, false)
  advanceTo(round, market.playTicks)
  const result = summarize(round)
  const habits = analyzeRound(market, result.held, result.fees)
  const today = mode.kind === 'daily' ? mode.key : dateKey(now)

  const outcome = save.batch((): RoundOutcome => {
    const unlockedBefore = save.unlockedProducts()
    if (policy.finishesIntro) save.markIntroSeen()

    let counts = policy.record
    if (mode.kind === 'daily') {
      // Refused when the day is already recorded (another tab): then this
      // round leaves nothing else behind either.
      counts = save.recordDaily(mode.key, {
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

    let record: HabitRecord | null = null
    if (counts && habits.trades > 0) {
      record = {
        id: mode.kind === 'daily' ? `d:${mode.key}` : `p:${now}`,
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

    // Missions: judge this round against the active mission (practice and
    // long rounds count too), then move on if it was passed or the week turned.
    let mission: MissionOutcome | null = null
    if (counts && policy.coach) {
      const coach = save.coach()
      const step = advanceMission(coach, roundMetrics(market, result, habits), profileFrom(save.habitRecords()), today)
      mission = step.outcome
      save.updateCoach(() => ({ ...coach, ...step.state }))
    }

    // One lesson at most, never on top of a mission success.
    let lesson: CoachLesson | null = null
    if (policy.lesson && (counts || !policy.record) && mission?.outcome !== 'pass') {
      lesson = pickLesson({ market, result, habits, insight: roundInsight(habits) }, save.coach().lessons)
      if (lesson && policy.markLesson) save.markLessonSeen(lesson.id)
    }

    const unlocked = save.unlockedProducts().filter((k) => !unlockedBefore.includes(k))
    return { result, habits, record, unlocked, mission, lesson }
  })
  coachingByResult.set(result, { mission: outcome.mission, lesson: outcome.lesson })
  return outcome
}
