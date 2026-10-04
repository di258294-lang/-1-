import { shownEdge } from './copy'
import { formatPct } from './format'
import { playPrice, type Market } from './market'
import { PRODUCTS } from './products'

/**
 * Pure parts of the shareable result image (src/ui/card.ts): the
 * spoiler-free verdict and the layout. No DOM, so it is unit tested.
 *
 * The verdict follows the same rule as the spoiler-free share text
 * (src/core/share.ts, written separately): one cell per tenth of the round
 * (4 s of a 40 s round), right when you held while the price rose or sat in
 * cash while it fell or stayed flat. A reader sees how often you were right,
 * never which way today's chart went.
 */
export const CARD_SLICES = 10

/**
 * Right/wrong per slice. `prices` is play-relative (prices[0] is the open,
 * prices[ticks] the close) and `held[t]` is true when the position was open
 * from tick t to t + 1, as in Round.held. A slice counts as held when at
 * least half its ticks were held.
 */
export function sliceVerdicts(prices: readonly number[], held: readonly boolean[], slices = CARD_SLICES): boolean[] {
  const ticks = prices.length - 1
  const per = ticks / slices
  const out: boolean[] = []
  for (let i = 0; i < slices; i++) {
    const from = Math.round(i * per)
    const to = Math.round((i + 1) * per)
    let heldCount = 0
    for (let t = from; t < to; t++) if (held[t]) heldCount++
    const holding = heldCount * 2 >= to - from && to > from
    const rose = prices[to] - prices[from] > 0
    out.push(holding ? rose : !rose)
  }
  return out
}

/** sliceVerdicts over a market's play window. */
export function marketVerdicts(market: Market, held: readonly boolean[], slices = CARD_SLICES): boolean[] {
  const prices: number[] = []
  for (let t = 0; t <= market.playTicks; t++) prices.push(playPrice(market, t))
  return sliceVerdicts(prices, held, slices)
}

export const timingScore = (verdicts: readonly boolean[]) => verdicts.filter(Boolean).length

/** "HOLD #128 · 주식 (가상 게임)", or "HOLD 연습 · 금 (가상 게임)" off the daily. */
export function cardHeadline(day: number | null, market: Pick<Market, 'product' | 'length'>) {
  const name = PRODUCTS[market.product].name
  if (day !== null) return `HOLD #${day} · ${name} (가상 게임)`
  return `HOLD ${market.length === 'long' ? '장기 1년' : '연습'} · ${name} (가상 게임)`
}

/**
 * "그냥 들고 있기보다 +4.2%": percentage points against holding all along,
 * from the two returns as the result screen rounds them (shownEdge), so the
 * share text and card always add up with "나 · 시장". Says nothing about the
 * market's own direction.
 */
export function edgeText(yourReturn: number, buyHoldReturn: number) {
  return `그냥 들고 있기보다 ${formatPct(shownEdge(yourReturn, buyHoldReturn) / 100, 1)}`
}

/** "12일 연속 · 새가슴 익절형", either part optional; null when both are missing. */
export function cardFootnote(streak?: number | null, typeName?: string | null) {
  const parts: string[] = []
  if (streak && streak >= 2) parts.push(`${streak}일 연속`)
  if (typeName) parts.push(typeName)
  return parts.length ? parts.join(' · ') : null
}

export const CARD_DISCLAIMER = '모든 회사·가격·뉴스는 가상이에요'

export type CardFormat = 'square' | 'story'

export const CARD_SIZES: Record<CardFormat, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
}

export type Box = { x: number; y: number; width: number; height: number }

/** Square cells for the verdict grid, laid out row by row inside `area`. */
export function gridCells(count: number, cols: number, area: Box, gap: number): Box[] {
  const rows = Math.ceil(count / cols)
  const size = Math.min((area.width - gap * (cols - 1)) / cols, (area.height - gap * (rows - 1)) / rows)
  const cells: Box[] = []
  for (let i = 0; i < count; i++) {
    const c = i % cols
    const r = Math.floor(i / cols)
    cells.push({ x: area.x + c * (size + gap), y: area.y + r * (size + gap), width: size, height: size })
  }
  return cells
}

/**
 * Where each block of the card goes, in canvas pixels. Text positions are
 * baselines. The story format keeps everything inside Instagram's safe area
 * (about 250 px of UI at the top and bottom of a 1920 px story).
 */
export type CardLayout = {
  width: number
  height: number
  pad: number
  /** White surface holding the score and the grid. */
  panel: Box & { radius: number }
  headline: { y: number; size: number }
  label: { y: number; size: number }
  score: { y: number; size: number }
  grid: { cols: number; area: Box; gap: number }
  edge: { y: number; size: number }
  footnote: { y: number; size: number }
  url: { y: number; size: number }
  disclaimer: { y: number; size: number }
}

export function cardLayout(format: CardFormat): CardLayout {
  const { width, height } = CARD_SIZES[format]
  const pad = 88
  if (format === 'square') {
    const panel = { x: pad, y: 176, width: width - pad * 2, height: 620, radius: 48 }
    const inner = panel.x + 64
    return {
      width,
      height,
      pad,
      panel,
      headline: { y: 124, size: 40 },
      label: { y: panel.y + 104, size: 40 },
      score: { y: panel.y + 330, size: 210 },
      grid: { cols: 10, area: { x: inner, y: panel.y + 400, width: panel.width - 128, height: 80 }, gap: 14 },
      edge: { y: panel.y + 562, size: 42 },
      footnote: { y: 878, size: 36 },
      url: { y: 960, size: 32 },
      disclaimer: { y: 1008, size: 28 },
    }
  }
  const top = 260
  const panel = { x: pad, y: top + 96, width: width - pad * 2, height: 1000, radius: 56 }
  const inner = panel.x + 72
  return {
    width,
    height,
    pad,
    panel,
    headline: { y: top + 40, size: 44 },
    label: { y: panel.y + 124, size: 46 },
    score: { y: panel.y + 410, size: 260 },
    grid: { cols: 5, area: { x: inner, y: panel.y + 500, width: panel.width - 144, height: 300 }, gap: 22 },
    edge: { y: panel.y + 904, size: 48 },
    footnote: { y: panel.y + panel.height + 104, size: 40 },
    url: { y: height - 330, size: 36 },
    disclaimer: { y: height - 276, size: 30 },
  }
}
