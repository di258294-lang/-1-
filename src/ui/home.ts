import { dateKey, dayNumber, dailySeed, msUntilNextDay, nextKey } from '../core/daily'
import { dailyProduct, PRODUCTS, WEEKDAY_NAMES } from '../core/products'
import { direction, formatCountdown, formatPct, formatPrice, formatWon, iEyo } from '../core/format'
import { PROFILE_MIN_ROUNDS, profileFrom, TYPES } from '../core/habits'
import { SEASON_START, seasonDaysLeft, seasonLabel } from '../core/season'
import { generateMarket, HISTORY_TICKS, PLAY_TICKS, playPrice, type Market } from '../core/market'
import { save, type SavedDaily } from '../core/storage'
import type { Navigate, Screen } from './app'
import { Chart } from './chart'
import { h } from './dom'
import { showIntro } from './intro'
import { showProductSheet } from './products'
import { shareResult } from './share'

const weekday = ['일', '월', '화', '수', '목', '금', '토']

function dateLabel(key: string) {
  const [, m, d] = key.split('-').map(Number)
  const wd = weekday[new Date(`${key}T00:00:00Z`).getUTCDay()]
  return `${m}월 ${d}일 ${wd}요일`
}

function squaresFor(market: Market, held: boolean[]) {
  const row = h('div', { class: 'squares', 'aria-hidden': 'true' })
  const per = PLAY_TICKS / 10
  for (let i = 0; i < 10; i++) {
    const from = Math.round(i * per)
    const to = Math.round((i + 1) * per)
    let n = 0
    for (let t = from; t < to; t++) if (held[t]) n++
    const cls = n * 2 < to - from ? '' : playPrice(market, to) >= playPrice(market, from) ? 'u' : 'd'
    row.append(h('i', { class: cls }))
  }
  return row
}

export function homeScreen(go: Navigate): Screen {
  const key = dateKey()
  const day = dayNumber(key)
  const played = save.daily(key)
  // A finished day keeps the product it was played with.
  const productKey = played?.product ?? dailyProduct(key)
  const product = PRODUCTS[productKey]
  const market = generateMarket(dailySeed(key), productKey)
  const tomorrow = nextKey(key)
  const tomorrowProduct = PRODUCTS[dailyProduct(tomorrow)]
  const streak = save.streak(key)
  const history = save.habitHistory()
  const profile = profileFrom(history)

  const top = h(
    'div',
    { class: 'topbar' },
    h('span', { class: 'wordmark' }, 'HOLD'),
    streak > 0 ? h('span', { class: 'home-streak' }, h('b', { class: 'num' }, `${streak}일`), ' 연속') : null,
  )

  const hero = h(
    'div',
    { class: 'home-hero' },
    h('p', { class: 'home-date' }, `${dateLabel(key)} · ${day}번째 차트`),
    h(
      'h1',
      { class: 'home-title' },
      played ? '오늘 차트는 끝났어요' : `오늘은 ${iEyo(product.name)}`,
    ),
    h(
      'p',
      { class: 'home-lede' },
      played
        ? `내일 0시에 ${tomorrowProduct.name} 차트가 열려요.`
        : `${product.pitch} 모두가 같은 차트로 40초, 하루 한 번이에요.`,
    ),
  )

  const cleanups: Array<() => void> = []
  const body = played ? playedCard(market, played, key, day, cleanups) : teaser(market, product.name, cleanups)

  // Rules show once, right before the first round, when they matter.
  const withIntro = (start: () => void) => () => {
    if (save.seenIntro()) return start()
    showIntro(() => {
      save.markIntroSeen()
      start()
    })
  }

  const startDaily = withIntro(() => go({ name: 'play', mode: { kind: 'daily', key, day }, market }))

  const startPractice = withIntro(() => showProductSheet(go))

  const actions = h(
    'div',
    { class: 'home-actions' },
    played
      ? h('button', { class: 'btn btn-primary', onclick: startPractice }, '연습 한 판')
      : h('button', { class: 'btn btn-primary', onclick: startDaily }, '시작하기'),
    played ? null : h('button', { class: 'btn btn-text', onclick: startPractice }, '연습부터 해볼게요'),
  )

  const account = save.accountAfter(key)
  const seasonReturn = account / SEASON_START - 1
  const list = h(
    'section',
    { class: 'list' },
    h(
      'div',
      { class: 'list-row' },
      h('span', { class: 'list-label' }, `${seasonLabel(key)} 계좌`, h('small', null, `시즌 끝까지 ${seasonDaysLeft(key)}일`)),
      h(
        'span',
        { class: 'list-value num' },
        h('span', null, formatWon(account), h('small', { class: direction(seasonReturn) }, formatPct(seasonReturn))),
      ),
    ),
    h(
      'button',
      { class: 'list-row', onclick: () => withIntro(() => showProductSheet(go))() },
      h('span', { class: 'list-label' }, '내일의 차트', h('small', null, '요일마다 상품이 바뀌어요')),
      h(
        'span',
        { class: 'list-value' },
        `${WEEKDAY_NAMES[new Date(`${tomorrow}T00:00:00Z`).getUTCDay()]} · ${tomorrowProduct.name}`,
        h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'),
      ),
    ),
    h(
      'button',
      { class: 'list-row', onclick: () => go({ name: 'habits' }) },
      h(
        'span',
        { class: 'list-label' },
        '내 매매 습관',
        h('small', null, profile ? `최근 ${profile.rounds}판 기준` : `${PROFILE_MIN_ROUNDS}판 하면 성향이 나와요`),
      ),
      h(
        'span',
        { class: 'list-value' },
        profile
          ? TYPES[profile.type].name
          : h('span', { class: 'num' }, `${Math.min(history.length, PROFILE_MIN_ROUNDS)}/${PROFILE_MIN_ROUNDS}판`),
        h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'),
      ),
    ),
  )

  // Fixed to one screen only while the shrinkable chart card is showing.
  const el = h('main', { class: played ? 'screen' : 'screen home' }, top, hero, body, list, actions)
  return { el, destroy: () => cleanups.forEach((f) => f()) }
}

