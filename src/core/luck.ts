import { playPrice, type Market } from './market'
import { createSfc32, hashString } from './rng'
import { cashRatePerTick } from './round'

/**
 * Was it skill or luck? Keeps the player's own holding runs (same number,
 * same lengths, so the same fees and the same time in the market) and drops
 * them at uniformly random places on the same chart, many times. If the
 * player's return beats most of those placements, their timing did
 * something a random placement rarely does.
 *
 * The null is exact: every arrangement of the runs (any order, any gaps,
 * with at least one cash tick between runs) is equally likely, so for a
 * player whose timing ignores prices the p-value is uniform.
 */
export type LuckResult = {
  /** Share of random placements that did worse, 0..1 (ties count half). For drawing. */
  percentile: number
  /**
   * Phipson-Smyth p-value: (1 + placements doing at least as well) / (sims + 1).
   * It is P(a random placement does at least this well), not P(luck).
   */
  pValue: number
  sims: number
  /** Sorted random-placement returns, for drawing the distribution. */
  nullReturns: number[]
  playerReturn: number
  /** Number of holding runs that were placed. */
  runs: number
}

export const LUCK_SIMS = 1000

/** Returns closer than this count as ties (float noise between equal placements). */
const TIE = 1e-9

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

/** Lengths of the consecutive held stretches, in order. */
function holdingRuns(held: ArrayLike<boolean>, n: number) {
  const runs: number[] = []
  let t = 0
  while (t < n) {
    if (!held[t]) {
      t++
      continue
    }
    const start = t
    while (t < n && held[t]) t++
    runs.push(t - start)
  }
  return runs
}

/**
 * @param playerReturn Overrides the player's return, for example when the
 *   round engine charged fees for taps shorter than a tick that `held`
 *   cannot show. Defaults to pathReturn(market, held).
 */
export function luckTest(market: Market, held: boolean[], sims = LUCK_SIMS, playerReturn?: number): LuckResult | null {
  const n = market.playTicks
  const runs = holdingRuns(held, n)
  const k = runs.length
  let heldTicks = 0
  for (const r of runs) heldTicks += r
  // Never trading, or holding all the way, leaves nothing to compare.
  if (k === 0 || heldTicks >= n - 2) return null

  // Stars and bars: k + 1 cash gaps summing to F = n - H, interior gaps >= 1.
  // Choosing k bar positions among `slots` = free + k places, uniformly,
  // gives a uniform composition of `free`; adding 1 per interior gap gives
  // a uniform valid placement.
  const free = n - heldTicks - (k - 1)
  const slots = free + k

  // Fees and cash interest depend only on the number of runs and the cash
  // ticks, which every placement shares, so only the price legs vary.
  const prices = new Float64Array(n + 1)
  for (let t = 0; t <= n; t++) prices[t] = playPrice(market, t)
  let shared = (1 - market.feeRate) ** (2 * k)
  const cash = 1 + cashRatePerTick(market)
  for (let t = 0; t < n - heldTicks; t++) shared *= cash

  const own = playerReturn ?? pathReturn(market, held)

  // A separate generator family from the chart's, seeded by the chart and the run pattern.
  const rng = createSfc32(hashString(`luck|${market.product}|${market.length}|${market.seed}|${n}|${runs.join(',')}`))
  const order = Int32Array.from(runs)
  const mark = new Uint8Array(slots)
  const nullReturns = new Array<number>(sims)
  for (let s = 0; s < sims; s++) {
    // Shuffle the run order (Fisher-Yates).
    for (let i = k - 1; i > 0; i--) {
      const j = rng.int(0, i)
      const tmp = order[i]
      order[i] = order[j]
      order[j] = tmp
    }
    // Floyd's algorithm: a uniform k-subset of the slots.
    mark.fill(0)
    for (let j = slots - k; j < slots; j++) {
      const r = rng.int(0, j)
      if (mark[r]) mark[j] = 1
      else mark[r] = 1
    }
    // Walk the slots: unmarked ones are cash ticks, marked ones start a run.
    let growth = 1
    let pos = 0
    let gap = 0
    let run = 0
    for (let i = 0; i < slots; i++) {
      if (!mark[i]) {
        gap++
        continue
      }
      pos += gap + (run > 0 ? 1 : 0)
      gap = 0
      const len = order[run++]
      growth *= prices[pos + len] / prices[pos]
      pos += len
    }
    nullReturns[s] = shared * growth - 1
  }
  nullReturns.sort((a, b) => a - b)

  let below = 0
  let ties = 0
  for (const r of nullReturns) {
    if (r < own - TIE) below++
    else if (r <= own + TIE) ties++
  }
  const atLeast = sims - below
  return {
    percentile: (below + ties / 2) / sims,
    pValue: (1 + atLeast) / (sims + 1),
    sims,
    nullReturns,
    playerReturn: own,
    runs: k,
  }
}

export type LuckVerdict = { headline: string; line: string; note: string }

/** "약 3%예요", "1% 미만이에요" for a probability. */
function chanceIs(p: number) {
  return p < 0.01 ? '1% 미만이에요' : `약 ${Math.round(p * 100)}%예요`
}

/**
 * Plain-language reading. The number is how often a random placement of the
 * same runs does at least as well. It is not the probability that the
 * result was luck, and one round can never settle skill.
 */
export function luckVerdict(result: LuckResult): LuckVerdict {
  const sims = result.sims.toLocaleString('ko-KR')
  const p = result.pValue
  const top = Math.max(1, Math.round((1 - result.percentile) * 100))
  const bottom = Math.max(1, Math.round(result.percentile * 100))
  const headline = result.percentile >= 0.5 ? `무작위 배치 ${sims}번 중 상위 ${top}%` : `무작위 배치 ${sims}번 중 하위 ${bottom}%`
  const note = `내가 들고 있던 구간들의 길이는 그대로 두고, 같은 차트에서 위치만 무작위로 ${sims}번 바꿔 본 결과와 비교했어요.`
  // Frequency wording only: how often random placements did this well.
  // Never P(skill | result): by chance alone a player lands in the top 5%
  // about once in 20 rounds.
  const odds = `아무렇게나 누른 가상 플레이어 중 이만큼 이상 낸 경우는 ${chanceIs(p)}.`
  const once = '한 판만으로 실력이라고 단정할 수는 없어요.'
  if (p <= 0.05) return { headline, line: `${odds} 드문 결과지만, 운만으로도 20판에 한 번쯤은 이렇게 나와요. ${once}`, note }
  if (p <= 0.2) return { headline, line: `${odds} 꽤 잘했지만, ${once}`, note }
  if (result.percentile >= 0.3) return { headline, line: `${odds} 아무 때나 누른 것과 크게 다르지 않아요.`, note }
  return { headline, line: '같은 길이로 아무 때나 눌러도 이보다 나은 경우가 더 많았어요.', note }
}
