import { PRODUCTS, type Product, type ProductKey } from './products'
import { createRng, type Rng } from './rng'

export const TICKS_PER_SECOND = 10
export const ROUND_SECONDS = 40
export const PLAY_TICKS = ROUND_SECONDS * TICKS_PER_SECOND
/** Ticks shown before the round starts, so the player has context. */
export const HISTORY_TICKS = 120
/** Headlines land this many ticks before the price reacts. */
export const NEWS_LEAD_TICKS = 16

export type Company = { name: string; code: string; sector: string }

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
  /** Direction the headline implies. */
  implied: 1 | -1
  /** Direction the price actually took. */
  actual: 1 | -1
}

export type Market = {
  seed: number
  product: ProductKey
  company: Company
  /** Absolute series: HISTORY_TICKS + PLAY_TICKS + 1 prices. */
  prices: number[]
  /** For leveraged products: the index the product tracks. */
  underlying?: number[]
  news: NewsEvent[]
  feeRate: number
}

/** The stock universe, kept as a named export for tests and older callers. */
export const COMPANIES = PRODUCTS.stock.assets

function headlines(template: string, product: Product, company: Company) {
  return {
    headline: template.replace('{n}', company.name),
    blindHeadline: template.replace('{n}', product.blindName),
  }
}

function planNews(rng: Rng, product: Product, company: Company): NewsEvent[] {
  const count = rng.int(2, 3)
  const events: NewsEvent[] = []
  // Spread events across the round, leaving the first 4 seconds quiet.
  const slot = Math.floor((PLAY_TICKS - 60) / count)
  for (let i = 0; i < count; i++) {
    const at = 40 + i * slot + rng.int(0, slot - NEWS_LEAD_TICKS - 20)
    const kind: NewsKind = rng.chance(1 - product.rumorShare) ? 'filing' : 'rumor'
    const implied: 1 | -1 = rng.chance(0.5) ? 1 : -1
    // Filings are facts. Rumors are a coin flip, so trading on them is gambling.
    const actual: 1 | -1 = kind === 'filing' || rng.chance(0.5) ? implied : ((-implied) as 1 | -1)
    const set = kind === 'filing' ? product.filings : product.rumors
    events.push({
      at,
      impactAt: at + NEWS_LEAD_TICKS,
      kind,
      ...headlines(rng.pick(implied > 0 ? set.up : set.down), product, company),
      implied,
      actual,
    })
  }
  return events
}

type RegimeKind = 'up' | 'down' | 'chop'

export function generateMarket(seed: number, productKey: ProductKey = 'stock'): Market {
  const product = PRODUCTS[productKey]
  const rng = createRng(seed)
  const company = rng.pick(product.assets)
  const news = planNews(rng, product, company)
  const total = HISTORY_TICKS + PLAY_TICKS + 1
  const { vol: kv, drift: kd } = product

  // Leveraged products are shown where they hurt: sideways, zig-zag markets.
  const nextRegime = (options: readonly RegimeKind[]): RegimeKind => {
    if (!product.leverage) return rng.pick(options)
    return rng.chance(0.7) ? 'chop' : rng.pick(['up', 'down'] as const)
  }
  // Trends carry a little momentum. In a leveraged product's sideways
  // stretches each move partly reverses instead, which is exactly the market
  // where daily-rebalanced leverage bleeds.
  const momentumFor = (r: RegimeKind) => (product.leverage && r === 'chop' ? -0.5 : 0.18)
  const chopBoost = product.leverage ? 3 : 1

  // Per-tick log-return drift and volatility for each regime.
  const regimeParams: Record<RegimeKind, () => { drift: number; vol: number }> = {
    up: () => ({ drift: rng.range(0.0007, 0.0016) * kd, vol: rng.range(0.0017, 0.0026) * kv }),
    down: () => ({ drift: -rng.range(0.0007, 0.0018) * kd, vol: rng.range(0.002, 0.003) * kv }),
    chop: () => ({ drift: rng.range(-0.00015, 0.00015) * kd, vol: rng.range(0.0022, 0.0032) * kv * chopBoost }),
  }

  // Additive shocks keyed by absolute tick index.
  const shocks = new Map<number, number>()
  for (const ev of news) {
    // A false rumor hits as hard as a true one: the market punishes the crowd.
    const size = rng.range(0.045, 0.085) * product.shock
    const spread = rng.int(3, 6)
    for (let k = 0; k < spread; k++) {
      const abs = HISTORY_TICKS + ev.impactAt + k
      shocks.set(abs, (shocks.get(abs) ?? 0) + (ev.actual * size) / spread)
    }
  }

  const base = new Array<number>(total)
  let price = rng.range(...product.priceRange)
  base[0] = price

  let regime: RegimeKind = nextRegime(['up', 'down', 'chop'])
  let params = regimeParams[regime]()
  let regimeLeft = rng.int(50, 130)
  // Small momentum term makes trends feel like trends rather than noise.
  let lastRet = 0

  for (let i = 1; i < total; i++) {
    if (regimeLeft-- <= 0) {
      const options: RegimeKind[] = (['up', 'down', 'chop'] as const).filter((r) => r !== regime)
      regime = nextRegime(options)
      params = regimeParams[regime]()
      regimeLeft = rng.int(50, 130)
    }
    const shock = shocks.get(i) ?? 0
    const ret = params.drift + params.vol * rng.gauss() + momentumFor(regime) * lastRet + shock
    lastRet = ret - shock
    price = price * Math.exp(ret)
    base[i] = price
  }

  if (!product.leverage) {
    return { seed, product: productKey, company, prices: base, news, feeRate: product.fee }
  }

  // Rebalanced every tick: each step returns L times the index step. This is
  // what makes leveraged products decay in choppy markets.
  const lev = product.leverage
  const prices = new Array<number>(total)
  prices[0] = rng.range(...product.priceRange)
  for (let i = 1; i < total; i++) {
    const step = base[i] / base[i - 1] - 1
    prices[i] = prices[i - 1] * Math.max(0.01, 1 + lev * step)
  }
  return { seed, product: productKey, company, prices, underlying: base, news, feeRate: product.fee }
}

/** Price at a play-relative tick (0 = round start). */
export function playPrice(market: Market, tick: number): number {
  return market.prices[HISTORY_TICKS + tick]
}
