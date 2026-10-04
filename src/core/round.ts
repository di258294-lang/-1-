import { playPrice, TICKS_PER_SECOND, TRADING_DAYS_PER_YEAR, type Market } from './market'

export const START_EQUITY = 10_000_000
/** Stock fee, charged on every buy and every sell. Other products set their own. */
export const FEE_RATE = 0.001
/**
 * Interest on idle cash, per year, like a Korean savings deposit. A one-month
 * round earns about 0.25%, a one-year round about 3%: sitting out is a real
 * choice, not a free win.
 */
export const CASH_RATE_ANNUAL = 0.03

export function cashRatePerTick(market: Market) {
  return (1 + CASH_RATE_ANNUAL) ** (1 / (TRADING_DAYS_PER_YEAR * market.ticksPerDay)) - 1
}

export type Round = {
  market: Market
  startEquity: number
  tick: number
  holding: boolean
  equity: number
  fees: number
  interest: number
  trades: number
  /** held[t] is true when the position was open from tick t to t + 1. */
  held: boolean[]
  /** Equity after each tick, index 0 is the start. */
  equityCurve: number[]
  /** Equity when the current position was opened, for the live P&L. */
  entryEquity: number
}

export function createRound(market: Market, startEquity = START_EQUITY): Round {
  return {
    market,
    startEquity,
    tick: 0,
    holding: false,
    equity: startEquity,
    fees: 0,
    interest: 0,
    trades: 0,
    held: [],
    equityCurve: [startEquity],
    entryEquity: startEquity,
  }
}

export function isOver(round: Round) {
  return round.tick >= round.market.playTicks
}

export function setHolding(round: Round, holding: boolean) {
  if (round.holding === holding) return
  // After the bell you can only close, never open.
  if (holding && isOver(round)) return
  const fee = round.equity * round.market.feeRate
  round.equity -= fee
  round.fees += fee
  round.holding = holding
  if (holding) {
    round.trades += 1
    round.entryEquity = round.equity
  }
}

/** Advance the simulation up to (and including) the given play tick. */
export function advanceTo(round: Round, target: number) {
  const end = Math.min(target, round.market.playTicks)
  const cashRate = cashRatePerTick(round.market)
  while (round.tick < end) {
    const t = round.tick
    if (round.holding) {
      round.equity *= playPrice(round.market, t + 1) / playPrice(round.market, t)
    } else {
      const earned = round.equity * cashRate
      round.equity += earned
      round.interest += earned
    }
    round.held[t] = round.holding
    round.tick = t + 1
    round.equityCurve.push(round.equity)
  }
  if (isOver(round) && round.holding) {
    // Positions are closed at the bell.
    setHolding(round, false)
    round.equityCurve[round.equityCurve.length - 1] = round.equity
  }
}

export type Grade = { title: string; line: string }

export type RoundResult = {
  startEquity: number
  finalEquity: number
  yourReturn: number
  buyHoldReturn: number
  perfectReturn: number
  /** What the money would have earned sitting in cash the whole time. */
  cashReturn: number
  trades: number
  fees: number
  interest: number
  heldRatio: number
  held: boolean[]
  grade: Grade
}

/**
 * Best possible result if you could switch once per second with perfect
 * hindsight. Per-tick hindsight would be a meaningless, inhuman number.
 */
export function perfectReturn(market: Market) {
  const step = TICKS_PER_SECOND
  let r = 1
  const end = market.playTicks
  for (let t = 0; t < end; t += step) {
    const move = playPrice(market, Math.min(t + step, end)) / playPrice(market, t)
    if (move > 1) r *= move
  }
  return r - 1
}

export function gradeFor(yourReturn: number, buyHold: number, heldRatio: number): Grade {
  const edge = (yourReturn - buyHold) * 100
  const gap = `${Math.abs(edge).toFixed(1)}%p`
  if (heldRatio === 0) {
    return buyHold < 0
      ? { title: '현금이 정답이었어요', line: '아무것도 안 한 게 최고의 수였어요.' }
      : { title: '구경만 했어요', line: '오르는 동안 손을 떼고 있었어요.' }
  }
  if (edge >= 15) return { title: '타이밍 장인', line: `그냥 들고 있는 것보다 ${gap} 앞섰어요.` }
  if (edge >= 5) return { title: '감이 좋아요', line: `그냥 들고 있는 것보다 ${gap} 잘했어요.` }
  if (edge >= 0.5) return { title: '시장보다 조금 나았어요', line: `그냥 들고 있는 것보다 ${gap} 나았어요.` }
  if (edge > -0.5) return { title: '시장만큼 했어요', line: '그냥 들고 있는 것과 거의 같아요.' }
  if (edge > -10) return { title: '한 박자 늦었어요', line: `그냥 들고 있었으면 ${gap} 더 나았어요.` }
  return { title: '거꾸로 탔어요', line: `그냥 들고 있었으면 ${gap} 더 나았어요.` }
}

export function summarize(round: Round): RoundResult {
  const first = playPrice(round.market, 0)
  const last = playPrice(round.market, round.market.playTicks)
  const buyHoldReturn = last / first - 1
  const yourReturn = round.equity / round.startEquity - 1
  const heldTicks = round.held.filter(Boolean).length
  const heldRatio = round.held.length ? heldTicks / round.held.length : 0
  return {
    startEquity: round.startEquity,
    finalEquity: round.equity,
    yourReturn,
    buyHoldReturn,
    perfectReturn: perfectReturn(round.market),
    cashReturn: (1 + cashRatePerTick(round.market)) ** round.market.playTicks - 1,
    trades: round.trades,
    fees: round.fees,
    interest: round.interest,
    heldRatio,
    held: [...round.held],
    grade: gradeFor(yourReturn, buyHoldReturn, heldRatio),
  }
}
