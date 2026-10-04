import { PRODUCTS, type Product, type ProductKey } from './products'
import { createRng, type Rng } from './rng'

export const TICKS_PER_SECOND = 10
/** Headlines land this many ticks before the price reacts (1.6 s). */
export const NEWS_LEAD_TICKS = 16
export const TRADING_DAYS_PER_YEAR = 252

/**
 * Round lengths. Each one compresses a span of trading days into wall-clock
 * seconds; the model runs in calendar time, so volatility and interest
 * scale correctly between them.
 */
export type RoundLength = 'short' | 'long'

export const LENGTHS: Record<RoundLength, { seconds: number; days: number; historyDays: number; label: string }> = {
  short: { seconds: 40, days: 20, historyDays: 6, label: '한 달' },
  long: { seconds: 300, days: 250, historyDays: 20, label: '1년' },
}

export type Company = {
  name: string
  code: string
  sector: string
  /** Bonds only: modified duration and convexity, in years. */
  duration?: number
  convexity?: number
}

export type NewsKind = 'filing' | 'rumor'

export type NewsEvent = {
  /** Play-relative tick when the headline appears. */
  at: number
  /** Play-relative tick when the price starts reacting. */
  impactAt: number
  kind: NewsKind
  /** Headline with the company name, shown after the round. */
  headline: string
  /** Same headline with the name hidden, shown during the round. */
  blindHeadline: string
  /** Direction the headline implies for the price. */
  implied: 1 | -1
  /** Direction the price actually took. */
  actual: 1 | -1
}

export type Market = {
  seed: number
  product: ProductKey
  length: RoundLength
  company: Company
  playTicks: number
  historyTicks: number
  ticksPerDay: number
  /** Absolute series: historyTicks + playTicks + 1 prices. */
  prices: number[]
  /** Leveraged products: the index the product tracks. */
  underlying?: number[]
  /** Bonds: the simulated yield, in decimal. */
  yields?: number[]
  news: NewsEvent[]
  feeRate: number
}

/** The stock universe, kept as a named export for tests and older callers. */
export const COMPANIES = PRODUCTS.stock.assets

// Market microstructure shared by every product.
/** GARCH(1,1) per tick: shock and persistence weights (alpha + beta < 1). */
const GARCH_ALPHA = 0.1
const GARCH_BETA = 0.89
/** Probability a regime survives one trading day (mean length 10 days). */
const REGIME_STAY_PER_DAY = 0.9
/**
 * Drift of a trending regime, as a multiple of the noise volatility. This
 * makes a typical trend about one standard deviation over its life, so it is
 * readable instead of pure noise. It is a game choice; the variance budget
 * below keeps the total annual volatility realistic anyway.
 */
const TREND_TO_VOL = 5
/** Mean regime length in years (1 / (1 - stay) trading days). */
const REGIME_YEARS = 1 / (1 - REGIME_STAY_PER_DAY) / 252
/** E[m^2] for the log-normal jump multiplier m = exp(0.35 z - 0.06). */
const JUMP_SIZE_M2 = Math.exp(2 * -0.06 + 2 * 0.35 * 0.35)

/**
 * Splits a product's total annual variance into news jumps, regime drift and
 * tick noise. Returns the noise volatility. Regime drift of +/-k*s (or 0)
 * lasting l years adds about (4/3) k^2 s^2 l per year of variance.
 */
export function noiseVolatility(totalVol: number, newsPerDay: number, jump: number) {
  const jumpVar = newsPerDay * TRADING_DAYS_PER_YEAR * jump * jump * JUMP_SIZE_M2
  const regimeFactor = (4 / 3) * TREND_TO_VOL * TREND_TO_VOL * REGIME_YEARS
  // Never let the noise vanish entirely, even if jumps alone exceed the budget.
  const left = Math.max(0.25 * totalVol * totalVol, totalVol * totalVol - jumpVar)
  return Math.sqrt(left / (1 + regimeFactor))
}

