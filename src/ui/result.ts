import { leaderboardButton } from './leaderboard'
import { bridgeLine, gradeLineShown } from '../core/copy'
import { dailySeed, dateKey, nextKey } from '../core/daily'
import { direction, formatPct, formatWon } from '../core/format'
import { PROFILE_MIN_ROUNDS, profileFrom, roundInsight, TYPES, type HabitRecord, type RoundHabits } from '../core/habits'
import { seasonLabel } from '../core/season'
import { save } from '../core/storage'
import { calendarLabel, dayOf, generateMarket, playPrice, TICKS_PER_SECOND, type Market } from '../core/market'
import { luckLesson, productLesson } from '../core/lessons'
import { MISSIONS, type MissionOutcome } from '../core/missions'
import { dailyProduct, PRODUCTS, type ProductKey } from '../core/products'
import type { RoundResult } from '../core/round'
import { newsKindLabel, newsToneLabel } from '../core/copy'
import { coachingFor, longestHold, TUTORIAL_HOLD_TICKS } from '../core/session'
import { weeklyProgress, type WeeklyDay } from '../core/weekly'
import { announce, clearAnnouncements } from './announce'
import type { Mode, Navigate, Screen } from './app'
import { Chart } from './chart'
import { h, icons, storageWarning, svg } from './dom'
import { logError } from './errors'
import { dailyDone, startDaily, withIntro } from './gate'
import { lessonCard } from './lesson'
import { luckCard, luckPlaceholder, luckSkipLine, luckTestApplies, runLuckTest } from './luck'
import { missionCard } from './missions'
import { isTutorial, startTutorial } from './tutorial'
import { challengeButton, challengeCompare, challengeLuck, challengeOf, pendingChallengeCard, shareRound } from './challenge'
import { imageShareAvailable, renderResultCard, shareCard } from './card'
import { showProductSheet, startPractice } from './products'
import { shareUrl } from './share'
import { productOf } from './week'

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

function row(label: string, value: number, me = false) {
  return h(
    'div',
    { class: `row${me ? ' me' : ''}` },
    h('span', { class: 'row-label' }, label),
    h('span', { class: `row-value num ${direction(value)}` }, formatPct(value, 1)),
  )
}

function versusLine(result: Pick<RoundResult, 'yourReturn' | 'buyHoldReturn'>) {
  return h(
    'p',
    { class: 'result-vs num' },
    '나 ',
    h('b', { class: direction(result.yourReturn) }, formatPct(result.yourReturn, 1)),
    ' · 시장 ',
    h('b', { class: direction(result.buyHoldReturn) }, formatPct(result.buyHoldReturn, 1)),
  )
}

/** "끝났어요. 올랐는데 덜 탔어요. 나 +6.8%, 시장 +9.5%." */
function endAnnouncement(title: string, result: Pick<RoundResult, 'yourReturn' | 'buyHoldReturn'>) {
  return `끝났어요. ${title}. 나 ${formatPct(result.yourReturn, 1)}, 시장 ${formatPct(result.buyHoldReturn, 1)}.`
}

/** Focus the screen's h1 once it is in the page, and read the result out (ux2 P1-11). */
function focusAndAnnounce(heading: HTMLElement, message: string) {
  heading.setAttribute('tabindex', '-1')
  requestAnimationFrame(() => {
    if (heading.isConnected) heading.focus({ preventScroll: true })
    announce(message)
  })
}

function chartFor(market: Market, result: RoundResult) {
  const canvas = h('canvas', { role: 'img', 'aria-label': '가격 흐름과 내가 들고 있던 구간' })
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
  return {
    el: h('div', { class: 'result-chart' }, canvas),
    destroy() {
      window.removeEventListener('resize', draw)
      chart.destroy()
    },
  }
}

/**
 * The next round's mission, without its "why" (that sentence folds under
 * 자세히 보기, ux2 P1-8). Returns the visible tip and the folded line.
 */
