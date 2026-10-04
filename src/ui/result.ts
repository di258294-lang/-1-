import { direction, formatPct, formatWon } from '../core/format'
import { PROFILE_MIN_ROUNDS, profileFrom, roundInsight, TYPES, type HabitRecord, type RoundHabits } from '../core/habits'
import { seasonLabel } from '../core/season'
import { save } from '../core/storage'
import { calendarLabel, dayOf, playPrice, TICKS_PER_SECOND, type Market } from '../core/market'
import { luckLesson, productLesson } from '../core/lessons'
import type { LuckResult } from '../core/luck'
import { PRODUCTS, type ProductKey } from '../core/products'
import type { RoundResult } from '../core/round'
import { newsKindLabel, newsToneLabel } from '../core/copy'
import { coachingFor } from '../core/session'
import { luckRank, shareText } from '../core/share'
import type { Mode, Navigate, Screen } from './app'
import { Chart } from './chart'
import { h, icons, svg } from './dom'
import { logError } from './errors'
import { lessonCard } from './lesson'
import { luckCard, luckPlaceholder, luckTestApplies, runLuckTest } from './luck'
import { missionCard, nextAction } from './missions'
import { isTutorial } from './tutorial'
import { startPractice } from './products'
import { shareOut, shareUrl } from './share'

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
 * Unlocks are not prizes (learning-design report §6). The two riskiest
 * products say plainly what they do before anyone plays them.
 */
const UNLOCK_NOTE: Partial<Record<ProductKey, string>> = {
  lev2: '2배 상품은 오를 때도 내릴 때도 두 배로 움직이고, 출렁이면 녹아요. 실제로는 사전 교육을 받아야 살 수 있는 위험한 상품이에요.',
  coin: '코인은 이 게임에서 가장 크게 출렁이는 상품이에요. 큰 수익 뒤에 큰 손실이 오는 일도 흔해요.',
}

/**
 * The grade compares with holding all along; the luck test compares with
 * random timing at the same exposure. When they point different ways, say why.
 */
