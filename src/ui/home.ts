import { dateKey, dayNumber, dailySeed, nextKey } from '../core/daily'
import { dailyProduct, PRODUCTS } from '../core/products'
import { direction, formatPct, formatPrice, formatWon, iEyo } from '../core/format'
import { edgeWords, virtualWon } from '../core/copy'
import { PROFILE_MIN_ROUNDS, profileFrom, TYPES } from '../core/habits'
import { seasonDaysLeft, seasonLabel, SEASON_START } from '../core/season'
import { generateMarket, playPrice, type Market } from '../core/market'
import { slices } from '../core/share'
import { save, type SavedDaily } from '../core/storage'
import { clearAnnouncements } from './announce'
import type { Navigate, Screen } from './app'
import { pendingChallengeCard } from './challenge'
import { Chart } from './chart'
import { h, icons, storageWarning, svg, toast } from './dom'
import { logError } from './errors'
import { startDaily, withIntro } from './gate'
import { missionChip } from './missions'
import { showProductSheet } from './products'
import { markSeasonsSeen, pendingRecap, recapCard } from './season'
import { openSettings } from './settings'
import { shareResult } from './share'
import { weekStripButton } from './week'
import { weeklyRow } from './weekly'

const weekday = ['일', '월', '화', '수', '목', '금', '토']

function dateLabel(key: string) {
  const [, m, d] = key.split('-').map(Number)
  const wd = weekday[new Date(`${key}T00:00:00Z`).getUTCDay()]
  return `${m}월 ${d}일 ${wd}요일`
}

/** One square per 4 seconds, the same slicing as the practice share. */
function squaresFor(market: Market, held: boolean[]) {
  const row = h('div', { class: 'squares', 'aria-hidden': 'true' })
  for (const [from, to] of slices(market)) {
    let n = 0
    for (let t = from; t < to; t++) if (held[t]) n++
    const cls = n * 2 < to - from ? '' : playPrice(market, to) >= playPrice(market, from) ? 'u' : 'd'
    row.append(h('i', { class: cls }))
  }
  return row
}

/** What the squares mean, so nobody has to guess (ux2 P1-9). */
function squaresLegend() {
  const key = (cls: string, text: string) => h('span', { class: 'wk-key' }, h('i', { class: `sq-key ${cls}` }), text)
  return h(
    'p',
    { class: 'wk-legend sq-legend' },
    key('u', '빨강 오를 때 들고 있음'),
    key('d', '파랑 내릴 때 들고 있음'),
    key('', '회색 쉼'),
  )
}

