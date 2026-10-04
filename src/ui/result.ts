import { direction, formatPct, formatWon } from '../core/format'
import { PROFILE_MIN_ROUNDS, profileFrom, roundInsight, TYPES, type HabitRecord, type RoundHabits } from '../core/habits'
import { seasonLabel } from '../core/season'
import { save } from '../core/storage'
import { calendarLabel, dayOf, playPrice, TICKS_PER_SECOND, type Market } from '../core/market'
import { productLesson } from '../core/lessons'
import { PRODUCTS, type ProductKey } from '../core/products'
import type { RoundResult } from '../core/round'
import type { Mode, Navigate, Screen } from './app'
import { Chart } from './chart'
import { h, icons, svg } from './dom'
import { logError } from './errors'
import { luckCard, luckPlaceholder, luckTestApplies, runLuckTest } from './luck'
import { isTutorial } from './tutorial'
import { startPractice } from './products'
import { shareResult } from './share'

/** Long rounds have many headlines: show the five that moved the price most. */
function recapNews(market: Market) {
  if (market.length !== 'long') return market.news
  const move = (at: number) => {
    const to = Math.min(market.playTicks, at + 30)
    return Math.abs(Math.log(playPrice(market, to) / playPrice(market, Math.max(0, at - 1))))
  }
  return [...market.news]
    .sort((a, b) => move(b.impactAt) - move(a.impactAt))
    .slice(0, 5)
    .sort((a, b) => a.at - b.at)
}

const KICKER = { warn: '이번 판에서 보인 습관', good: '이번 판에서 잘한 점', none: '이번 판의 습관' } as const

/**
 * The grade compares with holding all along; the luck test compares with
 * random timing at the same exposure. When they point different ways, say why.
 */
