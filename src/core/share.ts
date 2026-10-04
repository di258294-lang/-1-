import { playPrice, type Market } from './market'
import type { RoundResult } from './round'
import { formatPct } from './format'
import { PRODUCTS } from './products'
import { HABIT_KEYS, HABIT_LABELS, TYPES, type Profile } from './habits'

const SLICES = 10

/**
 * One square per 4 seconds. Red when you held through a rise, blue when you
 * held through a drop, white when you sat in cash. Red for up follows the
 * Korean market convention.
 */
export function timelineSquares(market: Market, held: boolean[]) {
  const per = market.playTicks / SLICES
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
  const name = PRODUCTS[market.product].name
  const mode = market.length === 'long' ? '장기 1년' : '연습'
  const head = day === null ? `HOLD ${mode} · ${name}` : `HOLD #${day} · ${name}`
  return [
    `${head}  ${formatPct(result.yourReturn, 1)}`,
    `그냥 들고 있었으면 ${formatPct(result.buyHoldReturn, 1)}`,
    timelineSquares(market, result.held),
    url,
  ].join('\n')
}

/** "■■■□□" for a 0..1 score. */
export function meter(score: number, cells = 5) {
  const filled = Math.round(Math.max(0, Math.min(1, score)) * cells)
  return '■'.repeat(filled) + '□'.repeat(cells - filled)
}

export function profileShareText(profile: Profile, url: string) {
  return [
    'HOLD 매매 습관 진단',
    `나는 ${TYPES[profile.type].name}`,
    ...HABIT_KEYS.map((k) => `${meter(profile.scores[k])} ${HABIT_LABELS[k]}`),
    url,
  ].join('\n')
}
