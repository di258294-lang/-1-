import { formatPct } from './format'
import { tickVolatility } from './habits'
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

/** Edges smaller than this (half a percent of the account) read as "the same as the market", when the round's scale is unknown. */
export const EVEN_EDGE = 0.005
/** "크게" starts here when the round's scale is unknown. */
export const BIG_EDGE = 0.05
/**
 * With a scale s (how far this chart usually moves over the whole round, one
 * standard deviation, as a return), "크게" starts at 1.0·s and "비김" ends at
 * 0.1·s, so every product gets its titles about equally often. The "비김"
 * band never shrinks below 0.1%, the smallest gap the screen can show.
 */
export const BIG_SCALE = 1
export const EVEN_SCALE = 0.1
export const EVEN_FLOOR = 0.001

/** The "비김" and "크게" thresholds for a round with this scale (defaults without one). */
export function gradeEdges(scale?: number): { even: number; big: number } {
  if (!scale || !Number.isFinite(scale) || scale <= 0) return { even: EVEN_EDGE, big: BIG_EDGE }
  return { even: Math.max(EVEN_FLOOR, EVEN_SCALE * scale), big: Math.max(2 * EVEN_FLOOR, BIG_SCALE * scale) }
}

/** A return in tenths of a percent, rounded exactly as formatPct(x, 1) shows it. */
export const shownTenths = (x: number) => Math.round(Number(formatPct(x, 1).replace('%', '')) * 10)

/**
 * The headline for a round: task-level ("시장보다 앞섰어요"), never a label
 * for the person, and never contradicting the numbers under it. A gain is
 * never called a loss or "거꾸로", a loss is never praised, and "ahead" or
 * "behind" always matches the gap to simply holding. Big wins carry a luck
 * caveat (learning-design report §6). Tested by sweeping in round.test.ts.
 *
 * The gap in the line comes from the two returns as the screen shows them
 * (one decimal), so "나 +3.2% · 시장 +11.3%" always reads "8.1%", and a gap
 * that rounds to 0.0% is "시장만큼" whatever the raw edge.
 *
 * @param scale The round's own volatility (roundScale); optional.
 */
export function gradeFor(yourReturn: number, buyHold: number, heldRatio: number, scale?: number): Grade {
  const { even, big } = gradeEdges(scale)
  const edge = yourReturn - buyHold
  const gapT = Math.abs(shownTenths(yourReturn) - shownTenths(buyHold))
  const gap = `${(gapT / 10).toFixed(1)}%`
  const market = formatPct(buyHold, 1)
  const same = Math.abs(edge) < even || gapT === 0
  if (heldRatio === 0) {
    return buyHold < 0
      ? { title: '현금으로 비켜 있었어요', line: `가격이 ${market} 움직이는 동안 손을 떼고 이자만 받았어요.` }
      : { title: '지켜보기만 했어요', line: `가격이 ${market} 움직이는 동안 손을 떼고 이자만 받았어요.` }
  }
  if (yourReturn >= 0) {
    if (same) return { title: '시장만큼 했어요', line: '그냥 들고 있는 것과 거의 같아요.' }
    if (edge >= big) return { title: '시장보다 크게 앞섰어요', line: `그냥 들고 있는 것보다 ${gap} 더 벌었어요. 운도 큰 몫을 했을 수 있어요.` }
    if (edge > 0) return { title: '시장보다 앞섰어요', line: `그냥 들고 있는 것보다 ${gap} 더 벌었어요.` }
    return { title: '올랐는데 덜 탔어요', line: `그냥 들고 있었으면 ${gap} 더 벌었어요.` }
  }
  if (same) {
    // A small loss while the market rose a little: "시장만큼 잃었어요" would be false.
    return buyHold >= 0
      ? { title: '시장만큼 했어요', line: `시장은 ${market}, 나는 ${formatPct(yourReturn, 1)}로 거의 같아요.` }
      : { title: '시장만큼 잃었어요', line: '그냥 들고 있는 것과 거의 같아요.' }
  }
  if (edge > 0) return { title: '시장보다 덜 잃었어요', line: `그냥 들고 있었으면 ${gap} 더 잃었어요.` }
  if (buyHold >= 0) return { title: '거꾸로 탔어요', line: `시장은 ${market}였는데 손실이 났어요. 그냥 들고 있었으면 ${gap} 더 나았어요.` }
  return { title: '시장보다 더 잃었어요', line: `그냥 들고 있었으면 ${gap} 덜 잃었어요.` }
}

/**
 * How far this chart usually moves over the whole round: the tick volatility
 * (news gaps left out, as the habit measures do) times √ticks. About 5% for a
 * short stock round, 0.4% for bonds, 12% for coin.
 */
export function roundScale(market: Market) {
  return tickVolatility(market) * Math.sqrt(market.playTicks)
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
    grade: gradeFor(yourReturn, buyHoldReturn, heldRatio, roundScale(round.market)),
  }
}
