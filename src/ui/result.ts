import { direction, formatPct, formatWon } from '../core/format'
import { generateMarket, HISTORY_TICKS, PLAY_TICKS, TICKS_PER_SECOND, type Market } from '../core/market'
import { hashString } from '../core/rng'
import type { RoundResult } from '../core/round'
import type { Mode, Navigate, Screen } from './app'
import { Chart } from './chart'
import { h, icons, svg } from './dom'
import { shareResult } from './share'

function row(label: string, value: number, me = false) {
  return h(
    'div',
    { class: `row${me ? ' me' : ''}` },
    h('span', { class: 'row-label' }, label),
    h('span', { class: `row-value num ${direction(value)}` }, formatPct(value, 1)),
  )
}

export function resultScreen(go: Navigate, mode: Mode, market: Market, result: RoundResult): Screen {
  const canvas = h('canvas', { 'aria-label': '가격 흐름과 내가 들고 있던 구간' })
  const chart = new Chart(canvas, market, { top: 18, right: 20, bottom: 18, left: 20 })
  const draw = () =>
    chart.draw(
      {
        from: HISTORY_TICKS - 20,
        to: HISTORY_TICKS + PLAY_TICKS,
        head: HISTORY_TICKS + PLAY_TICKS,
        held: result.held,
        holdingNow: false,
        marks: market.news.map((n) => HISTORY_TICKS + n.at),
        showHeadTag: false,
      },
      false,
    )
  requestAnimationFrame(draw)
  window.addEventListener('resize', draw)

  const again = () => {
    const seed = hashString(`practice/${Date.now()}/${Math.random()}`)
    go({ name: 'play', mode: { kind: 'practice' }, market: generateMarket(seed) })
  }

  const share = () =>
    shareResult({
      market,
      yourReturn: result.yourReturn,
      buyHoldReturn: result.buyHoldReturn,
      held: result.held,
      day: mode.kind === 'daily' ? mode.day : null,
    })

  const heldPct = Math.round(result.heldRatio * 100)

  const recap = h(
    'section',
    { class: 'recap' },
    h('h2', null, '그때 나온 뉴스'),
    ...market.news.map((n) => {
      const sec = Math.floor(n.at / TICKS_PER_SECOND)
      const verdict =
        n.kind === 'filing' ? '공시' : n.actual === n.implied ? '지라시 · 맞았어요' : '지라시 · 틀렸어요'
      return h(
        'div',
        { class: 'recap-item' },
        h('span', { class: 'recap-time num' }, `${sec}초`),
        h('span', null, n.headline, h('span', { class: 'recap-kind' }, verdict)),
        h('span', { class: `recap-out ${n.actual > 0 ? 'up' : 'down'}` }, n.actual > 0 ? '올랐어요' : '내렸어요'),
      )
    }),
  )
  const el = h(
    'main',
    { class: 'screen' },
    h(
      'div',
      { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': '홈으로', onclick: () => go({ name: 'home' }) }, svg(icons.close)),
    ),
    h('p', { class: 'result-title' }, mode.kind === 'daily' ? `오늘의 차트 #${mode.day}` : '연습 결과'),
    h('h1', { class: 'result-grade' }, result.grade.title),
    h('p', { class: 'result-line' }, result.grade.line),
    h('div', { class: 'result-chart' }, canvas),
    h(
      'div',
      { class: 'reveal' },
      h('span', null, h('b', null, market.company.name), ` ${market.company.code}`),
      h('span', null, market.company.sector),
    ),
    h(
      'section',
      { class: 'rows' },
      row('내 수익률', result.yourReturn, true),
      row('그냥 들고 있었으면', result.buyHoldReturn),
      row('1초 단위로 완벽했다면', result.perfectReturn),
    ),
    h(
      'p',
      { class: 'fine num' },
      `${formatWon(result.finalEquity)} · 매매 ${result.trades}번 · 수수료 ${formatWon(result.fees)} · 보유 ${heldPct}%`,
    ),
    recap,
    h(
      'div',
      { class: 'result-actions' },
      h('button', { class: 'btn btn-quiet', onclick: again }, mode.kind === 'daily' ? '연습 한 판' : '한 판 더'),
      h('button', { class: 'btn btn-primary', onclick: share }, '공유하기'),
    ),
  )

  return {
    el,
    destroy() {
      window.removeEventListener('resize', draw)
      chart.destroy()
    },
  }
}
