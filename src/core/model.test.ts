import { describe, expect, it } from 'vitest'
import { generateMarket, playPrice, type Market, type RoundLength } from './market'
import type { ProductKey } from './products'

/**
 * The price engine should reproduce the stylized facts of real returns
 * (Cont, 2001) and the real volatility of each asset class.
 */

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

function logReturns(m: Market) {
  const r: number[] = []
  for (let t = 1; t <= m.playTicks; t++) r.push(Math.log(playPrice(m, t) / playPrice(m, t - 1)))
  return r
}

function autocorr(x: number[], lag: number) {
  const m = mean(x)
  let num = 0
  let den = 0
  for (let i = 0; i < x.length; i++) {
    den += (x[i] - m) ** 2
    if (i >= lag) num += (x[i] - m) * (x[i - lag] - m)
  }
  return num / den
}

function kurtosis(x: number[]) {
  const m = mean(x)
  const v = mean(x.map((a) => (a - m) ** 2))
  return mean(x.map((a) => (a - m) ** 4)) / (v * v)
}

/** Annualized volatility of whole-round log returns across many seeds. */
function roundVolatility(product: ProductKey, length: RoundLength, seeds: number) {
  const lr: number[] = []
  let days = 0
  for (let s = 0; s < seeds; s++) {
    const m = generateMarket(s * 7919 + 11, product, length)
    lr.push(Math.log(playPrice(m, m.playTicks) / playPrice(m, 0)))
    days = m.playTicks / m.ticksPerDay
  }
  const mu = mean(lr)
  return Math.sqrt(mean(lr.map((x) => (x - mu) ** 2)) * (252 / days))
}

const SAMPLE = Array.from({ length: 120 }, (_, s) => generateMarket(s * 104729 + 7, 'stock'))

describe('stylized facts of returns', () => {
  it('has no linear autocorrelation (prices are not predictable from the last tick)', () => {
    expect(Math.abs(median(SAMPLE.map((m) => autocorr(logReturns(m), 1))))).toBeLessThan(0.03)
  })

  it('has fat tails: kurtosis well above the normal distribution’s 3', () => {
    expect(median(SAMPLE.map((m) => kurtosis(logReturns(m))))).toBeGreaterThan(6)
  })

  it('clusters volatility: large moves follow large moves', () => {
    const lag5 = SAMPLE.map((m) => autocorr(logReturns(m).map(Math.abs), 5))
    expect(median(lag5)).toBeGreaterThan(0)
  })
})

describe('asset-class volatility', () => {
  // Targets: stock 35%, gold 15%, coin 75%, 2x on a 20% index ~40%.
  // Allow a wide band; the point is the right ballpark and the right order.
  const vol = {
    bond: roundVolatility('bond', 'long', 150),
    gold: roundVolatility('gold', 'long', 150),
    stock: roundVolatility('stock', 'long', 150),
    lev2: roundVolatility('lev2', 'long', 150),
    coin: roundVolatility('coin', 'long', 150),
  }

  it('matches real annual volatility within a broad band', () => {
    expect(vol.stock).toBeGreaterThan(0.24)
    expect(vol.stock).toBeLessThan(0.45)
    expect(vol.gold).toBeGreaterThan(0.09)
    expect(vol.gold).toBeLessThan(0.21)
    expect(vol.coin).toBeGreaterThan(0.5)
    expect(vol.coin).toBeLessThan(1)
    expect(vol.lev2).toBeGreaterThan(0.28)
    expect(vol.lev2).toBeLessThan(0.52)
    expect(vol.bond).toBeLessThan(0.1)
  })

  it('orders assets by risk: bond < gold < stock < coin', () => {
    expect(vol.bond).toBeLessThan(vol.gold)
    expect(vol.gold).toBeLessThan(vol.stock)
    expect(vol.stock).toBeLessThan(vol.coin)
  })

  it('keeps a one-month round consistent with a one-year round', () => {
    const month = roundVolatility('stock', 'short', 300)
    expect(month / vol.stock).toBeGreaterThan(0.7)
    expect(month / vol.stock).toBeLessThan(1.4)
  })
})

describe('bond pricing', () => {
  it('moves the price against the yield by about its duration', () => {
    let checked = 0
    for (let s = 0; s < 40; s++) {
      const m = generateMarket(s, 'bond')
      const h = m.historyTicks
      const D = m.company.duration!
      for (const n of m.news) {
        const i = h + n.impactAt
        const dy = m.yields![i] - m.yields![i - 1]
        const dp = m.prices[i] / m.prices[i - 1] - 1
        if (Math.abs(dy) < 0.0005) continue
        // dP/P ~ -D dy (plus tiny carry and convexity terms).
        expect(dp / (-D * dy)).toBeGreaterThan(0.85)
        expect(dp / (-D * dy)).toBeLessThan(1.15)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(20)
  })
})
