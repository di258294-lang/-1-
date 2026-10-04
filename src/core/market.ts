import { PRODUCTS, type Product, type ProductKey } from './products'
import { createRng, type Rng } from './rng'
// Read-only, and used only inside functions (round.ts imports this module too).
import { CASH_RATE_ANNUAL } from './round'

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
/**
 * Version of the price engine. Bump it whenever the same seed would draw a
 * different chart, so share links and saved records can tell old charts from
 * new ones. 2: clipped GARCH-t with daily persistence, exact variance budget,
 * fair drift against cash, corrected bond convexity, 8-digit rounding.
 */
export const ENGINE_VERSION = 2

/**
 * GARCH(1,1) persistence (alpha * E[u] + beta) compounded over one trading
 * day. Defining it per day keeps the volatility half-life the same number of
 * trading days in short and long rounds: ln 0.5 / ln 0.9 = 6.6 days.
 */
const VOL_PERSISTENCE_PER_DAY = 0.9
/** Stationary Var(h) / E[h]^2 of the GARCH variance: how much volatility itself moves. */
const VAR_OF_VAR = 1
/** Shocks are clipped here (in unit-variance standard deviations). */
const Z_CLIP = 8
/** The variance update sees min(z^2, this), so one freak tick cannot explode h. */
const Z2_FEED_CAP = 16
/**
 * Hard ceiling on the GARCH variance, as a multiple of its long-run mean:
 * volatility can triple but no more, so with the clip one non-news tick is
 * at most 3 * 8 = 24 long-run tick sigmas. It rarely binds (P(h > 9 E[h])
 * is well under 1%), so the budget and compensators stay accurate.
 */
const H_CAP = 9
/** Probability a regime survives one trading day (mean length 10 days). */
const REGIME_STAY_PER_DAY = 0.9
/**
 * Drift of a trending regime, as a multiple of the noise volatility. This
 * makes a typical trend about one standard deviation over its life, so it is
 * readable instead of pure noise. It is a game choice; the variance budget
 * below keeps the total annual volatility realistic anyway.
 */
const TREND_TO_VOL = 5
/** Regime switching hazard per year: q = -ln(stay) * 252. */
const REGIME_RATE = -Math.log(REGIME_STAY_PER_DAY) * TRADING_DAYS_PER_YEAR
/**
 * Annual variance of the regime drift per unit of noise variance. The drift
 * takes k*s, -k*s or 0 with stationary variance (2/3) k^2 s^2, and its
 * autocorrelation decays at rate 1.5q (a switch goes to one of the two other
 * states), so it integrates to 2 * (2/3) k^2 s^2 / (1.5q) = (8/9) k^2 s^2 / q
 * per year.
 */
const REGIME_FACTOR = ((8 / 9) * TREND_TO_VOL * TREND_TO_VOL) / REGIME_RATE
/** Jump multiplier m = exp(0.35 z - 0.06) around the product's typical jump. */
const JUMP_LOG_SD = 0.35
const JUMP_LOG_SHIFT = -0.06
/** E[m^2] for the log-normal jump multiplier. */
const JUMP_SIZE_M2 = Math.exp(2 * JUMP_LOG_SHIFT + 2 * JUMP_LOG_SD * JUMP_LOG_SD)
/** News timing rules (play ticks): first draw after 40, at least 60 apart, none in the last 46. */
const NEWS_START = 40
const NEWS_MIN_GAP = NEWS_LEAD_TICKS + 44
const NEWS_END_PAD = NEWS_LEAD_TICKS + 30
/** Continuously compounded cash rate, the benchmark every product must match in expectation. */
const cashLogRate = () => Math.log(1 + CASH_RATE_ANNUAL)

/**
 * Splits a product's total annual variance into news jumps, regime drift and
 * tick noise. Returns the noise volatility. `newsRateFactor` scales the
 * nominal headline rate to the rate the news planner actually delivers.
 */
