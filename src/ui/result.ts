import { direction, formatPct, formatWon } from '../core/format'
import { analyzeRound, PROFILE_MIN_ROUNDS, profileFrom, roundInsight, TYPES } from '../core/habits'
import { seasonLabel } from '../core/season'
import { save } from '../core/storage'
import { HISTORY_TICKS, PLAY_TICKS, TICKS_PER_SECOND, type Market } from '../core/market'
import { productLesson } from '../core/lessons'
import { PRODUCTS, type ProductKey } from '../core/products'
import type { RoundResult } from '../core/round'
import type { Mode, Navigate, Screen } from './app'
import { Chart } from './chart'
import { h, icons, svg } from './dom'
import { startPractice } from './products'
import { shareResult } from './share'

const KICKER = { warn: '이번 판에서 보인 습관', good: '이번 판에서 잘한 점', none: '이번 판의 습관' } as const

function row(label: string, value: number, me = false) {
  return h(
    'div',
    { class: `row${me ? ' me' : ''}` },
    h('span', { class: 'row-label' }, label),
    h('span', { class: `row-value num ${direction(value)}` }, formatPct(value, 1)),
  )
}

export function resultScreen(
  go: Navigate,
  mode: Mode,
  market: Market,
  result: RoundResult,
  unlocked: ProductKey[],
): Screen {
  const product = PRODUCTS[market.product]
  const lesson = productLesson(market)
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

  const again = () => startPractice(go, market.product)

  const share = () =>
    shareResult({
      market,
      yourReturn: result.yourReturn,
      buyHoldReturn: result.buyHoldReturn,
      held: result.held,
      day: mode.kind === 'daily' ? mode.day : null,
    })

  const heldPct = Math.round(result.heldRatio * 100)

  // The habit this round revealed, and where it leaves the player's type.
  const insight = roundInsight(analyzeRound(market, result.held, result.fees))
  const history = save.habitHistory()
  const profile = profileFrom(history)
  const foot = h(
    'button',
    { class: 'habit-foot', onclick: () => go({ name: 'habits' }) },
    profile
      ? h('span', null, '지금 내 성향 ', h('b', null, TYPES[profile.type].name))
      : h('span', null, '성향 진단까지 ', h('b', { class: 'num' }, `${PROFILE_MIN_ROUNDS - history.length}판`), ' 남았어요'),
    h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'),
  )
  const habitCard = h(
    'section',
    { class: 'habit-card' },
    h('p', { class: 'habit-kicker' }, KICKER[insight.tone]),
    h('h2', { class: 'habit-title' }, insight.title),
    h('p', { class: 'habit-line num' }, insight.line),
    foot,
  )

  const recap = h(
    'section',
    { class: 'recap' },
    h('h2', null, '그때 나온 뉴스'),
    ...market.news.map((n) => {
      const sec = Math.floor(n.at / TICKS_PER_SECOND)
      const verdict =
        n.kind === 'filing' ? product.filingLabel : n.actual === n.implied ? '지라시 · 맞았어요' : '지라시 · 틀렸어요'
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
    h('p', { class: 'result-title' }, `${mode.kind === 'daily' ? `오늘의 차트 #${mode.day}` : '연습'} · ${product.name}`),
    h('h1', { class: 'result-grade' }, result.grade.title),
    h('p', { class: 'result-line' }, result.grade.line),
    ...unlocked.map((k) =>
      h(
        'button',
        { class: 'unlock', onclick: () => startPractice(go, k) },
        h('span', null, '새 상품이 열렸어요 · ', h('b', null, PRODUCTS[k].name)),
        h('span', { 'aria-hidden': 'true' }, '해보기 ›'),
      ),
    ),
    habitCard,
    h('div', { class: 'result-chart' }, canvas),
    h(
      'div',
      { class: 'reveal' },
      h('span', null, h('b', null, market.company.name), ` ${market.company.code}`),
      h('span', null, market.company.sector),
    ),
    lesson
      ? h(
          'section',
          { class: 'lesson-card' },
          h('p', { class: 'habit-kicker' }, `${product.name}의 성격`),
          h('h2', { class: 'habit-title' }, lesson.title),
          h('p', { class: 'habit-line num' }, lesson.line),
        )
      : null,
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
      mode.kind === 'daily'
        ? `${seasonLabel(mode.key)} 계좌 ${formatWon(result.startEquity)} → ${formatWon(result.finalEquity)}`
        : `${formatWon(result.finalEquity)}으로 끝났어요`,
    ),
    h(
      'p',
      { class: 'fine num' },
      `매매 ${result.trades}번 · 수수료 ${formatWon(result.fees)} · 현금 이자 ${formatWon(result.interest)} · 보유 시간 ${heldPct}%`,
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
