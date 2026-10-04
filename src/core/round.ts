import { formatPct } from './format'
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
  /** Tick and fee of the last sell, so a re-press inside the same tick can undo it. */
  lastExit: { tick: number; fee: number } | null
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
    lastExit: null,
  }
}

export function isOver(round: Round) {
  return round.tick >= round.market.playTicks
}

export function setHolding(round: Round, holding: boolean) {
  if (round.holding === holding) return
  // After the bell you can only close, never open.
  if (holding && isOver(round)) return
  const t = round.tick
  // Released and pressed again inside one tick: the position never really
  // closed, so the sell is undone instead of counting a second trade.
  if (holding && round.lastExit?.tick === t) {
    round.equity += round.lastExit.fee
    round.fees -= round.lastExit.fee
    round.lastExit = null
    round.holding = true
    return
  }
  const fee = round.equity * round.market.feeRate
  round.equity -= fee
  round.fees += fee
  round.holding = holding
  if (holding) {
    round.trades += 1
    round.entryEquity = round.equity
    // A quick tap that opens and closes inside one tick still held that tick.
    round.held[t] = true
  } else {
    round.lastExit = { tick: t, fee }
  }
}

/** Advance the simulation up to (and including) the given play tick. */
export function advanceTo(round: Round, target: number) {
  const end = Math.min(target, round.market.playTicks)
  const cashRate = cashRatePerTick(round.market)
  while (round.tick < end) {
    const t = round.tick
    const held = round.holding || round.held[t] === true
    if (held) {
      round.equity *= playPrice(round.market, t + 1) / playPrice(round.market, t)
    } else {
      const earned = round.equity * cashRate
      round.equity += earned
      round.interest += earned
    }
    round.held[t] = held
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

/** Edges smaller than this (half a percent of the account) read as "the same as the market". */
export const EVEN_EDGE = 0.005

/**
 * The headline for a round: task-level ("시장보다 앞섰어요"), never a label
 * for the person, and never contradicting the numbers under it. A gain is
 * never called a loss or "거꾸로", a loss is never praised, and "ahead" or
 * "behind" always matches the gap to simply holding. Big wins carry a luck
 * caveat (learning-design report §6). Tested by sweeping in round.test.ts.
 */
export function gradeFor(yourReturn: number, buyHold: number, heldRatio: number): Grade {
  const edge = yourReturn - buyHold
  const gap = `${Math.abs(edge * 100).toFixed(1)}%`
  const market = formatPct(buyHold, 1)
  if (heldRatio === 0) {
    return buyHold < 0
      ? { title: '현금으로 비켜 있었어요', line: `가격이 ${market} 움직이는 동안 손을 떼고 이자만 받았어요.` }
      : { title: '지켜보기만 했어요', line: `가격이 ${market} 움직이는 동안 손을 떼고 이자만 받았어요.` }
  }
  if (yourReturn >= 0) {
    if (edge >= 0.05) return { title: '시장보다 크게 앞섰어요', line: `그냥 들고 있는 것보다 ${gap} 더 벌었어요. 운도 큰 몫을 했을 수 있어요.` }
    if (edge >= EVEN_EDGE) return { title: '시장보다 앞섰어요', line: `그냥 들고 있는 것보다 ${gap} 더 벌었어요.` }
    if (edge > -EVEN_EDGE) return { title: '시장만큼 했어요', line: '그냥 들고 있는 것과 거의 같아요.' }
    return { title: '올랐는데 덜 탔어요', line: `그냥 들고 있었으면 ${gap} 더 벌었어요.` }
  }
  if (edge >= EVEN_EDGE) return { title: '시장보다 덜 잃었어요', line: `그냥 들고 있었으면 ${gap} 더 잃었어요.` }
  if (edge > -EVEN_EDGE) return { title: '시장만큼 잃었어요', line: '그냥 들고 있는 것과 거의 같아요.' }
  if (buyHold >= 0) return { title: '거꾸로 탔어요', line: `시장은 ${market}였는데 손실이 났어요. 그냥 들고 있었으면 ${gap} 더 나았어요.` }
  return { title: '시장보다 더 잃었어요', line: `그냥 들고 있었으면 ${gap} 덜 잃었어요.` }
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
