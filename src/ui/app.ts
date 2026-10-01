import type { Market } from '../core/market'
import type { ProductKey } from '../core/products'
import type { RoundResult } from '../core/round'

export type Mode = { kind: 'daily'; key: string; day: number } | { kind: 'practice' }

export type Route =
  | { name: 'home' }
  | { name: 'play'; mode: Mode; market: Market }
  | { name: 'result'; mode: Mode; market: Market; result: RoundResult; unlocked?: ProductKey[] }
  | { name: 'habits' }

export type Screen = { el: HTMLElement; destroy?: () => void }

export type Navigate = (route: Route) => void