function bridgeLine(result: RoundResult, percentile: number) {
  const edge = result.yourReturn - result.buyHoldReturn
  const luckGood = percentile >= 0.8
  const luckBad = percentile < 0.4
  if (edge >= 0.005 && luckBad) {
    return '위 결과는 그냥 들고 있는 것과, 이 비교는 같은 시간만큼 아무 때나 들고 있는 것과 견준 거예요. 시장을 앞선 건 타이밍보다 덜 들고 있었던 덕이 커요.'
  }
  if (edge <= -0.005 && luckGood) {
    return '위 결과는 그냥 들고 있는 것과, 이 비교는 같은 시간만큼 아무 때나 들고 있는 것과 견준 거예요. 들고 있던 시간이 짧아 시장엔 뒤졌지만 타이밍은 좋았어요.'
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

/**
 * Feedback hierarchy (learning-design report §2, user research #4):
 * above the fold at most three messages, in this order:
 *   1. the grade with the return against simply holding (and the luck rank
 *      once the test has run),
 *   2. the one thing from this round: the mission verdict, or the habit
 *      insight when the mission could not be judged,
 *   3. one next action.
 * The chart and at most one lesson follow; everything else (comparison
 * rows, luck test, fees and interest, news) folds under "자세히 보기".
 * Share and play-again stay on screen in a sticky bar.
 */
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
  const coaching = coachingFor(result)
  const mission = coaching?.mission ?? null
  const lesson = coaching?.lesson ?? null
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

  // Filled in when the luck test finishes, so the share carries it.
  let luck: LuckResult | null = null
  const share = async () =>
    shareOut(
      shareText({
        market,
        result,
        day: mode.kind === 'daily' ? mode.day : null,
        url: await shareUrl(),
        luck,
      }),
    )

  const heldPct = Math.round(result.heldRatio * 100)

  // 1. Grade and the comparison it is about.
  const luckInline = h('p', { class: 'result-luck num', hidden: true })
  const gradeBlock = h(
    'section',
    { class: 'result-head' },
    h('h1', { class: 'result-grade' }, result.grade.title),
    h('p', { class: 'result-line num' }, result.grade.line),
    h(
      'p',
      { class: 'result-vs num' },
      '나 ',
      h('b', { class: direction(result.yourReturn) }, formatPct(result.yourReturn, 1)),
      ' · 시장 ',
      h('b', { class: direction(result.buyHoldReturn) }, formatPct(result.buyHoldReturn, 1)),
    ),
    luckInline,
  )

  // 2. One thing from this round: the mission verdict when it was judged,
  // else the habit insight. The other goes under the fold.
  const insight = roundHabits ? roundInsight(roundHabits) : null
  const history = save.habitRecords()
  const profile = profileFrom(history)
  const foot = h(
    'button',
    { class: 'habit-foot', onclick: () => go({ name: 'habits' }) },
    profile
      ? h('span', null, '지금 내 성향 ', h('b', null, TYPES[profile.type].name))
      : h('span', null, '성향 진단까지 ', h('b', { class: 'num' }, `${Math.max(0, PROFILE_MIN_ROUNDS - history.length)}판`), ' 남았어요'),
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
  const judged = mission && (mission.outcome === 'pass' || mission.outcome === 'fail')
  const focus = judged ? missionCard(mission) : habitCard
  const folded = judged ? habitCard : mission && mission.outcome === 'ineligible' ? missionCard(mission) : null

  // 3. One next action.
  const next = nextAction(mission, !!judged)

  // The product's own lesson, unless it already fills the lesson slot.
  const productNote = productLesson(market)
  const productCard =
    productNote && lesson?.id !== `p:${market.product}` ? lessonCard(productNote, `${product.name}의 성격`) : null
  const slot = lesson ? lessonCard(lesson, lesson.id.startsWith('p:') ? `${product.name}의 성격` : '알아 두면 좋은 것') : null

  // The luck test replays the chart hundreds of times: show the page first.
  const luckSlot = luckTestApplies(market, result.held) ? luckPlaceholder() : null
  let luckCancelled = false
  let luckTimer = 0
  const runLuck = () => {
    if (luckCancelled || !luckSlot) return
    try {
      const res = runLuckTest(market, result.held, result.yourReturn)
      if (!res) {
        luckSlot.remove()
        return
      }
      luck = res
      const card = luckCard(res, bridgeLine(result, res.percentile))
      luckSlot.replaceWith(card)
      luckInline.textContent = `운 비교 · ${luckRank(res)}`
      luckInline.hidden = false
      if (record) save.setLuck(record.id, res.percentile)
      // L7/L8 belong with the luck card, and only on a round with no other lesson.
      if (!lesson && record) {
        const tested = save.habitRecords().filter((r) => r.luckPct !== null).length
        const extra = luckLesson(res, tested, save.coach().lessons)
        if (extra) {
          save.markLessonSeen(extra.id)
          card.after(lessonCard(extra, '운과 실력'))
        }
      }
    } catch (err) {
      logError(err, 'luck test')
      luckSlot.remove()
    }
  }
  // After the first paint, so the result shows up at once.
  if (luckSlot) requestAnimationFrame(() => (luckTimer = window.setTimeout(runLuck, 0)))

  const recap = h(
    'section',
    { class: 'recap' },
    h('h2', null, isLong ? `크게 움직인 뉴스 (전체 ${market.news.length}개 중)` : '그때 나온 뉴스'),
    h('p', { class: 'fine recap-note' }, '끝나고 보면 뻔해 보여도, 그 순간에는 어느 쪽일지 알 수 없었어요.'),
    ...recapNews(market).map((n) => {
      const when = isLong ? calendarLabel(dayOf(market, n.at)) : `${Math.floor(n.at / TICKS_PER_SECOND)}초`
      // What the headline implied (the live banner's own words), then what happened.
      const kind = newsKindLabel(market.product, n.kind)
      const implied = newsToneLabel(n)
      const outcome = n.actual > 0 ? '실제로는 올랐어요' : '실제로는 내렸어요'
      return h(
        'div',
        { class: 'recap-item' },
        h('span', { class: 'recap-time num' }, when),
        h('span', null, n.headline, h('span', { class: 'recap-kind' }, `${kind} · ${implied}`)),
        h('span', { class: `recap-out ${n.actual > 0 ? 'up' : 'down'}` }, outcome),
      )
    }),
  )

  const details = h(
    'section',
    { class: 'result-details', id: 'result-details', hidden: true },
    folded,
    productCard,
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
      `매매 ${result.trades}번 · 수수료 ${formatWon(result.fees)} · 쉬는 동안 붙은 이자 ${formatWon(result.interest)} · 들고 있던 시간 ${heldPct}%`,
    ),
    market.news.length ? recap : null,
  )
  const detailsToggle = h(
    'button',
    { class: 'btn btn-text recap-toggle', 'aria-expanded': 'false', 'aria-controls': 'result-details' },
    '자세히 보기',
  )
  detailsToggle.addEventListener('click', () => {
    const open = details.hidden
    details.hidden = !open
    detailsToggle.setAttribute('aria-expanded', String(open))
    detailsToggle.textContent = open ? '접기' : '자세히 보기'
  })

  const unlocks = unlocked.map((k) =>
    h(
      'button',
      { class: 'unlock unlock-quiet', onclick: () => startPractice(go, k) },
      h(
        'span',
        null,
        h('span', null, '연습할 수 있는 상품이 늘었어요 · ', h('b', null, PRODUCTS[k].name)),
        UNLOCK_NOTE[k] ? h('small', { class: 'unlock-note' }, UNLOCK_NOTE[k]) : null,
      ),
      h('span', { 'aria-hidden': 'true' }, '해보기 ›'),
    ),
  )

  const el = h(
    'main',
    { class: 'screen result-screen' },
    h(
      'div',
      { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': '홈으로', onclick: () => go({ name: 'home' }) }, svg(icons.close)),
    ),
    h(
      'p',
      { class: 'result-title' },
      `${mode.kind === 'daily' ? `오늘의 차트 #${mode.day}` : mode.replayOf ? '지난 차트 복기' : isLong ? '장기 모드 · 1년' : '연습'} · ${product.name}`,
    ),
    gradeBlock,
    focus,
    next,
    h('div', { class: 'result-chart' }, canvas),
    h(
      'div',
      { class: 'reveal' },
      h('span', null, h('b', null, market.company.name), ` ${market.company.code}`),
      h('span', null, market.company.sector),
    ),
    slot,
    ...unlocks,
    detailsToggle,
    details,
    // After the tutorial the next step is the real thing, not a share.
    isTutorial(market)
      ? h(
          'div',
          { class: 'result-actions result-sticky' },
          h('button', { class: 'btn btn-quiet', onclick: again }, '한 번 더 연습'),
          h('button', { class: 'btn btn-primary', onclick: () => go({ name: 'home' }) }, '이제 오늘의 차트'),
        )
      : h(
          'div',
          { class: 'result-actions result-sticky' },
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
