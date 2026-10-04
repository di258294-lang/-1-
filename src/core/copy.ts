import { formatPct } from './format'
import type { NewsEvent } from './market'
import type { ProductKey } from './products'

/**
 * Plain-word labels for the live news banner. A 17-year-old and a
 * 58-year-old should both read them at a glance, so no 공시 or 지라시.
 */

/** "공식 발표" for confirmed news (gold's flashes stay 속보, marked 확실), "소문" for rumors. */
export function newsKindLabel(product: ProductKey, kind: NewsEvent['kind']) {
  if (kind === 'rumor') return '소문'
  return product === 'gold' ? '확실한 속보' : '공식 발표'
}

/**
 * Whether the headline sounds good or bad for the price. Uses what the
 * headline implies, never what happened: a rumor can be wrong, and that is
 * the lesson.
 */
export function newsToneLabel(news: Pick<NewsEvent, 'implied'>) {
  return news.implied > 0 ? '좋은 소식' : '나쁜 소식'
}

/** In-game money, always marked as not real: 10_000_000 -> "가상 1,000만 원". */
export function virtualWon(won: number) {
  const man = Math.round(won / 10_000)
  return `가상 ${man.toLocaleString('ko-KR')}만 원`
}

// ---------------------------------------------------------------------------
// Returns in plain words, from the numbers the screen shows (ux2 P1-1, P2-3)

/** The percent a ratio shows as at one decimal: 0.0749 -> 7.5, -0.0004 -> 0. */
export function shownPct(ratio: number): number {
  return Number(formatPct(ratio, 1).slice(0, -1))
}

/** "6.2%": the gap between two returns as the screen rounds them, so it always adds up. */
export function shownGap(a: number, b: number): string {
  return `${Math.abs(shownPct(a) - shownPct(b)).toFixed(1)}%`
}

/**
 * The edge over simply holding, in words: "그냥 들고 있기보다 6.2% 덜 벌었어요".
 * Computed from the rounded numbers, and a market that rounds to 0.0 is
 * "그대로" rather than a gain or a loss.
 */
export function edgeWords(you: number, buyHold: number): string {
  const a = shownPct(you)
  const b = shownPct(buyHold)
  const gap = shownGap(you, buyHold)
  if (b === 0 && a !== 0) return `시장은 그대로였는데 ${Math.abs(a).toFixed(1)}% ${a > 0 ? '벌었어요' : '잃었어요'}`
  if (a === b) return '그냥 들고 있기와 같았어요'
  const verb =
    a > b
      ? a <= 0
        ? '덜 잃었어요'
        : b >= 0
          ? '더 벌었어요'
          : '앞섰어요'
      : a >= 0
        ? '덜 벌었어요'
        : b <= 0
          ? '더 잃었어요'
          : '뒤졌어요'
  return `그냥 들고 있기보다 ${gap} ${verb}`
}

/**
 * The grade line with its gap re-derived from the rounded numbers on screen
 * ("나 -0.7% · 시장 0.0%" never sits next to "0.6% 덜 잃었어요"). A market
 * that rounds to 0.0 gets "시장은 그대로였는데 0.7% 잃었어요".
 */
export function gradeLineShown(line: string, you: number, buyHold: number): string {
  const a = shownPct(you)
  const b = shownPct(buyHold)
  if (b === 0 && a !== 0) return `${edgeWords(you, buyHold)}.`
  const raw = `${Math.abs((you - buyHold) * 100).toFixed(1)}%`
  return line.split(raw).join(shownGap(you, buyHold))
}

// ---------------------------------------------------------------------------
// Why the grade and the timing comparison disagree (stats2 §5)

export type EdgeParts = { exposure: number; fees: number; timing: number }

export type EdgeInput = {
  yourReturn: number
  buyHoldReturn: number
  cashReturn: number
  heldRatio: number
  fees: number
  startEquity: number
}

/**
 * Splits the edge over holding into three parts that add up to it:
 * exposure `(h−1)·bh + (1−h)·cash` (time out of the market, earning cash
 * instead), fees `−fees/startEquity`, and timing (the rest).
 */
export function edgeParts(r: EdgeInput): EdgeParts {
  const edge = r.yourReturn - r.buyHoldReturn
  const h = r.heldRatio
  const exposure = (h - 1) * r.buyHoldReturn + (1 - h) * r.cashReturn
  const fees = r.startEquity > 0 ? -r.fees / r.startEquity : 0
  return { exposure, fees, timing: edge - exposure - fees }
}

/** The part with the largest size; a tie goes to the earlier key. */
export function largestPart(p: EdgeParts): keyof EdgeParts {
  const keys: Array<keyof EdgeParts> = ['exposure', 'fees', 'timing']
  return keys.reduce((a, b) => (Math.abs(p[b]) > Math.abs(p[a]) ? b : a))
}

const BRIDGE_HEAD = '위 결과는 그냥 들고 있는 것과, 이 비교는 같은 시간만큼 아무 때나 들고 있는 것과 견준 거예요.'

/**
 * One sentence under the timing comparison when it points the other way
 * from the grade. It names the largest part of the edge, and only says
 * "들고 있던 시간" when exposure is that part.
 */
export function bridgeLine(r: EdgeInput, percentile: number): string | null {
  const edge = r.yourReturn - r.buyHoldReturn
  const big = largestPart(edgeParts(r))
  if (edge >= 0.005 && percentile < 0.4) {
    if (big === 'exposure') return `${BRIDGE_HEAD} 시장을 앞선 건 타이밍보다 덜 들고 있었던 덕이 커요.`
    return `${BRIDGE_HEAD} 시장은 앞섰지만, 같은 시간을 아무 때나 들고 있던 경우의 절반 넘게보다는 못했어요.`
  }
  if (edge <= -0.005 && percentile >= 0.8) {
    if (big === 'exposure')
      return `${BRIDGE_HEAD} 들고 있던 시간이 짧아 시장엔 뒤졌지만, 같은 시간을 아무 때나 들고 있던 경우의 80% 이상보다는 나았어요.`
    if (big === 'fees')
      return `${BRIDGE_HEAD} 시장에 뒤진 건 주로 수수료 때문이에요. 타이밍만 보면 같은 시간을 아무 때나 들고 있던 경우의 80% 이상보다 나았어요.`
    return `${BRIDGE_HEAD} 시장보다는 뒤졌지만, 같은 시간을 아무 때나 들고 있던 경우의 80% 이상보다는 나았어요.`
  }
  return null
}