function nextMission(outcome: MissionOutcome | null, compact: boolean): { tip: HTMLElement | null; why: HTMLElement | null } {
  const pick = outcome?.next
  const id = pick?.id ?? outcome?.id
  if (!id) return { tip: null, why: null }
  const def = MISSIONS[id]
  const fresh = !!pick
  if (!fresh && compact) {
    return { tip: h('div', { class: 'tip next-action' }, h('span', null, '다음 판에서 해볼 것'), h('b', null, def.goal)), why: null }
  }
  const label = fresh ? (pick.recheck ? '다음 판 미션 · 다시 해보기' : outcome?.outcome === 'new' ? '다음 판 미션' : '새 미션') : '다음 판에서 해볼 것'
  return {
    tip: h(
      'div',
      { class: 'tip next-action' },
      h('span', null, label),
      h('b', null, def.title),
      fresh && outcome?.reason && !compact ? h('span', { class: 'next-goal' }, outcome.reason) : null,
      h('span', { class: 'next-goal' }, def.goal),
    ),
    why: fresh ? h('p', { class: 'fine' }, `${label} · ${def.title}: ${def.why}`) : null,
  }
}

const weeklyDay = (key: string): WeeklyDay | undefined => {
  const d = save.daily(key)
  return d && { key, ...d }
}

/** Whether a day's chart has a rumor for the noRumor rule to judge (core/weekly.ts hasRumor). */
const chartHasRumor = (key: string) => {
  const m = generateMarket(dailySeed(key), productOf(key), 'short')
  return m.news.some((n) => n.kind === 'rumor' && n.at < m.playTicks)
}

/**
 * The end of a daily result: what tomorrow brings and how close this week's
 * challenge is (ux2 P1-4, top-5 #3). "내일은 채권 · 이번 주 챌린지 2/3, 하루 더 해내면 완료예요".
 * A round finished after midnight says today's chart is open instead (qa3
 * P2-10), and noRumor only counts the days left whose chart has a rumor
 * (qa3 P2-5a).
 */
function tomorrowHook(key: string): HTMLElement | null {
  try {
    const today = dateKey()
    const rolled = today !== key
    const head = rolled
      ? `오늘의 ${PRODUCTS[dailyProduct(today)].name} 차트가 열렸어요`
      : `내일은 ${PRODUCTS[dailyProduct(nextKey(key))].name}`
    let weekly = ''
    try {
      const p = weeklyProgress(key, weeklyDay, (d) => generateMarket(dailySeed(d.key), productOf(d.key), 'short'))
      const future = p.days.filter((d) => d.mark === 'future')
      const noRumor = p.rule.key === 'noRumor'
      const left = noRumor ? future.filter((d) => chartHasRumor(d.key)).length : future.length
      const need = p.goal - p.passed
      if (p.days.find((d) => d.key === key)?.mark === 'skip') weekly = '이번 주 챌린지 · 오늘 차트엔 소문이 없어서 세지 않았어요'
      else if (p.done) weekly = '이번 주 챌린지 완료'
      else if (future.length === 0) weekly = rolled ? '새 주 챌린지가 열렸어요' : '내일부터 새 주 챌린지가 열려요'
      else if (need <= left) weekly = `이번 주 챌린지 ${p.goal}번 중 ${p.passed}번, ${need === 1 ? '하루' : `${need}번`} 더 해내면 완료예요`
      else if (noRumor) weekly = '이번 주는 소문 있는 날이 부족해요'
    } catch (err) {
      logError(err, 'tomorrowHook weekly')
    }
    return h('div', { class: 'tip tomorrow-hook' }, h('b', null, head), weekly ? h('span', null, weekly) : null)
  } catch (err) {
    logError(err, 'tomorrowHook')
    return null
  }
}

/**
 * The guided tutorial's result (ux2 P0-1, P1-7, P2-2): no grade, luck or
 * habit cards, "연습이라 기록에는 남지 않아요", and a tapper (no hold of
 * 1.5 s or more) is told what went wrong and offered another try first.
 * Otherwise the handoff card says the next one is real and starts it.
 */