export function noiseVolatility(totalVol: number, newsPerDay: number, jump: number, newsRateFactor = 1) {
  const jumpVar = newsPerDay * newsRateFactor * TRADING_DAYS_PER_YEAR * jump * jump * JUMP_SIZE_M2
  // Never let the noise vanish entirely, even if jumps alone exceed the budget.
  const left = Math.max(0.25 * totalVol * totalVol, totalVol * totalVol - jumpVar)
  return Math.sqrt(left / (1 + REGIME_FACTOR))
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

/** Gamma(k / 2) for a positive integer k. */
function gammaHalf(k: number) {
  let g = k % 2 === 0 ? 1 : Math.sqrt(Math.PI)
  for (let x = k % 2 === 0 ? 1 : 0.5; x < k / 2; x++) g *= x
  return g
}

function simpson(f: (x: number) => number, a: number, b: number, n = 2000) {
  const h = (b - a) / n
  let s = f(a) + f(b)
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(a + i * h)
  return (s * h) / 3
}

type TailMoments = {
  /** E[clip(z, 8)^2]: variance of the shock that reaches the price. */
  clip2: number
  /** E[u] and Var(u) for u = min(z^2, 16), the input of the variance update. */
  u1: number
  uVar: number
}
const tailMemo = new Map<number, TailMoments>()

/** Moments of the clipped unit-variance Student-t, by numerical integration. */
export function tailMoments(nu: number): TailMoments {
  const hit = tailMemo.get(nu)
  if (hit) return hit
  const s = Math.sqrt((nu - 2) / nu)
  const c = gammaHalf(nu + 1) / (Math.sqrt(nu * Math.PI) * gammaHalf(nu))
  const f = (z: number) => (c / s) * (1 + (z * z) / (s * s * nu)) ** (-(nu + 1) / 2)
  const mass = (b: number) => 2 * simpson(f, 0, b)
  const m2 = (b: number) => 2 * simpson((z) => z * z * f(z), 0, b)
  const m4 = (b: number) => 2 * simpson((z) => z * z * z * z * f(z), 0, b)
  const cut = Math.sqrt(Z2_FEED_CAP)
  const clip2 = m2(Z_CLIP) + Z_CLIP * Z_CLIP * (1 - mass(Z_CLIP))
  const u1 = m2(cut) + Z2_FEED_CAP * (1 - mass(cut))
  const u2 = m4(cut) + Z2_FEED_CAP * Z2_FEED_CAP * (1 - mass(cut))
  const out = { clip2, u1, uVar: u2 - u1 * u1 }
  tailMemo.set(nu, out)
  return out
}

/**
 * Exact news statistics of the planner below (renewal recursion over its
 * discretized, spaced exponential gaps): the expected number of headlines
 * E[N], including the forced one when none arrive, and E[M^N].
 */
function newsStats(newsPerDay: number, ticksPerDay: number, playTicks: number, M: number) {
  const rate = newsPerDay / ticksPerDay
  const L = playTicks - NEWS_END_PAD - NEWS_START
  const tail = (x: number) => (x < NEWS_MIN_GAP ? 1 : Math.exp(-rate * (x + 0.5)))
  const pk = new Float64Array(L + 1)
  for (let k = NEWS_MIN_GAP; k <= L; k++) pk[k] = (k === NEWS_MIN_GAP ? 1 : tail(k - 1)) - tail(k)
  const u = new Float64Array(L + 1)
  const w = new Float64Array(L + 1)
  u[0] = 1
  w[0] = 1
  let expected = tail(L)
  let mgf = M * tail(L)
  for (let s = NEWS_MIN_GAP; s <= L; s++) {
    let us = 0
    let ws = 0
    for (let k = NEWS_MIN_GAP; k <= s; k++) {
      us += pk[k] * u[s - k]
      ws += pk[k] * w[s - k]
    }
    u[s] = us
    w[s] = M * ws
    expected += us
    mgf += w[s] * tail(L - s)
  }
  return { expected, mgf }
}

/** E[exp(J)] for a news jump: random sign, log-normal size around `jump`. */
function jumpMgf(jump: number) {
  const phi = (g: number) => Math.exp(-0.5 * g * g) / Math.sqrt(2 * Math.PI)
  return simpson((g) => phi(g) * Math.cosh(jump * Math.exp(JUMP_LOG_SD * g + JUMP_LOG_SHIFT)), -12, 12, 4000)
}

// 3x3 matrices for the regime chain, row-major.
type M3 = Float64Array
function mul3(A: M3, B: M3): M3 {
  const C = new Float64Array(9)
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]
  return C
}
function pow3(A: M3, n: number): M3 {
  let R: M3 = Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1)
  let B = A
  for (let e = n; e > 0; e >>= 1) {
    if (e & 1) R = mul3(R, B)
    B = mul3(B, B)
  }
  return R
}
/** P with each column b scaled by d[b]: one tick of transition then growth in the new regime. */
function regimeStep(stay: number, growth: readonly number[]): M3 {
  const P = new Float64Array(9)
  for (let a = 0; a < 3; a++)
    for (let b = 0; b < 3; b++) P[a * 3 + b] = (a === b ? stay : (1 - stay) / 2) * growth[b]
  return P
}
/** pi' A 1 with the uniform stationary distribution. */
const stationarySum = (A: M3) => A.reduce((s, x) => s + x, 0) / 3

