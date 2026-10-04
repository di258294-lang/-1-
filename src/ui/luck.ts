import { formatPct } from '../core/format'
import { LUCK_SIMS, luckTest, luckVerdict, type LuckResult } from '../core/luck'
import type { Market } from '../core/market'
import { h } from './dom'

const BINS = 28

/**
 * `yourReturn` is the round engine's own number, so taps shorter than a tick
 * (charged fees that `held` cannot show) are compared honestly.
 */
export function runLuckTest(market: Market, held: boolean[], yourReturn?: number) {
  return luckTest(market, held, LUCK_SIMS, yourReturn)
}

/** Whether luckTest() will have anything to compare (mirrors its early exit). */
export function luckTestApplies(market: Market, held: boolean[]) {
  let heldTicks = 0
  for (let t = 0; t < market.playTicks; t++) if (held[t]) heldTicks++
  return heldTicks > 0 && heldTicks < market.playTicks - 2
}

/** Same footprint as the card, shown while the replays run. */
export function luckPlaceholder() {
  return h(
    'section',
    { class: 'luck luck-pending', 'aria-busy': 'true' },
    h('p', { class: 'habit-kicker' }, '운일까 실력일까'),
    h('h2', { class: 'habit-title' }, '무작위로 누른 판들과 비교하고 있어요'),
    h('div', { class: 'hist-bars', 'aria-hidden': 'true' }),
  )
}

/**
 * Skill or luck: where this round sits among random placements of the
 * player's own holding stretches on the same chart, drawn as a histogram
 * with the player marked.
 * `bridge` is an extra sentence shown under the verdict.
 */
export function luckCard(result: LuckResult, bridge?: string | null) {
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
        'aria-label': `같은 차트에서 들고 있던 구간을 무작위로 옮겨 본 ${result.sims}번의 수익률 분포. 내 수익률 ${formatPct(result.playerReturn, 1)}`,
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
    bridge ? h('p', { class: 'habit-line luck-bridge' }, bridge) : null,
    h('p', { class: 'luck-note' }, verdict.note),
  )
}