export function homeScreen(go: Navigate): Screen {
  clearAnnouncements()
  const key = dateKey()
  const day = dayNumber(key)
  // Both are idempotent: archive finished months, and spend "휴장일" tokens on
  // missed days so a short break doesn't reset the streak.
  save.closeSeasons(key)
  const frozen = save.applyStreakFreezes(key)
  if (frozen.length) toast(`휴장일 ${frozen.length}개로 연속 기록을 지켰어요`)
  const played = save.daily(key)
  // A finished day keeps the product it was played with.
  const productKey = played?.product ?? dailyProduct(key)
  const product = PRODUCTS[productKey]
  const market = generateMarket(dailySeed(key), productKey)
  const tomorrow = nextKey(key)
  const tomorrowProduct = PRODUCTS[dailyProduct(tomorrow)]
  const streak = save.streak(key)
  const history = save.habitRecords()
  const profile = profileFrom(history)
  // Before the first daily chart a newcomer needs one thing: 시작하기 (ux2 P1-9).
  const firstLaunch = !played && save.dailyHistory().length === 0
  const seen = save.seenIntro()

  const top = h(
    'div',
    { class: 'topbar' },
    h('span', { class: 'wordmark' }, 'HOLD'),
    h(
      'span',
      { class: 'home-tools' },
      streak > 0 ? h('span', { class: 'home-streak' }, h('b', { class: 'num' }, `${streak}일`), ' 연속') : null,
      h('button', { class: 'icon-btn', 'aria-label': '설정', onclick: () => openSettings() }, svg(icons.settings)),
    ),
  )

  const openRecords = () => go({ name: 'records' })
  const hero = h(
    'div',
    { class: 'home-hero' },
    h('p', { class: 'home-date' }, `${dateLabel(key)} · 내일은 ${tomorrowProduct.name}`),
    // This week at a glance; tapping explains 휴장일 (streak freezes).
    weekStripButton(save.streakState(key), key, openRecords),
    h('h1', { class: 'home-title' }, played ? '오늘 차트는 끝났어요' : `오늘은 ${iEyo(product.name)}`),
    h(
      'p',
      { class: 'home-lede' },
      played
        ? `내일 0시에 ${tomorrowProduct.name} 차트가 열려요.`
        : `${product.pitch} 모두가 같은 차트로 40초, 하루 한 번이에요.`,
    ),
  )

  const cleanups: Array<() => void> = []
  const body = played ? playedCard(market, played, day, streak) : teaser(market, product.name, cleanups)

  // The very first press runs the guided tutorial round instead, so nobody
  // spends the irreversible daily chart learning the controls (ui/gate.ts).
  const onStart = () => withIntro(go, () => startDaily(go, key))
  const onPractice = () => withIntro(go, () => showProductSheet(go))

  const actions = h(
    'div',
    { class: 'home-actions' },
    played
      ? h('button', { class: 'btn btn-primary', onclick: onPractice }, '연습 한 판')
      : h('button', { class: 'btn btn-primary', onclick: onStart }, '시작하기'),
    // After the tutorial, until the first daily: the next one is the real thing (ux2 P1-7).
    firstLaunch && seen ? h('p', { class: 'home-handoff' }, '연습 끝! 이제 오늘의 차트는 하루 한 번만 할 수 있어요.') : null,
    played || !seen ? null : h('button', { class: 'btn btn-text', onclick: onPractice }, '연습부터 해볼게요'),
  )

  // The season account, with the market ghost to beat. Opens the records
  // screen (calendar, past seasons, replays, long mode).
  const season = save.seasonSummary(key)
  const seasonRow = h(
    'button',
    { class: 'list-row', onclick: openRecords },
    h(
      'span',
      { class: 'list-label' },
      `${seasonLabel(key)} 계좌`,
      h(
        'small',
        { class: 'num' },
        season.days ? `시장 ${formatPct(season.market)} · ${seasonDaysLeft(key)}일 남음` : `${seasonDaysLeft(key)}일 남음`,
      ),
    ),
    h(
      'span',
      { class: 'list-value num' },
      h(
        'span',
        null,
        formatWon(season.account),
        h('small', { class: direction(season.accountReturn) }, formatPct(season.accountReturn)),
      ),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'),
    ),
  )

  // A closed month, until the player opens or dismisses it. In the page, not
  // a sheet: nothing pops up on entry.
  const recap = pendingRecap()
  const recapEl = recap
    ? recapCard(recap, {
        onOpen: () => {
          markSeasonsSeen(save.pastSeasons().map((p) => p.season))
          openRecords()
        },
        // The unplayed home hides the season row while the recap shows.
        onDismiss: () => {
          if (!seasonRow.isConnected && list) list.prepend(seasonRow)
        },
      })
    : null
  // ux2 P2-5: say that a new account started.
  recapEl
    ?.querySelector('.recap-card-body')
    ?.append(h('span', { class: 'habit-line' }, `${seasonLabel(key)} 계좌는 ${virtualWon(SEASON_START)}에서 새로 시작해요.`))

  const habitsRow = () =>
    h(
      'button',
      { class: 'list-row', onclick: () => go({ name: 'habits' }) },
      h(
        'span',
        { class: 'list-label' },
        '내 매매 습관',
        h('small', null, profile ? `최근 ${profile.rounds}판 기준` : '판이 쌓이면 내 성향이 나와요'),
      ),
      h(
        'span',
        { class: 'list-value' },
        profile ? TYPES[profile.type].name : `${Math.max(1, PROFILE_MIN_ROUNDS - history.length)}판 더 하면 나와요`,
        h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'),
      ),
    )

  const list = firstLaunch
    ? null
    : h(
        'section',
        { class: 'list' },
        // One screen tall before the daily: the recap takes the season row's slot.
        played || !recapEl ? seasonRow : null,
        // This week's challenge rule and progress, one line.
        weeklyRow(openRecords),
        // Played: habits and the mission are one row (the chip opens habits).
        played ? (missionChip(() => go({ name: 'habits' })) ?? habitsRow()) : habitsRow(),
      )

  // Back from the daily without opening the friend's challenge: it still waits here.
  const pending = played ? pendingChallengeCard(go) : null

  // Background timers freeze, so also check when the app comes back.
  const checkDate = () => {
    if (!document.hidden && dateKey() !== key) go({ name: 'home' })
  }
  const dateTimer = window.setInterval(checkDate, 1000)
  document.addEventListener('visibilitychange', checkDate)
  window.addEventListener('focus', checkDate)
  window.addEventListener('pageshow', checkDate)
  // Another tab played or changed the save: draw home again (QA #14).
  let redraw = 0
  const unsubscribe = save.onChange(() => {
    clearTimeout(redraw)
    redraw = window.setTimeout(() => {
      if (el.isConnected) go({ name: 'home' })
    }, 0)
  })
  cleanups.push(() => {
    clearInterval(dateTimer)
    clearTimeout(redraw)
    unsubscribe()
    document.removeEventListener('visibilitychange', checkDate)
    window.removeEventListener('focus', checkDate)
    window.removeEventListener('pageshow', checkDate)
  })

  // Fixed to one screen only while the shrinkable chart card is showing, and
  // never with the recap card in it (it squeezed the chart to nothing, QA #15).
  const cls = played || recapEl ? 'screen' : `screen home${firstLaunch ? ' home-first' : ''}`
  // With the recap scrolling the unplayed home, 시작하기 comes right after the chart.
  const ctaFirst = !played && !!recapEl
  const el = h(
    'main',
    { class: cls },
    top,
    hero,
    body,
    pending,
    ctaFirst ? actions : null,
    recapEl,
    list,
    ctaFirst ? null : actions,
    storageWarning(),
  )
  return {
    el,
    destroy: () =>
      cleanups.forEach((f) => {
        try {
          f()
        } catch (err) {
          logError(err, 'home cleanup')
        }
      }),
  }
}