type Regime = 'up' | 'down' | 'flat'
const REGIMES: readonly Regime[] = ['up', 'down', 'flat']
const REGIME_SIGN: Record<Regime, number> = { up: 1, down: -1, flat: 0 }

/** Student-t with integer dof, scaled to unit variance. */
function studentT(rng: Rng, nu: number) {
  let chi2 = 0
  for (let i = 0; i < nu; i++) {
    const g = rng.gauss()
    chi2 += g * g
  }
  return (rng.gauss() / Math.sqrt(chi2 / nu)) * Math.sqrt((nu - 2) / nu)
}

function headlines(template: string, product: Product, company: Company) {
  return {
    headline: template.replace('{n}', company.name),
    blindHeadline: template.replace('{n}', product.blindName),
  }
}

/** Poisson arrivals over the play window, spaced so toasts never overlap. */
function planNews(rng: Rng, product: Product, company: Company, playTicks: number, ticksPerDay: number) {
  const rate = product.model.newsPerDay / ticksPerDay
  const minGap = NEWS_LEAD_TICKS + 44
  const last = playTicks - NEWS_LEAD_TICKS - 30
  const events: NewsEvent[] = []
  let t = 40
  for (;;) {
    t += Math.max(minGap, Math.round(-Math.log(1 - rng.next()) / rate))
    if (t > last) break
    events.push(newsAt(rng, product, company, t))
  }
  // A round with no headline at all teaches nothing; guarantee one.
  if (!events.length) events.push(newsAt(rng, product, company, rng.int(60, Math.max(61, last))))
  return events
}

function newsAt(rng: Rng, product: Product, company: Company, at: number): NewsEvent {
  const kind: NewsKind = rng.chance(1 - product.rumorShare) ? 'filing' : 'rumor'
  const implied: 1 | -1 = rng.chance(0.5) ? 1 : -1
  // Filings are facts. Rumors are a coin flip, so trading on them is gambling.
  const actual: 1 | -1 = kind === 'filing' || rng.chance(0.5) ? implied : ((-implied) as 1 | -1)
  const set = kind === 'filing' ? product.filings : product.rumors
  return {
    at,
    impactAt: at + NEWS_LEAD_TICKS,
    kind,
    ...headlines(rng.pick(implied > 0 ? set.up : set.down), product, company),
    implied,
    actual,
  }
}

