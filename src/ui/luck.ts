import { formatPct } from '../core/format'
import { luckTest, luckVerdict } from '../core/luck'
import type { Market } from '../core/market'
import { h } from './dom'

const BINS = 28

/**
 * Skill or luck: where this round sits among random traders with the same
 * style on the same chart, drawn as a histogram with the player marked.
 */
export function luckCard(market: Market, held: boolean[]) {
  // Long rounds are 7.5x the ticks; fewer replays keep the screen instant.
  const result = luckTest(market, held, market.length === 'long' ? 400 : 1000)
  if (!result) return null
  const verdict = luckVerdict(result)
  const xs = result.nullReturns
  // Trim the extreme 1% on each side so one wild replay doesn't flatten the chart.
  const lo = Math.min(xs[Math.floor(xs.length * 0.01)], result.playerReturn)
  const hi = Math.max(xs[Math.ceil(xs.length * 0.99) - 1], result.playerReturn)
  const span = hi - lo || 1e-9
  const counts = new Array<number>(BINS).fill(0)
  for (const x of xs) counts[Math.min(BINS - 1, Math.max(0, Math.floor(((x - lo) / span) * BINS)))]++
  const peak = Math.max(...counts)
  const mine = Math.min(BINS - 1, Math.floor(((result.playerReturn - lo) / span) * BINS))
  const markerLeft = ((result.playerReturn - lo) / span) * 100

  const bars = h('div', { class: 'hist-bars', 'aria-hidden': 'true' })
  counts.forEach((c, i) => {
    bars.append(h('i', { class: i === mine ? 'me' : i < mine ? 'below' : '', style: `height:${Math.max(3, (c / peak) * 100)}%` }))
  })

  return h(
    'section',
    { class: 'luck' },
    h('p', { class: 'habit-kicker' }, '운일까 실력일까'),
    h('h2', { class: 'habit-title num' }, verdict.headline),
    h(
      'figure',
      {
        class: 'hist',
        role: 'img',
        'aria-label': `같은 차트에서 무작위로 누른 ${result.sims}판의 수익률 분포. 내 수익률 ${formatPct(result.playerReturn, 1)}`,
      },
      bars,
      h('span', { class: 'hist-marker', style: `left:${Math.min(100, Math.max(0, markerLeft))}%` }),
      h(
        'figcaption',
        { class: 'hist-axis num' },
        h('span', null, formatPct(lo, 1)),
        h('span', { class: 'hist-me' }, `나 ${formatPct(result.playerReturn, 1)}`),
        h('span', null, formatPct(hi, 1)),
      ),
    ),
    h('p', { class: 'habit-line' }, verdict.line),
    h(
      'p',
      { class: 'luck-note' },
      `같은 차트에서 나와 비슷한 횟수와 시간만큼 무작위로 누른 가상 플레이어 ${result.sims.toLocaleString('ko-KR')}명과 비교했어요.`,
    ),
  )
}
