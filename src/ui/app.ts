import type { Market } from '../core/market'
import type { ProductKey } from '../core/products'
import type { RoundResult } from '../core/round'

import type { HabitRecord, RoundHabits } from '../core/habits'
import type { Mode } from '../core/types'

export type { Mode }

export type Route =
  | { name: 'home' }
  | { name: 'play'; mode: Mode; market: Market }
  | {
      name: 'result'
      mode: Mode
      market: Market
      result: RoundResult
      unlocked?: ProductKey[]
      habits?: RoundHabits
      record?: HabitRecord | null
    }
  | { name: 'habits' }

export type Screen = {
  el: HTMLElement
  destroy?: () => void
  /** Platform back (Android button, Toss back). True when handled. */
  back?: () => boolean
}

export type Navigate = (route: Route) => void