export type EngineParams = {
  ticksPerDay: number
  playTicks: number
  historyTicks: number
  /** Years per tick. */
  dt: number
  /** Headlines per round the planner delivers on average, and per trading day. */
  expectedNews: number
  effectiveNewsPerDay: number
  /** Annual variance from news jumps (yield units for bonds). */
  jumpVar: number
  /** Annual volatility of the GARCH tick noise (yield units for bonds). */
  noiseVol: number
  /** Unconditional variance of one tick of noise, noiseVol^2 * dt. */
  tickVar: number
  garch: { alpha: number; beta: number; omega: number; mean: number; cap: number; nu: number }
  /** Per-tick log drift on every tick: cash rate minus the regime compensator. */
  drift: number
  /** Per-tick jump compensator, charged on play ticks where news can land. */
  jumpDrag: number
}

const paramMemo = new Map<string, EngineParams>()

/**
 * Everything the generator needs that depends only on the product and the
 * round length, derived from the annual targets in products.ts.
 */
export function engineParams(productKey: ProductKey, length: RoundLength): EngineParams {
  const memoKey = `${productKey}/${length}`
  const hit = paramMemo.get(memoKey)
  if (hit) return hit
  const product = PRODUCTS[productKey]
  const model = product.model
  const timing = LENGTHS[length]
  const ticksPerDay = Math.round((timing.seconds * TICKS_PER_SECOND) / timing.days)
  const playTicks = timing.days * ticksPerDay
  const historyTicks = timing.historyDays * ticksPerDay
  const dt = 1 / (TRADING_DAYS_PER_YEAR * ticksPerDay)
  const playYears = playTicks * dt

  // Variance budget with the news rate the planner really delivers.
  const M = jumpMgf(model.jump)
  const news = newsStats(model.newsPerDay, ticksPerDay, playTicks, M)
  const effectiveNewsPerDay = news.expected / timing.days
  const totalVol = model.bond ? model.bond.sigmaYield : model.sigma
  const noiseVol = noiseVolatility(totalVol, model.newsPerDay, model.jump, effectiveNewsPerDay / model.newsPerDay)
  const jumpVar = (news.expected * model.jump * model.jump * JUMP_SIZE_M2) / playYears
  const tickVar = noiseVol * noiseVol * dt

  // GARCH: per-tick persistence from the daily one; alpha from the target
  // variance of h, which also guarantees a finite fourth moment:
  // E[(alpha u + beta)^2] = s^2 + alpha^2 Var(u) < 1.
  const tm = tailMoments(model.tailNu)
  const s = VOL_PERSISTENCE_PER_DAY ** (1 / ticksPerDay)
  const alpha = Math.sqrt(((VAR_OF_VAR / (1 + VAR_OF_VAR)) * (1 - s * s)) / tm.uVar)
  const beta = s - alpha * tm.u1
  const mean = tickVar / tm.clip2
  const garch = { alpha, beta, omega: mean * (1 - s), mean, cap: H_CAP * mean, nu: model.tailNu }

  // Fair drift: E[gross over the play window] equals cash. Noise is
  // compensated tick by tick (-tickVar/2 in the generator), news jumps by
  // ln E[M^N] spread over the play ticks, and the regime drift exactly
  // through the regime chain (its convexity depends on the round length).
  const jumpDrag = Math.log(news.mgf) / playTicks
  let drift = 0
  if (!model.bond) {
    const stay = REGIME_STAY_PER_DAY ** (1 / ticksPerDay)
    const growth = (a: number) => REGIMES.map((r) => Math.exp(REGIME_SIGN[r] * TREND_TO_VOL * noiseVol * dt + a))
    const cashLog = playYears * cashLogRate()
    if (!product.leverage) {
      drift = (cashLog - Math.log(stationarySum(pow3(regimeStep(stay, growth(0)), playTicks)))) / playTicks
    } else {
      // The fund is linear in the index within a day: E[1 + L(g - 1)] per
      // day, compounded through the chain. Solve for the index drift.
      const L = product.leverage
      const P = pow3(regimeStep(stay, [1, 1, 1]), ticksPerDay)
      const fundLog = (a: number) => {
        const G = pow3(regimeStep(stay, growth(a)), ticksPerDay)
        const Q = P.map((p, i) => (1 - L) * p + L * G[i])
        return Math.log(stationarySum(pow3(Q, timing.days)))
      }
      let lo = -dt
      let hi = dt
      for (let i = 0; i < 100; i++) {
        const mid = (lo + hi) / 2
        if (fundLog(mid) < cashLog) lo = mid
        else hi = mid
      }
      drift = (lo + hi) / 2
    }
  }

  const params: EngineParams = {
    ticksPerDay, playTicks, historyTicks, dt,
    expectedNews: news.expected, effectiveNewsPerDay, jumpVar, noiseVol, tickVar, garch, drift, jumpDrag,
  }
  paramMemo.set(memoKey, params)
  return params
}

