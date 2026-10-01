import { formatPct, formatWon, formatWonDelta, direction } from '../core/format'
import { HISTORY_TICKS, PLAY_TICKS, playPrice, ROUND_SECONDS, TICKS_PER_SECOND, type Market } from '../core/market'
import { save } from '../core/storage'
import { analyzeRound } from '../core/habits'
import { advanceTo, createRound, isOver, setHolding, START_EQUITY, summarize } from '../core/round'
import type { Mode, Navigate, Screen } from './app'
import { Chart } from './chart'
import { h, haptic, icons, svg } from './dom'
import { confirmSheet } from './sheet'

const TICK_MS = 1000 / TICKS_PER_SECOND
const WINDOW_TICKS = 200
const COUNTDOWN_MS = 2400

export function playScreen(go: Navigate, mode: Mode, market: Market): Screen {
  // Daily rounds trade the season account; practice always starts fresh.
  const round = createRound(market, mode.kind === 'daily' ? save.accountBefore(mode.key) : START_EQUITY)

  const clock = h('span', { class: 'play-clock num' }, `0:${ROUND_SECONDS}`)
  const equity = h('div', { class: 'equity num' }, formatWon(round.startEquity))
  const delta = h('div', { class: 'equity-delta num flat' }, '0원 (0.00%)')
  const canvas = h('canvas')
  const countdown = h('div', { class: 'countdown num', 'aria-live': 'assertive' })
  const newsTag = h('span', { class: 'news-tag' })
  const newsText = h('span')
  const news = h('div', { class: 'news', role: 'status', 'aria-live': 'polite' }, newsTag, newsText)
  const padMain = h('span', { class: 'pad-main' }, '잠시만요')
  const padSub = h('span', { class: 'pad-sub num' }, '곧 시작해요')
  const pad = h(
    'div',
    { class: 'pad idle', role: 'button', 'aria-label': '누르고 있는 동안 보유', tabindex: 0 },
    padMain,
    padSub,
  )

  const quit = () => {
    if (phase === 'done') return
    if (mode.kind === 'practice' || phase === 'countdown') {
      go({ name: 'home' })
      return
    }
    const resumeFrom = phase
    phase = 'paused'
    pausedAt = performance.now()
    pressing = 0
    if (round.holding) setHolding(round, false)
    renderPad()
    confirmSheet({
      title: '오늘 차트를 여기서 끝낼까요?',
      body: '지금까지의 수익률로 기록되고, 오늘은 다시 할 수 없어요.',
      confirm: '여기서 끝내기',
      cancel: '계속하기',
      onConfirm: finish,
      onCancel: () => {
        if (resumeFrom === 'live') {
          startedAt += performance.now() - pausedAt
          phase = 'live'
          renderPad()
        }
      },
    })
  }

  const el = h(
    'main',
    { class: 'play' },
    h(
      'div',
      { class: 'play-top' },
      h(
        'div',
        { class: 'topbar' },
        h('button', { class: 'icon-btn', 'aria-label': '나가기', onclick: quit }, svg(icons.close)),
        clock,
      ),
      h('p', { class: 'equity-label' }, mode.kind === 'daily' ? `오늘의 차트 #${mode.day}` : '연습 모드'),
      equity,
      delta,
    ),
    h('div', { class: 'chart-wrap' }, canvas, news, countdown),
    pad,
  )

  const chart = new Chart(canvas, market)
  const marks = market.news.map((n) => HISTORY_TICKS + n.at)

  let phase: 'countdown' | 'live' | 'paused' | 'done' = 'countdown'
  let startedAt = 0
  let pausedAt = 0
  let raf = 0
  let pressing = 0
  const createdAt = performance.now()

  const renderPad = () => {
    const holding = round.holding
    pad.classList.toggle('on', holding)
    pad.classList.toggle('idle', phase !== 'live')
    if (phase === 'countdown') return
    if (holding) {
      const trade = round.equity / round.entryEquity - 1
      padMain.textContent = '보유 중'
      padSub.textContent = `이번 매매 ${formatPct(trade)}`
      padSub.className = `pad-sub num ${direction(trade)}`
    } else {
      padMain.textContent = '누르고 있으면 사요'
      padSub.textContent = '떼면 바로 팔아요'
      padSub.className = 'pad-sub'
    }
  }

  const press = (on: boolean) => {
    if (phase !== 'live') return
    if (on === round.holding) return
    setHolding(round, on)
    haptic(on ? 10 : 6)
    renderPad()
  }

  const onDown = (e: PointerEvent) => {
    e.preventDefault()
    pad.setPointerCapture?.(e.pointerId)
    pressing++
    press(true)
  }
  const onUp = () => {
    pressing = Math.max(0, pressing - 1)
    if (pressing === 0) press(false)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Space' && e.code !== 'Enter') return
    e.preventDefault()
    if (e.repeat) return
    press(e.type === 'keydown')
  }
  const onVisibility = () => {
    if (document.hidden && phase === 'live') {
      phase = 'paused'
      pausedAt = performance.now()
      pressing = 0
      press(false)
    } else if (!document.hidden && phase === 'paused') {
      startedAt += performance.now() - pausedAt
      phase = 'live'
    }
  }

  pad.addEventListener('pointerdown', onDown)
  pad.addEventListener('pointerup', onUp)
  pad.addEventListener('pointercancel', onUp)
  pad.addEventListener('contextmenu', (e) => e.preventDefault())
  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKey)
  document.addEventListener('visibilitychange', onVisibility)

  let shownNews = -1
  const updateNews = (tick: number) => {
    const idx = market.news.findIndex((n) => tick >= n.at && tick < n.impactAt + 24)
    if (idx === shownNews) return
    shownNews = idx
    if (idx < 0) {
      news.classList.remove('show')
      return
    }
    const n = market.news[idx]
    newsTag.textContent = n.kind === 'filing' ? '공시' : '지라시'
    newsTag.className = `news-tag ${n.kind}`
    newsText.textContent = n.blindHeadline
    news.classList.add('show')
    haptic(4)
  }

  const renderNumbers = () => {
    const diff = round.equity - round.startEquity
    const ratio = round.equity / round.startEquity - 1
    const tone = direction(diff)
    equity.textContent = formatWon(round.equity)
    delta.textContent = `${formatWonDelta(diff)} (${formatPct(ratio)})`
    delta.className = `equity-delta num ${tone}`
  }

  const finish = () => {
    if (phase === 'done') return
    phase = 'done'
    if (round.holding) setHolding(round, false)
    advanceTo(round, PLAY_TICKS)
    const result = summarize(round)
    if (mode.kind === 'daily') {
      save.recordDaily(mode.key, {
        yourReturn: result.yourReturn,
        buyHoldReturn: result.buyHoldReturn,
        held: result.held,
        trades: result.trades,
        title: result.grade.title,
      })
    } else {
      save.recordPractice(result.yourReturn)
    }
    const habits = analyzeRound(market, result.held, result.fees)
    if (habits.trades > 0) {
      save.recordHabits(mode.kind === 'daily' ? `d:${mode.key}` : `p:${Date.now()}`, habits.scores)
    }
    go({ name: 'result', mode, market, result })
  }

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame)

    if (phase === 'countdown') {
      const left = COUNTDOWN_MS - (now - createdAt)
      if (left <= 0) {
        phase = 'live'
        startedAt = now
        countdown.textContent = ''
        if (mode.kind === 'daily') {
          save.startDaily(mode.key, playPrice(market, PLAY_TICKS) / playPrice(market, 0) - 1)
        }
        renderPad()
      } else {
        countdown.textContent = String(Math.ceil(left / (COUNTDOWN_MS / 3)))
      }
    }

    let playHead = 0
    if (phase === 'live') {
      const elapsed = now - startedAt
      playHead = Math.min(elapsed / TICK_MS, PLAY_TICKS)
      advanceTo(round, Math.floor(playHead))
      updateNews(Math.floor(playHead))
      const secsLeft = Math.max(0, Math.ceil(ROUND_SECONDS - elapsed / 1000))
      clock.textContent = `0:${String(secsLeft).padStart(2, '0')}`
      clock.classList.toggle('hurry', secsLeft <= 5)
      renderNumbers()
      if (round.holding) renderPad()
      if (isOver(round)) {
        finish()
        return
      }
    } else if (phase === 'paused') {
      playHead = round.tick
    }

    const head = HISTORY_TICKS + playHead
    const from = Math.max(0, head - WINDOW_TICKS * 0.82)
    chart.draw({
      from,
      to: from + WINDOW_TICKS,
      head,
      held: round.held,
      holdingNow: round.holding,
      marks,
      showHeadTag: true,
    })
  }
  raf = requestAnimationFrame(frame)

  return {
    el,
    destroy() {
      cancelAnimationFrame(raf)
      chart.destroy()
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
      document.removeEventListener('visibilitychange', onVisibility)
    },
  }
}