function tutorialResult(go: Navigate, market: Market, result: RoundResult): Screen {
  const product = PRODUCTS[market.product]
  // The same 1.5 s bar that marks the intro seen (core/session.ts).
  const tapped = longestHold(result.held) < TUTORIAL_HOLD_TICKS
  // Nothing pressed at all: don't blame a tap that never happened (qa3 P2-2).
  const untouched = result.trades === 0
  let toggle = false
  try {
    toggle = save.getSettings().tapToggle
  } catch {
    // Default controls.
  }
  const done = dailyDone()
  // The save can't be written: a daily would fail after its countdown, so
  // say why and offer practice instead (qa3 P2-9).
  let canRecord = false
  try {
    canRecord = save.canRecord()
  } catch {
    // Can't even ask: treat as not recording.
  }
  const blocked = !done && !canRecord
  const heading = h(
    'h1',
    { class: 'result-grade' },
    untouched ? '연습 차트가 그냥 지나갔어요' : tapped ? "아직 '계속 누르기'가 안 됐어요" : '연습 끝, 잘 따라왔어요',
  )
  const head = h(
    'section',
    { class: 'result-head' },
    heading,
    h(
      'p',
      { class: 'result-line' },
      untouched
        ? toggle
          ? '아직 한 번도 안 눌렀어요. 화면을 한 번 톡 치면 사요.'
          : '아직 한 번도 안 눌렀어요. 화면을 누르고 있으면 사요.'
        : tapped
          ? toggle
            ? '한 번 톡 치면 사고, 다시 톡 치면 팔아요. 그 사이 동안만 들고 있어요.'
            : '짧게 톡 치면 사자마자 팔려요. 손가락을 화면에 대고 있는 동안만 들고 있어요.'
          : toggle
            ? '톡 치면 사고, 다시 톡 치면 팔아요. 그게 전부예요.'
            : '손가락을 대고 있는 동안 들고 있고, 떼면 팔아요. 그게 전부예요.',
    ),
    versusLine(result),
    h('p', { class: 'fine' }, '연습이라 기록에는 남지 않아요.'),
  )
  const handoff =
    tapped || done || blocked
      ? null
      : h(
          'section',
          { class: 'habit-card handoff-card' },
          h('p', { class: 'habit-kicker' }, '다음은 오늘의 차트'),
          h('h2', { class: 'habit-title' }, '이번엔 진짜예요'),
          h('p', { class: 'habit-line' }, '오늘의 차트는 하루 한 번, 모두가 같은 차트로 해요. 40초예요.'),
        )
  const chart = chartFor(market, result)
  const again = () => startTutorial(go)
  const daily = () => startDaily(go)
  const home = () => go({ name: 'home' })
  const practice = () => showProductSheet(go)
  // The way on: home once today's chart is done, practice when nothing can be saved, else the daily.
  const next = (label: string) =>
    done ? ['홈으로', home] as const : blocked ? ['연습 한 판', practice] as const : [label, daily] as const
  const [tapLabel, tapGo] = next('오늘의 차트로')
  const [goLabel, goNext] = next('오늘의 차트 시작')
  const actions = tapped
    ? [
        h('button', { class: 'btn btn-quiet', onclick: tapGo }, tapLabel),
        h('button', { class: 'btn btn-primary', onclick: again }, '한 번 더 연습'),
      ]
    : [
        h('button', { class: 'btn btn-quiet', onclick: again }, '한 번 더 연습'),
        h('button', { class: 'btn btn-primary', onclick: goNext }, goLabel),
      ]
  const el = h(
    'main',
    { class: 'screen result-screen' },
    h('div', { class: 'topbar' }, h('button', { class: 'icon-btn', 'aria-label': '홈으로', onclick: home }, svg(icons.close))),
    h('p', { class: 'result-title' }, `처음 연습 · ${product.name}`),
    head,
    blocked ? storageWarning() : null,
    handoff,
    chart.el,
    h('div', { class: 'result-actions result-sticky' }, ...actions),
    h('p', { class: 'fine disclaimer' }, '가상 시장에서 나온 게임 결과예요. 실제 투자 성과나 투자 조언이 아니에요.'),
  )
  focusAndAnnounce(
    heading,
    untouched
      ? '끝났어요. 아직 한 번도 안 눌렀어요. 한 번 더 연습해 보세요.'
      : tapped
        ? `끝났어요. 아직 계속 누르기가 안 됐어요. 한 번 더 연습해 보세요.`
        : endAnnouncement('연습 끝', result),
  )
  return {
    el,
    back() {
      home()
      return true
    },
    destroy() {
      clearAnnouncements()
      chart.destroy()
    },
  }
}