/**
 * Rounds to 8 significant digits with plain IEEE arithmetic (exactly
 * specified, so identical on every engine). Transcendental functions like
 * Math.exp may differ in the last bit between browsers; rounding the stored
 * series hides that, so the same seed shows the same numbers everywhere.
 */
const POW10 = Array.from({ length: 23 }, (_, i) => Number(`1e${i}`))
export function round8(x: number) {
  if (x === 0 || !Number.isFinite(x)) return x
  const a = Math.abs(x)
  // Exponent e with 10^e <= a < 10^(e+1), found by exact comparisons.
  let e = 0
  while (e < 15 && a >= POW10[e + 1]) e++
  while (e > -15 && a < (e >= 0 ? POW10[e] : 1 / POW10[-e])) e--
  const k = 7 - e
  const r = k >= 0 ? Math.round(a * POW10[k]) / POW10[k] : Math.round(a / POW10[-k]) * POW10[-k]
  return x < 0 ? -r : r
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
  const last = playTicks - NEWS_END_PAD
  const events: NewsEvent[] = []
  let t = NEWS_START
  for (;;) {
    t += Math.max(NEWS_MIN_GAP, Math.round(-Math.log(1 - rng.next()) / rate))
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
  const p = engineParams(productKey, length)
  const { ticksPerDay, playTicks, historyTicks, dt } = p
  const total = historyTicks + playTicks + 1

  const rng = createRng(seed)
  const company = rng.pick(product.assets)
  const news = planNews(rng, product, company, playTicks, ticksPerDay)

  // News jumps keyed by absolute tick. Sizes vary log-normally around the
  // product's typical jump; a false rumor hits as hard as a true one.
  const jumps = new Map<number, number>()
  for (const ev of news) {
    const size = model.jump * Math.exp(JUMP_LOG_SD * rng.gauss() + JUMP_LOG_SHIFT)
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

  // GARCH(1,1) on clipped Student-t shocks, started at its long-run level.
  const g = p.garch
  let h = g.mean
  const shock = () => {
    const z = studentT(rng, g.nu)
    const e = Math.sqrt(h) * (z > Z_CLIP ? Z_CLIP : z < -Z_CLIP ? -Z_CLIP : z)
    h = Math.min(g.cap, g.omega + (g.alpha * Math.min(z * z, Z2_FEED_CAP) + g.beta) * h)
    return e
  }

  const base = new Array<number>(total)
  base[0] = rng.range(...product.priceRange)

  if (model.bond) {
    // Vasicek yield with regime drift; price through duration and convexity.
    // Log price: ln(1 + dP/P) = carry - D dy + (C - D^2)/2 dy^2, where the
    // carry is the yield before the move, less the expected convexity gain
    // C/2 E[dy^2] so holding the bond earns the yield, not a free extra.
    const { yield0, kappa } = model.bond
    const D = company.duration ?? 7
    const C = company.convexity ?? 50
    const yields = new Array<number>(total)
    let y = yield0 + rng.range(-0.005, 0.005)
    yields[0] = y
    // Expected C/2 dy^2 per tick: noise everywhere, news jumps only in the play window.
    const convexityHistory = 0.5 * C * p.tickVar
    const convexityPlay = 0.5 * C * (p.tickVar + p.jumpVar * dt)
    for (let i = 1; i < total; i++) {
      regime = nextRegime()
      // Yield trends the opposite way of the price regime.
      const trend = -REGIME_SIGN[regime] * TREND_TO_VOL * p.noiseVol
      // A bullish headline means yields fall.
      const jump = -(jumps.get(i) ?? 0)
      const dy = kappa * (yield0 - y) * dt + trend * dt + shock() + jump
      const carry = y * dt - (i > historyTicks ? convexityPlay : convexityHistory)
      base[i] = base[i - 1] * Math.exp(carry - D * dy + 0.5 * (C - D * D) * dy * dy)
      y += dy
      yields[i] = y
    }
    return {
      seed, product: productKey, length, company, playTicks, historyTicks, ticksPerDay,
      prices: base.map(round8), yields: yields.map(round8), news, feeRate: product.fee,
    }
  }

  // Equity-like: log returns with regime drift, GARCH Student-t shocks, jumps.
  // Drift = cash rate - compensators, so E[gross] matches cash over the round.
  const halfVar = 0.5 * p.tickVar
  for (let i = 1; i < total; i++) {
    regime = nextRegime()
    const mu = REGIME_SIGN[regime] * TREND_TO_VOL * p.noiseVol
    const comp = i > historyTicks ? p.jumpDrag : 0
    const ret = p.drift + mu * dt - halfVar - comp + shock() + (jumps.get(i) ?? 0)
    base[i] = base[i - 1] * Math.exp(ret)
  }
  const stored = base.map(round8)

  if (!product.leverage) {
    return {
      seed, product: productKey, length, company, playTicks, historyTicks, ticksPerDay,
      prices: stored, news, feeRate: product.fee,
    }
  }

  // A real leveraged fund: exposure is reset to L times NAV once per trading
  // day, and within the day it moves L times the index move since the reset.
  // Built from the rounded index with plain arithmetic, so it is already
  // device-independent and the daily L-times identity holds exactly.
  const lev = product.leverage
  const prices = new Array<number>(total)
  let navAtReset = round8(rng.range(...product.priceRange))
  let indexAtReset = stored[0]
  prices[0] = navAtReset
  for (let i = 1; i < total; i++) {
    prices[i] = Math.max(navAtReset * 0.01, navAtReset * (1 + lev * (stored[i] / indexAtReset - 1)))
    if (i % ticksPerDay === 0) {
      navAtReset = prices[i]
      indexAtReset = stored[i]
    }
  }
  return {
    seed, product: productKey, length, company, playTicks, historyTicks, ticksPerDay,
    prices, underlying: stored, news, feeRate: product.fee,
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
