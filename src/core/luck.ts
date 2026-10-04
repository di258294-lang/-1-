import { playPrice, type Market } from './market'
import { createRng, hashString } from './rng'
import { cashRatePerTick } from './round'

/**
 * Was it skill or luck? Replays the same chart with many random traders who
 * share the player's style: the same expected number of trades and the same
 * share of time in the market (a two-state Markov chain). The player's
 * percentile among them is a permutation-style test of skill.
 */
export type LuckResult = {
  /** Share of random traders who did worse, 0..1 (ties count half). */
  percentile: number
  sims: number
  /** Sorted random-trader returns, for drawing the distribution. */
  nullReturns: number[]
  playerReturn: number
}

export const LUCK_SIMS = 1000

/** Return of a hold/cash path with the game's fees and cash interest. */
export function pathReturn(market: Market, held: ArrayLike<boolean>) {
  const cash = cashRatePerTick(market)
  const fee = market.feeRate
  let equity = 1
  let holding = false
  for (let t = 0; t < market.playTicks; t++) {
    if (held[t] !== holding) {
      equity *= 1 - fee
      holding = held[t]
    }
    if (holding) equity *= playPrice(market, t + 1) / playPrice(market, t)
    else equity *= 1 + cash
  }
  if (holding) equity *= 1 - fee
  return equity - 1
}

export function luckTest(market: Market, held: boolean[], sims = LUCK_SIMS): LuckResult | null {
  const n = market.playTicks
  let heldTicks = 0
  let entries = 0
  for (let t = 0; t < n; t++) {
    if (held[t]) heldTicks++
    if (held[t] && (t === 0 || !held[t - 1])) entries++
  }
  // Never trading, or holding all the way, leaves nothing to compare.
  if (entries === 0 || heldTicks >= n - 2) return null

  const pi = heldTicks / n
  const pOn = Math.min(1, entries / (n - heldTicks))
  const pOff = Math.min(1, entries / heldTicks)
  const rng = createRng((market.seed ^ hashString(`${entries}/${heldTicks}`)) >>> 0)

  const path = new Array<boolean>(n)
  const nullReturns = new Array<number>(sims)
  for (let s = 0; s < sims; s++) {
    let on = rng.next() < pi
    for (let t = 0; t < n; t++) {
      if (t > 0) on = on ? rng.next() >= pOff : rng.next() < pOn
      path[t] = on
    }
    nullReturns[s] = pathReturn(market, path)
  }
  nullReturns.sort((a, b) => a - b)

  const playerReturn = pathReturn(market, held)
  let below = 0
  let ties = 0
  for (const r of nullReturns) {
    if (r < playerReturn - 1e-12) below++
    else if (Math.abs(r - playerReturn) <= 1e-12) ties++
  }
  return { percentile: (below + ties / 2) / sims, sims, nullReturns, playerReturn }
}

export type LuckVerdict = { headline: string; line: string }

/** Plain-language reading of the percentile, honest about uncertainty. */
export function luckVerdict(result: LuckResult): LuckVerdict {
  const top = Math.max(1, Math.round((1 - result.percentile) * 100))
  const p = result.percentile
  const headline = p >= 0.5 ? `아무렇게나 누른 ${result.sims.toLocaleString('ko-KR')}판 중 상위 ${top}%` : `아무렇게나 누른 ${result.sims.toLocaleString('ko-KR')}판 중 하위 ${Math.max(1, Math.round(p * 100))}%`
  if (p >= 0.95) return { headline, line: `운만으로 이 정도가 나올 확률은 ${Math.max(1, Math.round((1 - p) * 100))}% 정도예요. 실력일 가능성이 커요.` }
  if (p >= 0.8) return { headline, line: '무작위보다 꽤 잘했어요. 다만 한 판만으로는 운일 가능성도 남아 있어요.' }
  if (p >= 0.4) return { headline, line: '같은 횟수로 아무렇게나 누른 것과 비슷해요. 이번 판은 운의 영향이 컸어요.' }
  return { headline, line: '같은 횟수로 아무렇게나 눌러도 이보다 나은 경우가 더 많았어요.' }
}