function bridgeLine(result: RoundResult, percentile: number) {
  const edge = result.yourReturn - result.buyHoldReturn
  const luckGood = percentile >= 0.8
  const luckBad = percentile < 0.4
  if (edge >= 0.005 && luckBad) {
    return '위 등급은 그냥 들고 있는 것과, 이 비교는 같은 시간만큼 아무 때나 들고 있는 것과 견준 거예요. 시장을 앞선 건 타이밍보다 덜 들고 있었던 덕이 커요.'
  }
  if (edge <= -0.005 && luckGood) {
    return '위 등급은 그냥 들고 있는 것과, 이 비교는 같은 시간만큼 아무 때나 들고 있는 것과 견준 거예요. 들고 있던 시간이 짧아 시장엔 뒤졌지만 타이밍은 좋았어요.'
  }
  return null
}

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
  roundHabits?: RoundHabits,
  record: HabitRecord | null = null,
): Screen {
  const product = PRODUCTS[market.product]
  const lesson = productLesson(market)
  const canvas = h('canvas', { 'aria-label': '가격 흐름과 내가 들고 있던 구간' })
  const chart = new Chart(canvas, market, { top: 18, right: 20, bottom: 18, left: 20 })
  const draw = () =>
    chart.draw(
      {
        from: market.historyTicks - market.ticksPerDay,
        to: market.historyTicks + market.playTicks,
        head: market.historyTicks + market.playTicks,
        held: result.held,
        holdingNow: false,
        marks: market.news.map((n) => market.historyTicks + n.at),
        showHeadTag: false,
      },
      false,
    )
  requestAnimationFrame(draw)
  window.addEventListener('resize', draw)

  const isLong = market.length === 'long'
  const again = () => startPractice(go, market.product, market.length)

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
  const insight = roundHabits ? roundInsight(roundHabits) : null
  const history = save.habitRecords()
  const profile = profileFrom(history)
  const foot = h(
    'button',
    { class: 'habit-foot', onclick: () => go({ name: 'habits' }) },
    profile
      ? h('span', null, '지금 내 성향 ', h('b', null, TYPES[profile.type].name))
      : h('span', null, '성향 진단까지 ', h('b', { class: 'num' }, `${PROFILE_MIN_ROUNDS - history.length}판`), ' 남았어요'),
    h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'),
  )
  const habitCard = insight
    ? h(
        'section',
        { class: 'habit-card' },
        h('p', { class: 'habit-kicker' }, KICKER[insight.tone]),
        h('h2', { class: 'habit-title' }, insight.title),
        h('p', { class: 'habit-line num' }, insight.line),
        foot,
      )
    : null

  // The luck test replays the chart hundreds of times: show the page first.
  const luckSlot = luckTestApplies(market, result.held) ? luckPlaceholder() : null
  let luckCancelled = false
  let luckTimer = 0
  const runLuck = () => {
    if (luckCancelled || !luckSlot) return
    try {
      const luck = runLuckTest(market, result.held, result.yourReturn)
      if (!luck) {
        luckSlot.remove()
        return
      }
      luckSlot.replaceWith(luckCard(luck, bridgeLine(result, luck.percentile)))
      if (record) save.setLuck(record.id, luck.percentile)
    } catch (err) {
      logError(err, 'luck test')
      luckSlot.remove()
    }
  }
  // After the first paint, so the result shows up at once.
  if (luckSlot) requestAnimationFrame(() => (luckTimer = window.setTimeout(runLuck, 0)))

  const recap = h(
    'section',
    { class: 'recap', id: 'news-recap', hidden: true },
    h('h2', null, isLong ? `크게 움직인 뉴스 (전체 ${market.news.length}개 중)` : '그때 나온 뉴스'),
    ...recapNews(market).map((n) => {
      const when = isLong ? calendarLabel(dayOf(market, n.at)) : `${Math.floor(n.at / TICKS_PER_SECOND)}초`
      const verdict =
        n.kind === 'filing' ? product.filingLabel : n.actual === n.implied ? '지라시 · 맞았어요' : '지라시 · 틀렸어요'
      return h(
        'div',
        { class: 'recap-item' },
        h('span', { class: 'recap-time num' }, when),
        h('span', null, n.headline, h('span', { class: 'recap-kind' }, verdict)),
        h('span', { class: `recap-out ${n.actual > 0 ? 'up' : 'down'}` }, n.actual > 0 ? '올랐어요' : '내렸어요'),
      )
    }),
  )
  const recapToggle = h(
    'button',
    { class: 'btn btn-text recap-toggle', 'aria-expanded': 'false', 'aria-controls': 'news-recap' },
    '뉴스 다시 보기',
  )
  recapToggle.addEventListener('click', () => {
    const open = recap.hidden
    recap.hidden = !open
    recapToggle.setAttribute('aria-expanded', String(open))
    recapToggle.textContent = open ? '뉴스 접기' : '뉴스 다시 보기'
  })

  const el = h(
    'main',
    { class: 'screen' },
    h(
      'div',
      { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': '홈으로', onclick: () => go({ name: 'home' }) }, svg(icons.close)),
    ),
    h(
      'p',
      { class: 'result-title' },
      `${mode.kind === 'daily' ? `오늘의 차트 #${mode.day}` : isLong ? '장기 모드 · 1년' : '연습'} · ${product.name}`,
    ),
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
      // Over a year, perfect per-second timing is a meaningless number; the
      // deposit rate is the benchmark investors actually use.
      isLong ? row('예금에만 넣었다면', result.cashReturn) : row('1초 단위로 완벽했다면', result.perfectReturn),
    ),
    luckSlot,
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
    recapToggle,
    recap,
    // After the tutorial the next step is the real thing, not a share.
    isTutorial(market)
      ? h(
          'div',
          { class: 'result-actions' },
          h('button', { class: 'btn btn-quiet', onclick: again }, '한 번 더 연습'),
          h('button', { class: 'btn btn-primary', onclick: () => go({ name: 'home' }) }, '이제 오늘의 차트'),
        )
      : h(
          'div',
          { class: 'result-actions' },
          h('button', { class: 'btn btn-quiet', onclick: again }, mode.kind === 'daily' ? '연습 한 판' : '한 판 더'),
          h('button', { class: 'btn btn-primary', onclick: share }, '공유하기'),
        ),
    h('p', { class: 'fine disclaimer' }, '가상 시장에서 나온 게임 결과예요. 실제 투자 성과나 투자 조언이 아니에요.'),
  )

  return {
    el,
    back() {
      go({ name: 'home' })
      return true
    },
    destroy() {
      luckCancelled = true
      clearTimeout(luckTimer)
      window.removeEventListener('resize', draw)
      chart.destroy()
    },
  }
}