function teaser(market: Market, productName: string, cleanups: Array<() => void>) {
  const canvas = h('canvas', { role: 'img', 'aria-label': '오늘 차트의 지금까지의 흐름' })
  const open = market.prices[0]
  const now = market.prices[market.historyTicks]
  const change = now / open - 1
  const card = h(
    'section',
    { class: 'teaser' },
    h('div', { class: 'teaser-head' }, h('span', null, `오늘의 ${productName} · 이름은 비공개`), h('span', null, '지금까지의 흐름')),
    h(
      'div',
      { class: 'quote' },
      h('span', { class: 'quote-price num' }, `${formatPrice(now)}원`),
      h('span', { class: `quote-change num ${direction(change)}` }, formatPct(change)),
    ),
    canvas,
    h('p', { class: 'teaser-foot' }, '이름은 끝나고 공개돼요. 등장하는 상품과 뉴스는 모두 가상이에요.'),
  )
  const chart = new Chart(canvas, market, { top: 8, right: 8, bottom: 8, left: 0 })
  const draw = () =>
    chart.draw(
      {
        from: 0,
        to: market.historyTicks + 3 * market.ticksPerDay,
        head: market.historyTicks,
        held: [],
        holdingNow: false,
        marks: [],
        showHeadTag: false,
      },
      false,
    )
  requestAnimationFrame(draw)
  window.addEventListener('resize', draw)
  cleanups.push(() => {
    window.removeEventListener('resize', draw)
    chart.destroy()
  })
  return card
}

/**
 * Today's finished chart. The hero is the edge over simply holding, in plain
 * words; the raw returns are the small line (ux2 P1-1). No countdown: the
 * lede already says when the next chart opens (P2-6).
 */
function playedCard(market: Market, saved: SavedDaily, day: number, streak: number) {
  const abandoned = !!saved.abandoned
  return h(
    'section',
    { class: 'played' },
    h('p', { class: 'played-kicker' }, `${abandoned ? '중간에 끝낸 차트' : saved.title} · ${market.company.name}`),
    h('p', { class: 'played-edge num' }, edgeWords(saved.yourReturn, saved.buyHoldReturn)),
    h(
      'p',
      { class: 'played-sub num' },
      `나 ${formatPct(saved.yourReturn, 1)} · 그냥 들고 있기 ${formatPct(saved.buyHoldReturn, 1)}`,
    ),
    squaresFor(market, saved.held),
    squaresLegend(),
    // A round that never finished isn't a result to share (QA #12).
    abandoned
      ? h('p', { class: 'fine' }, '중간에 나가서 마지막으로 저장된 결과예요.')
      : h(
          'button',
          {
            class: 'btn btn-quiet played-share',
            onclick: () =>
              shareResult({ market, yourReturn: saved.yourReturn, buyHoldReturn: saved.buyHoldReturn, held: saved.held, day, streak }).catch(
                (err) => logError(err, 'shareResult'),
              ),
          },
          '결과 공유하기',
        ),
  )
}
