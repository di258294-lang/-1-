import { playPrice, type Market } from './market'
import type { RoundResult } from './round'
import { edgeText, marketVerdicts } from './card'
import { formatPct } from './format'
import { PRODUCTS } from './products'
import { TYPES, type Profile } from './habits'

/**
 * Share texts. Every one is at most five lines, says (가상 게임) or (게임),
 * and never carries the luck rank (ux2 P0-3: a percentile shared as a brag
 * turns luck into a boast).
 */

const SLICES = 10

/** The tick range of each 4-second slice. Home's square row uses the same slicing. */
export function slices(market: Market): Array<[number, number]> {
  const per = market.playTicks / SLICES
  const out: Array<[number, number]> = []
  for (let i = 0; i < SLICES; i++) out.push([Math.round(i * per), Math.round((i + 1) * per)])
  return out
}

/** Held for at least half of the slice. */
function heldMost(held: readonly boolean[], from: number, to: number) {
  let n = 0
  for (let t = from; t < to; t++) if (held[t]) n++
  return n * 2 >= to - from
}

/**
 * One square per 4 seconds. Red when you held through a rise, blue when you
 * held through a drop, white when you sat in cash. Red for up follows the
 * Korean market convention. Reveals the chart, so practice and long only.
 */
export function timelineSquares(market: Market, held: readonly boolean[]) {
  return slices(market)
    .map(([from, to]) => {
      if (!heldMost(held, from, to)) return '⬜'
      return playPrice(market, to) - playPrice(market, from) >= 0 ? '🟥' : '🟦'
    })
    .join('')
}

/**
 * Spoiler-free timing marks (growth2 §4): per 4-second slice, ⭕ when the
 * call was right (holding while the price rose, or in cash while it fell or
 * stayed flat), ❌ otherwise. Nobody can read the chart's direction from it
 * without knowing what you held.
 */
export function timingMarks(market: Market, held: readonly boolean[]): { marks: string; right: number; total: number } {
  // The same verdicts as the result image (core/card.ts), so text and card agree.
  const verdicts = marketVerdicts(market, held)
  return { marks: verdicts.map((ok) => (ok ? '⭕' : '❌')).join(''), right: verdicts.filter(Boolean).length, total: verdicts.length }
}

/** The invitation every round share ends with: the link carries the chart (?c=). */
export const CHALLENGE_ASK = '같은 차트로 나보다 잘할 수 있어요?'

type ShareResult = Pick<RoundResult, 'yourReturn' | 'buyHoldReturn' | 'held'>

/** "그냥 들고 있기보다 +4.2%": the one relative number, which gives nothing away. */
export const edgeVsHold = (result: Pick<RoundResult, 'yourReturn' | 'buyHoldReturn'>) => edgeText(result.yourReturn, result.buyHoldReturn)

/**
 * Today's chart, spoiler-free: no raw returns, no up/down squares.
 *   HOLD #5 · 주식 (가상 게임)
 *   타이밍 8/10 ⭕⭕❌⭕⭕⭕❌⭕⭕⭕
 *   그냥 들고 있기보다 +4.2% · 12일 연속
 *   같은 차트로 나보다 잘할 수 있어요? https://…?c=…
 */
export function dailyShareText(opts: { market: Market; result: ShareResult; day: number; url: string; streak?: number }) {
  const { market, result, day, url, streak = 0 } = opts
  const t = timingMarks(market, result.held)
  return [
    `HOLD #${day} · ${PRODUCTS[market.product].name} (가상 게임)`,
    `타이밍 ${t.right}/${t.total} ${t.marks}`,
    `${edgeVsHold(result)}${streak >= 2 ? ` · ${streak}일 연속` : ''}`,
    `${CHALLENGE_ASK} ${url}`,
  ].join('\n')
}

/** Practice, long and replayed charts spoil nothing, so they keep the numbers and the squares. */
export function practiceShareText(opts: { market: Market; result: ShareResult; url: string; label?: string }) {
  const { market, result, url } = opts
  const label = opts.label ?? (market.length === 'long' ? '장기 1년' : '연습')
  return [
    `HOLD ${label} · ${PRODUCTS[market.product].name} (가상 게임)`,
    `나 ${formatPct(result.yourReturn, 1)} · 그냥 들고 있기 ${formatPct(result.buyHoldReturn, 1)}`,
    timelineSquares(market, result.held),
    `${CHALLENGE_ASK} ${url}`,
  ].join('\n')
}

/**
 * The share for any finished round: spoiler-free when it was a daily chart
 * (`day` set, including a friend's challenge on a daily chart), numbers and
 * squares otherwise.
 */
export function roundShareText(opts: {
  market: Market
  result: ShareResult
  day: number | null
  url: string
  streak?: number
  label?: string
}) {
  return opts.day !== null
    ? dailyShareText({ ...opts, day: opts.day })
    : practiceShareText({ market: opts.market, result: opts.result, url: opts.url, label: opts.label })
}

/** "■■■□□" for a 0..1 score. */
export function meter(score: number, cells = 5) {
  const filled = Math.round(Math.max(0, Math.min(1, score)) * cells)
  return '■'.repeat(filled) + '□'.repeat(cells - filled)
}

/** First sentence of a type's description, so the share stays one short line. */
function firstSentence(text: string) {
  const end = text.search(/[.?!](\s|$)/)
  return end < 0 ? text : text.slice(0, end + 1)
}

/**
 * The habit type, personality-test style (growth2 §4):
 *   HOLD 매매 습관 진단 (게임)
 *   나는 '새가슴형'
 *   조금만 올라도 팔아요.
 *   너는 무슨 형? https://…
 */
export function profileShareText(profile: Profile, url: string) {
  const type = TYPES[profile.type]
  return ['HOLD 매매 습관 진단 (게임)', `나는 '${type.name}'`, firstSentence(type.line), `너는 무슨 형? ${url}`].join('\n')
}