/**
 * Feedback hierarchy (ux2 P1-8): above the fold only the grade, one card
 * and the chart.
 *   1. The grade with the return against simply holding. On a friend's
 *      challenge the head-to-head card is the headline and the grade sits
 *      under it. No luck rank up here (ux2 P0-3).
 *   2. One card: the mission verdict, or the habit insight when the mission
 *      could not be judged.
 *   3. The chart, then the next mission (its "why" folds away), one lesson,
 *      and on a daily chart a waiting challenge and tomorrow's hook.
 * Everything else (comparison rows, the timing comparison, fees, news)
 * folds under "자세히 보기". Share and play-again stay in a sticky bar.
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
  if (isTutorial(market)) return tutorialResult(go, market, result)

  const product = PRODUCTS[market.product]
  const coaching = coachingFor(result)
  const mission = coaching?.mission ?? null
  const lesson = coaching?.lesson ?? null
  const chart = chartFor(market, result)
  const isLong = market.length === 'long'
  const friend = challengeOf(market)
  const daily = mode.kind === 'daily'

  // A locked product (a friend's coin chart, a replay of a leverage day) is
  // never one tap away: the picker shows what is open (QA #8).
  const again = () => {
    let open = false
    try {
      open = save.isUnlocked(market.product)
    } catch {
      // Treat as locked.
    }
    if (open) startPractice(go, market.product, market.length)
    else showProductSheet(go, market.length)
  }
  const share = () => shareRound(market, result, mode).catch((err) => logError(err, 'shareRound'))

  const heldPct = Math.round(result.heldRatio * 100)
  const gradeLine = gradeLineShown(result.grade.line, result.yourReturn, result.buyHoldReturn)

  // 1. The headline: the head-to-head on a challenge round, else the grade.
  const versus = challengeCompare(market, result, 'h1')
  const gradeHeading = h(versus ? 'h2' : 'h1', { class: versus ? 'habit-title' : 'result-grade' }, result.grade.title)
  const gradeBlock = h(
    'section',
    { class: versus ? 'result-head result-head-sub' : 'result-head' },
    gradeHeading,
    h('p', { class: 'result-line num' }, gradeLine),
    versus ? null : versusLine(result),
  )

  // 2. One thing from this round: the mission verdict when it was judged,
  // else the habit insight. The other goes under the fold.
  const insight = roundHabits ? roundInsight(roundHabits) : null
  const history = save.habitRecords()
  const profile = profileFrom(history)
  // The image card is drawn up front so a tap keeps the user gesture that
  // iOS needs for navigator.share. Web only: native shells can't take files yet.
  const card =
    mode.kind === 'daily' && imageShareAvailable()
      ? shareUrl().then((url) =>
          renderResultCard({
            format: 'story',
            market,
            result,
            day: mode.day,
            url: url.replace(/^https?:\/\//, ''),
            streak: save.streak(mode.key),
            typeName: profile ? TYPES[profile.type].name : null,
          }),
        )
      : null
  card?.catch((err) => logError(err, 'result card'))
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
  // Challenge rounds carry no mission (coachingFor gives mission: null).
  const judged = !versus && mission && (mission.outcome === 'pass' || mission.outcome === 'fail')
  const focus = versus ? null : judged ? missionCard(mission) : habitCard
  const folded = versus || judged ? habitCard : mission && mission.outcome === 'ineligible' ? missionCard(mission) : null

  // 3. The next mission, its "why" folded.
  const next = nextMission(mission, !!judged)

  // The product's own lesson, unless it already fills the lesson slot.
  const productNote = productLesson(market)
  const productCard =
    productNote && lesson?.id !== `p:${market.product}` ? lessonCard(productNote, `${product.name}의 성격`) : null
  // The habit card already says what the fees cost: no fee lesson on top (ux2 P1-8).
  const feeTwice = lesson?.id === 'L1' && insight?.habit === 'scalper'
  const slot = lesson && !feeTwice ? lessonCard(lesson, lesson.id.startsWith('p:') ? `${product.name}의 성격` : '알아 두면 좋은 것') : null

  // The timing comparison replays the chart hundreds of times: show the page first.
  const luckSlot = luckTestApplies(market, result.held) ? luckPlaceholder() : null
  const luckSkipped = luckSlot ? null : luckSkipLine(market, result.held)
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
      const card = luckCard(res, bridgeLine(result, res.percentile))
      luckSlot.replaceWith(card)
      challengeLuck(market, res.percentile)
      if (record) save.setLuck(record.id, res.percentile)
      // L7/L8 belong with the comparison card, and only on a round with no other lesson.
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
    next.why,
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
    luckSkipped ? h('p', { class: 'fine' }, luckSkipped) : null,
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

  const title = daily
    ? `오늘의 차트 #${mode.day}`
    : friend
      ? '친구 도전'
      : mode.kind === 'practice' && mode.replayOf
        ? '지난 차트 다시 보기'
        : isLong
          ? '장기 모드 · 1년'
          : '연습'

  // A friend's round on a day the player hasn't done yet: point at today's chart too.
  const tryDaily = friend && !dailyDone()
  const actions = h(
    'div',
    { class: 'result-actions result-sticky' },
    tryDaily
      ? h('button', { class: 'btn btn-quiet', onclick: () => withIntro(go, () => startDaily(go)) }, '오늘의 차트도 해보기')
      : h('button', { class: 'btn btn-quiet', onclick: again }, daily ? '연습 한 판' : '한 판 더'),
    h('button', { class: 'btn btn-primary', onclick: share }, '공유하기'),
  )

  const el = h(
    'main',
    { class: 'screen result-screen' },
    h(
      'div',
      { class: 'topbar' },
      h('button', { class: 'icon-btn', 'aria-label': '홈으로', onclick: () => go({ name: 'home' }) }, svg(icons.close)),
    ),
    h('p', { class: 'result-title' }, `${title} · ${product.name}`),
    versus,
    gradeBlock,
    focus,
    chart.el,
    h(
      'div',
      { class: 'reveal' },
      h('span', null, h('b', null, market.company.name), ` ${market.company.code}`),
      h('span', null, market.company.sector),
    ),
    daily ? pendingChallengeCard(go) : null,
    next.tip,
    slot,
    ...unlocks,
    daily ? tomorrowHook(mode.key) : null,
    detailsToggle,
    details,
    actions,
    challengeButton(market, result, mode),
    daily ? leaderboardButton() : null,
    card
      ? h('button', { class: 'btn btn-text', onclick: async () => void shareCard(await card, `hold-${market.seed}.png`) }, '이미지로 공유')
      : null,
    storageWarning(),
    h('p', { class: 'fine disclaimer' }, '가상 시장에서 나온 게임 결과예요. 실제 투자 성과나 투자 조언이 아니에요.'),
  )

  const heading = (versus?.querySelector('h1') as HTMLElement | null) ?? gradeHeading
  focusAndAnnounce(heading, endAnnouncement(versus ? `${heading.textContent}. ${result.grade.title}` : result.grade.title, result))

  return {
    el,
    back() {
      go({ name: 'home' })
      return true
    },
    destroy() {
      luckCancelled = true
      clearTimeout(luckTimer)
      clearAnnouncements()
      chart.destroy()
    },
  }
}
