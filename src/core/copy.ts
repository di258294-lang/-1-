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
