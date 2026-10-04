import { describe, expect, it } from 'vitest'
import {
  CARD_SIZES,
  cardFootnote,
  cardHeadline,
  cardLayout,
  edgeText,
  gridCells,
  marketVerdicts,
  sliceVerdicts,
  timingScore,
  type Box,
} from './card'
import { shownGap } from './copy'
import { formatPct } from './format'
import { generateMarket } from './market'
import { createRng } from './rng'

/** 40 ticks per slice, like a 40 s round at 10 ticks a second. */
function series(moves: number[], per = 40) {
  const prices = [100]
  for (const m of moves) for (let t = 0; t < per; t++) prices.push(prices[prices.length - 1] + m / per)
  return prices
}
const heldSlices = (slices: boolean[], per = 40) => slices.flatMap((s) => Array<boolean>(per).fill(s))

describe('sliceVerdicts', () => {
  const moves = [1, -1, 0, 2, -2, 1, -1, 0, 3, -3]

  it('is right when holding through a rise or sitting out a fall or a flat slice', () => {
    const v = sliceVerdicts(series(moves), heldSlices(moves.map((m) => m > 0)))
    expect(v).toEqual(Array(10).fill(true))
    expect(timingScore(v)).toBe(10)
  })

  it('is wrong when holding through a fall or flat, or sitting out a rise', () => {
    const v = sliceVerdicts(series(moves), heldSlices(moves.map((m) => m <= 0)))
    expect(v).toEqual(Array(10).fill(false))
  })

  it('holding all along is right exactly on the rising slices', () => {
    const v = sliceVerdicts(series(moves), heldSlices(Array(10).fill(true)))
    expect(v).toEqual(moves.map((m) => m > 0))
  })

  it('never holding is right exactly on the falling or flat slices', () => {
    const v = sliceVerdicts(series(moves), [])
    expect(v).toEqual(moves.map((m) => m <= 0))
  })

  it('counts a slice as held from half its ticks', () => {
    const prices = series([1])
    expect(sliceVerdicts(prices, Array(20).fill(true), 1)).toEqual([true])
    expect(sliceVerdicts(prices, Array(19).fill(true), 1)).toEqual([false])
  })

  it('runs on a real market', () => {
    const market = generateMarket(42, 'stock', 'short')
    const v = marketVerdicts(market, Array(market.playTicks).fill(true))
    expect(v).toHaveLength(10)
    // Holding all along is right on every rising slice and nowhere else.
    const per = market.playTicks / 10
    const p = (t: number) => market.prices[market.historyTicks + t]
    expect(v).toEqual(Array.from({ length: 10 }, (_, i) => p(Math.round((i + 1) * per)) > p(Math.round(i * per))))
  })
})

describe('card text', () => {
  it('headline names the day and product and says it is a game', () => {
    expect(cardHeadline(128, { product: 'stock', length: 'short' })).toBe('HOLD #128 · 주식 (가상 게임)')
    expect(cardHeadline(null, { product: 'gold', length: 'short' })).toBe('HOLD 연습 · 금 (가상 게임)')
    expect(cardHeadline(null, { product: 'stock', length: 'long' })).toBe('HOLD 장기 1년 · 주식 (가상 게임)')
  })

  it('edge is the difference from holding all along', () => {
    expect(edgeText(0.05, 0.008)).toBe('그냥 들고 있기보다 +4.2%')
    expect(edgeText(-0.02, 0.01)).toBe('그냥 들고 있기보다 -3.0%')
    expect(edgeText(0.01, 0.01)).toBe('그냥 들고 있기보다 0.0%')
  })

  it('edge adds up with the two rounded numbers the result screen shows', () => {
    // 나 +1.7% · 시장 +0.1%: the unrounded gap 1.698 would say +1.7%.
    expect(edgeText(0.01749, 0.00051)).toBe('그냥 들고 있기보다 +1.6%')
    const rng = createRng(2024)
    for (let i = 0; i < 100_000; i++) {
      const you = (rng.next() - 0.5) * 0.3
      const bh = (rng.next() - 0.5) * 0.3
      const shown = (x: number) => Math.round(Number(formatPct(x, 1).slice(0, -1)) * 10)
      const t = shown(you) - shown(bh)
      const edge = Number(edgeText(you, bh).replace('그냥 들고 있기보다 ', '').slice(0, -1))
      expect(Math.round(edge * 10)).toBe(t)
      expect(shownGap(you, bh)).toBe(`${(Math.abs(t) / 10).toFixed(1)}%`)
    }
  })

  it('footnote joins what is there', () => {
    expect(cardFootnote(12, '새가슴 익절형')).toBe('12일 연속 · 새가슴 익절형')
    expect(cardFootnote(12)).toBe('12일 연속')
    expect(cardFootnote(1, '존버형')).toBe('존버형')
    expect(cardFootnote(null, null)).toBeNull()
  })
})

describe('layout', () => {
  const inside = (b: Box, outer: Box) =>
    b.x >= outer.x && b.y >= outer.y && b.x + b.width <= outer.x + outer.width + 1e-9 && b.y + b.height <= outer.y + outer.height + 1e-9

  it('grid cells are square, in order and inside their area', () => {
    const area = { x: 10, y: 20, width: 500, height: 210 }
    const cells = gridCells(10, 5, area, 10)
    expect(cells).toHaveLength(10)
    for (const c of cells) {
      expect(c.width).toBe(c.height)
      expect(inside(c, area)).toBe(true)
    }
    expect(cells[5].y).toBeGreaterThan(cells[4].y)
    expect(cells[1].x).toBeGreaterThan(cells[0].x)
  })

  for (const format of ['square', 'story'] as const) {
    it(`${format}: every block fits the canvas in reading order`, () => {
      const l = cardLayout(format)
      expect({ width: l.width, height: l.height }).toEqual(CARD_SIZES[format])
      const canvas = { x: 0, y: 0, width: l.width, height: l.height }
      expect(inside(l.panel, canvas)).toBe(true)
      const cells = gridCells(10, l.grid.cols, l.grid.area, l.grid.gap)
      for (const c of cells) expect(inside(c, l.panel)).toBe(true)
      const order = [l.headline.y, l.label.y, l.score.y, cells[0].y, cells[9].y + cells[9].height, l.edge.y, l.footnote.y, l.url.y, l.disclaimer.y]
      for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1])
      expect(l.disclaimer.y).toBeLessThan(l.height)
    })
  }

  it('story keeps clear of the top and bottom 250 px Instagram covers', () => {
    const l = cardLayout('story')
    expect(l.headline.y - l.headline.size).toBeGreaterThanOrEqual(250)
    expect(l.disclaimer.y).toBeLessThanOrEqual(l.height - 250)
  })
})
