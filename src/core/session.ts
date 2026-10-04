import { analyzeRound, type HabitRecord, type RoundHabits } from './habits'
import type { Market } from './market'
import type { ProductKey } from './products'
import { setHolding, advanceTo, summarize, type Round, type RoundResult } from './round'
import { dateKey } from './daily'
import { save } from './storage'
import type { Mode } from './types'

export type RoundOutcome = {
  result: RoundResult
  habits: RoundHabits
  /** The stored habit record, or null when the round had no trades. */
  record: HabitRecord | null
  /** Products this round opened in practice. */
  unlocked: ProductKey[]
}

/**
 * Closes a round at the bell and persists everything it produced: the daily
 * or practice record, the habit record and any unlocks. Screens call this
 * once and route on the outcome; they never write to storage themselves.
 */
export function completeRound(mode: Mode, market: Market, round: Round): RoundOutcome {
  const unlockedBefore = save.unlockedProducts()
  if (round.holding) setHolding(round, false)
  advanceTo(round, market.playTicks)
  const result = summarize(round)

  if (mode.kind === 'daily') {
    save.recordDaily(mode.key, {
      yourReturn: result.yourReturn,
      buyHoldReturn: result.buyHoldReturn,
      held: result.held,
      trades: result.trades,
      title: result.grade.title,
      product: market.product,
    })
  } else {
    save.recordPractice(result.yourReturn)
  }

  const habits = analyzeRound(market, result.held, result.fees)
  let record: HabitRecord | null = null
  if (habits.trades > 0) {
    record = {
      id: mode.kind === 'daily' ? `d:${mode.key}` : `p:${Date.now()}`,
      at: mode.kind === 'daily' ? mode.key : dateKey(),
      product: market.product,
      length: market.length,
      trades: habits.trades,
      heldRatio: result.heldRatio,
      scores: habits.scores,
      measurable: habits.measurable,
      counts: habits.counts,
      luckPct: null,
    }
    save.recordHabit(record)
  }

  const unlocked = save.unlockedProducts().filter((k) => !unlockedBefore.includes(k))
  return { result, habits, record, unlocked }
}