function teaser(market: Market, productName: string, cleanups: Array<() => void>) {
  const canvas = h('canvas', { 'aria-label': '오늘 차트의 시작 전 흐름' })
  const open = market.prices[0]
  const now = market.prices[HISTORY_TICKS]
  const change = now / open - 1
  const card = h(
    'section',
    { class: 'teaser' },
    h(
      'div',
      { class: 'teaser-head' },
      h('span', null, `오늘의 ${productName} · 이름은 비공개`),
      h('span', null, '시작 전 12초'),
    ),
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
      { from: 0, to: HISTORY_TICKS + 60, head: HISTORY_TICKS, held: [], holdingNow: false, marks: [], showHeadTag: false },
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

function playedCard(market: Market, saved: SavedDaily, key: string, day: number, cleanups: Array<() => void>) {
  const tone = direction(saved.yourReturn)
  const next = h('p', { class: 'next-in num' })
  const tick = () => {
    next.textContent = `다음 차트까지 ${formatCountdown(msUntilNextDay())}`
    if (msUntilNextDay() < 1000) setTimeout(() => location.reload(), 1200)
  }
  tick()
  const timer = window.setInterval(tick, 1000)
  cleanups.push(() => clearInterval(timer))

  return h(
    'section',
    { class: 'played' },
    h('p', { class: 'played-kicker' }, `${saved.title} · ${market.company.name}`),
    h('p', { class: `played-value num ${tone}` }, formatPct(saved.yourReturn, 1)),
    h('p', { class: 'played-sub num' }, `그냥 들고 있었으면 ${formatPct(saved.buyHoldReturn, 1)}`),
    squaresFor(market, saved.held),
    h(
      'button',
      {
        class: 'btn btn-quiet',
        style: 'margin-top:18px',
        onclick: () => shareResult({ market, yourReturn: saved.yourReturn, buyHoldReturn: saved.buyHoldReturn, held: saved.held, day, key }),
      },
      '결과 공유하기',
    ),
    next,
  )
}
