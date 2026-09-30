import { dateKey, dayNumber, dailySeed, msUntilNextDay } from '../core/daily'
import { direction, formatCountdown, formatPct, formatPrice } from '../core/format'
import { generateMarket, HISTORY_TICKS, PLAY_TICKS, playPrice, type Market } from '../core/market'
import { save, type SavedDaily } from '../core/storage'
import { hashString } from '../core/rng'
import type { Navigate, Screen } from './app'
import { Chart } from './chart'
import { h } from './dom'
import { showIntro } from './intro'
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
  const market = generateMarket(dailySeed(key))
  const played = save.daily(key)
  const streak = save.streak(key)
  const stats = save.dailyStats()

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
      played ? '오늘 차트는 끝났어요' : '오늘의 차트가 열렸어요',
    ),
    h(
      'p',
      { class: 'home-lede' },
      played ? '내일 0시에 새 차트가 올라와요.' : '모두가 같은 차트로 40초를 겨뤄요. 한 번뿐이에요.',
    ),
  )

  const cleanups: Array<() => void> = []
  const body = played ? playedCard(market, played, key, day, cleanups) : teaser(market, cleanups)

  // Rules show once, right before the first round, when they matter.
  const withIntro = (start: () => void) => () => {
    if (save.seenIntro()) return start()
    showIntro(() => {
      save.markIntroSeen()
      start()
    })
  }

  const startDaily = withIntro(() => go({ name: 'play', mode: { kind: 'daily', key, day }, market }))

  const startPractice = withIntro(() => {
    const seed = hashString(`practice/${Date.now()}/${Math.random()}`)
    go({ name: 'play', mode: { kind: 'practice' }, market: generateMarket(seed) })
  })

  const actions = h(
    'div',
    { class: 'home-actions' },
    played
      ? h('button', { class: 'btn btn-primary', onclick: startPractice }, '연습 한 판')
      : h('button', { class: 'btn btn-primary', onclick: startDaily }, '시작하기'),
    played ? null : h('button', { class: 'btn btn-text', onclick: startPractice }, '연습부터 해볼게요'),
  )

  const statRow = stats
    ? h(
        'div',
        { class: 'stats' },
        stat('참여', `${stats.played}일`),
        stat('시장을 이긴 날', `${stats.beat}일`),
        stat('평균 수익률', formatPct(stats.avg, 1), direction(stats.avg)),
      )
    : null

  const el = h('main', { class: 'screen' }, top, hero, body, statRow, actions)
  return { el, destroy: () => cleanups.forEach((f) => f()) }
}

function stat(label: string, value: string, tone?: string) {
  return h(
    'div',
    { class: 'stat' },
    h('div', { class: 'stat-label' }, label),
    h('div', { class: `stat-value num ${tone ?? ''}` }, value),
  )
}

function teaser(market: Market, cleanups: Array<() => void>) {
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
      h('span', null, '비공개 종목'),
      h('span', null, '시작 전 12초'),
    ),
    h(
      'div',
      { class: 'quote' },
      h('span', { class: 'quote-price num' }, `${formatPrice(now)}원`),
      h('span', { class: `quote-change num ${direction(change)}` }, formatPct(change)),
    ),
    canvas,
    h('p', { class: 'teaser-foot' }, '종목 이름은 끝나고 공개돼요. 등장하는 회사와 뉴스는 모두 가상이에요.'),
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
