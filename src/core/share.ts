import { PLAY_TICKS, playPrice, type Market } from './market'
import type { RoundResult } from './round'
import { formatPct } from './format'

const SLICES = 10

/**
 * One square per 4 seconds. Red when you held through a rise, blue when you
 * held through a drop, white when you sat in cash. Red for up follows the
 * Korean market convention.
 */
export function timelineSquares(market: Market, held: boolean[]) {
  const per = PLAY_TICKS / SLICES
  let out = ''
  for (let i = 0; i < SLICES; i++) {
    const from = Math.round(i * per)
    const to = Math.round((i + 1) * per)
    let heldCount = 0
    for (let t = from; t < to; t++) if (held[t]) heldCount++
    if (heldCount * 2 < to - from) {
      out += '⬜'
      continue
    }
    const move = playPrice(market, to) - playPrice(market, from)
    out += move >= 0 ? '🟥' : '🟦'
  }
  return out
}

export function shareText(opts: {
  market: Market
  result: Pick<RoundResult, 'yourReturn' | 'buyHoldReturn' | 'held'>
  day: number | null
  url: string
}) {
  const { market, result, day, url } = opts
  const head = day === null ? 'HOLD 연습' : `HOLD #${day}`
  return [
    `${head}  ${formatPct(result.yourReturn, 1)}`,
    `그냥 들고 있었으면 ${formatPct(result.buyHoldReturn, 1)}`,
    timelineSquares(market, result.held),
    url,
  ].join('\n')
}