export function generateMarket(seed: number, productKey: ProductKey = 'stock', length: RoundLength = 'short'): Market {
  const product = PRODUCTS[productKey]
  const model = product.model
  const timing = LENGTHS[length]
  const ticksPerDay = Math.round((timing.seconds * TICKS_PER_SECOND) / timing.days)
  const playTicks = timing.days * ticksPerDay
  const historyTicks = timing.historyDays * ticksPerDay
  const total = historyTicks + playTicks + 1
  const dt = 1 / (TRADING_DAYS_PER_YEAR * ticksPerDay)

  const rng = createRng(seed)
  const company = rng.pick(product.assets)
  const news = planNews(rng, product, company, playTicks, ticksPerDay)

  // News jumps keyed by absolute tick. Sizes vary log-normally around the
  // product's typical jump; a false rumor hits as hard as a true one.
  const jumps = new Map<number, number>()
  for (const ev of news) {
    const size = model.jump * Math.exp(0.35 * rng.gauss() - 0.06)
    // Real prices gap on news in a single step. Spreading a jump over several
    // ticks would fake momentum (positive return autocorrelation).
    const abs = historyTicks + ev.impactAt
    jumps.set(abs, (jumps.get(abs) ?? 0) + ev.actual * size)
  }

  // Regime-switching drift (a three-state Markov chain).
  const stay = REGIME_STAY_PER_DAY ** (1 / ticksPerDay)
  let regime: Regime = rng.pick(REGIMES)
  const nextRegime = () => {
    if (rng.next() < stay) return regime
    return rng.pick(REGIMES.filter((r) => r !== regime))
  }

  // GARCH(1,1) variance, started at its long-run level.
  const noiseVol = noiseVolatility(model.bond ? model.bond.sigmaYield : model.sigma, model.newsPerDay, model.jump)
  const longRunVar = noiseVol * noiseVol * dt
  const omega = longRunVar * (1 - GARCH_ALPHA - GARCH_BETA)
  let variance = longRunVar
  let lastShock = 0
  const shock = () => {
    variance = omega + GARCH_ALPHA * lastShock * lastShock + GARCH_BETA * variance
    lastShock = Math.sqrt(variance) * studentT(rng, model.tailNu)
    return lastShock
  }

  const base = new Array<number>(total)
  base[0] = rng.range(...product.priceRange)

  if (model.bond) {
    // Vasicek yield with regime drift; price through duration and convexity,
    // plus the coupon carry the bond earns while you hold it.
    const { yield0, kappa } = model.bond
    const D = company.duration ?? 7
    const C = company.convexity ?? 50
    const yields = new Array<number>(total)
    let y = yield0 + rng.range(-0.005, 0.005)
    yields[0] = y
    for (let i = 1; i < total; i++) {
      regime = nextRegime()
      // Yield trends the opposite way of the price regime.
      const trend = -REGIME_SIGN[regime] * TREND_TO_VOL * noiseVol
      // A bullish headline means yields fall.
      const jump = -(jumps.get(i) ?? 0)
      const dy = kappa * (yield0 - y) * dt + trend * dt + shock() + jump
      y += dy
      yields[i] = y
      base[i] = base[i - 1] * Math.exp(y * dt - D * dy + 0.5 * C * dy * dy)
    }
    return {
      seed, product: productKey, length, company, playTicks, historyTicks, ticksPerDay,
      prices: base, yields, news, feeRate: product.fee,
    }
  }

  // Equity-like: log returns with regime drift, GARCH Student-t shocks, jumps.
  for (let i = 1; i < total; i++) {
    regime = nextRegime()
    const mu = REGIME_SIGN[regime] * TREND_TO_VOL * noiseVol
    const ret = (mu - 0.5 * noiseVol * noiseVol) * dt + shock() + (jumps.get(i) ?? 0)
    base[i] = base[i - 1] * Math.exp(ret)
  }

  if (!product.leverage) {
    return {
      seed, product: productKey, length, company, playTicks, historyTicks, ticksPerDay,
      prices: base, news, feeRate: product.fee,
    }
  }

  // A real leveraged fund: exposure is reset to L times NAV once per trading
  // day, and within the day it moves L times the index move since the reset.
  const lev = product.leverage
  const prices = new Array<number>(total)
  let navAtReset = rng.range(...product.priceRange)
  let indexAtReset = base[0]
  prices[0] = navAtReset
  for (let i = 1; i < total; i++) {
    prices[i] = Math.max(navAtReset * 0.01, navAtReset * (1 + lev * (base[i] / indexAtReset - 1)))
    if (i % ticksPerDay === 0) {
      navAtReset = prices[i]
      indexAtReset = base[i]
    }
  }
  return {
    seed, product: productKey, length, company, playTicks, historyTicks, ticksPerDay,
    prices, underlying: base, news, feeRate: product.fee,
  }
}

/** Price at a play-relative tick (0 = round start). */
export function playPrice(market: Market, tick: number): number {
  return market.prices[market.historyTicks + tick]
}

/** Trading day (0-based) of a play-relative tick. */
export function dayOf(market: Market, tick: number) {
  return Math.floor(tick / market.ticksPerDay)
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** "3월 14일" for a trading day, spreading 252 trading days over a year. */
export function calendarLabel(tradingDay: number) {
  let dayOfYear = Math.floor((tradingDay * 365) / TRADING_DAYS_PER_YEAR) + 1
  let month = 0
  while (month < 11 && dayOfYear > MONTH_DAYS[month]) {
    dayOfYear -= MONTH_DAYS[month]
    month++
  }
  return `${month + 1}월 ${dayOfYear}일`
}
