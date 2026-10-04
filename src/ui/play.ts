import { newsKindLabel, newsToneLabel } from '../core/copy'
import { formatPct, formatWon, formatWonDelta, direction } from '../core/format'
import { analyzeRound, type RoundHabits } from '../core/habits'
import { calendarLabel, dayOf, playPrice, TICKS_PER_SECOND, type Market } from '../core/market'
import { PRODUCTS } from '../core/products'
import { completeRound } from '../core/session'
import { save } from '../core/storage'
import { advanceTo, createRound, isOver, setHolding, START_EQUITY, summarize } from '../core/round'
import { Coach, NEWS_SHOW_AFTER } from '../core/tutorial'
import { announce } from './announce'
import type { Mode, Navigate, Screen } from './app'
import { sfx, unlockAudio } from './audio'
import { Chart } from './chart'
import { h, haptic, icons, svg, toast } from './dom'
import { logError } from './errors'
import { DISCLAIMER } from './intro'
import { anySheetOpen, confirmSheet } from './sheet'
import { isTutorial } from './tutorial'
import { isChallenge } from './challenge'

const TICK_MS = 1000 / TICKS_PER_SECOND
/** Trading days visible on the live chart. */
const WINDOW_DAYS = { short: 10, long: 15 }
const COUNTDOWN_MS = 2400
/** After any pause, a short count before time runs again, so pausing can't be used to study the chart. */
const RESUME_MS = 1000
/** How often a live daily round saves its progress, in play time. */
const CHECKPOINT_MS = 1000

/** Why the round is stopped. Time runs only while there are none. */
type PauseReason = 'hidden' | 'blur' | 'sheet'
/** A pointer id, or a keyboard key code. Holding means at least one is down. */
type Input = number | string

const clockText = (secs: number) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`

const isPadKey = (e: KeyboardEvent) => e.code === 'Space' || e.code === 'Enter' || e.key === ' ' || e.key === 'Enter'

export function playScreen(go: Navigate, mode: Mode, market: Market): Screen {
  // Daily rounds trade the season account; practice always starts fresh.
  const product = PRODUCTS[market.product]
  const round = createRound(market, mode.kind === 'daily' ? save.accountBefore(mode.key) : START_EQUITY)

  const isLong = market.length === 'long'
  /** The first-launch guided round: coach lines, nothing recorded. */
  const tutorial = isTutorial(market)
  /** One tap buys, the next sells (settings). held[] means the same either way. */
  let tapToggle = false
  try {
    tapToggle = save.getSettings().tapToggle
  } catch {
    // Default controls.
  }
  const coach = tutorial ? new Coach(market, tapToggle) : null
  // From the market itself: the tutorial is a shortened short round.
  const roundSeconds = Math.round(market.playTicks / TICKS_PER_SECOND)
  const playTicks = market.playTicks
  const historyTicks = market.historyTicks
  const windowTicks = WINDOW_DAYS[market.length] * market.ticksPerDay
  const clock = h('span', { class: 'play-clock num' }, clockText(roundSeconds))
  const dateTag = isLong ? h('span', { class: 'play-date num' }, calendarLabel(0)) : null
  const equity = h('div', { class: 'equity num' }, formatWon(round.startEquity))
  const delta = h('div', { class: 'equity-delta num flat' }, '0원 (0.00%)')
  const canvas = h('canvas')
  const countdown = h('div', { class: 'countdown num', 'aria-live': 'assertive' })
  // News banner: what kind of news, whether it sounds good or bad for the
  // price (what it implies, not what happens), the headline, and in the
  // tutorial a coach line. With no headline the coach line stands alone.
  const newsTag = h('span', { class: 'news-tag' })
  const toneTag = h('span', { class: 'news-tone' })
  const newsText = h('span', { class: 'news-text' })
  const coachText = h('span', { class: 'news-coach' })
  const news = h(
    'div',
    { class: 'news', role: 'status', 'aria-live': 'polite' },
    h('span', { class: 'news-tags' }, newsTag, toneTag),
    h('span', { class: 'news-body' }, newsText, coachText),
  )
  const padMain = h('span', { class: 'pad-main' }, '잠시만요')
  const padSub = h('span', { class: 'pad-sub num' }, '곧 시작해요')
  const pad = h(
    'div',
    {
      class: 'pad idle',
      role: 'button',
      'aria-label': tapToggle ? '톡 치면 사고, 한 번 더 치면 팔기' : '누르고 있는 동안 보유',
      'aria-pressed': 'false',
      tabindex: 0,
    },
    padMain,
    padSub,
  )

  let phase: 'countdown' | 'live' | 'done' = 'countdown'
  const pauses = new Set<PauseReason>()
  let countdownLeft = COUNTDOWN_MS
  let resumeLeft = 0
  /** Milliseconds of live play so far. Only grows while running. */
  let elapsed = 0
  let lastNow: number | null = null
  let lastCheckpoint = 0
  let raf = 0
  const inputs = new Set<Input>()
  /** Screen-reader activation, and tap-to-toggle, hold without an input down. */
  let latched = false
  /** When the current press began, to spot taps too short to hold anything. */
  let pressedAt = 0
  let lastSecsLeft = roundSeconds

  const running = () => phase === 'live' && pauses.size === 0 && resumeLeft <= 0

  const renderPad = () => {
    const holding = round.holding
    pad.classList.toggle('on', holding)
    pad.classList.toggle('idle', !running())
    pad.setAttribute('aria-pressed', String(holding))
    if (phase === 'countdown') {
      if (tapToggle) padSub.textContent = latched ? '시작과 함께 사요' : '톡 치면 시작과 함께 사요'
      return
    }
    if (holding) {
      const trade = round.equity / round.entryEquity - 1
      padMain.textContent = '보유 중'
      padSub.textContent = `이번 매매 ${formatPct(trade)}`
      padSub.className = `pad-sub num ${direction(trade)}`
    } else if (pauses.size > 0) {
      padMain.textContent = '잠시 멈췄어요'
      padSub.textContent = '돌아오면 이어서 해요'
      padSub.className = 'pad-sub'
    } else if (resumeLeft > 0) {
      padMain.textContent = '곧 다시 시작해요'
      if (tapToggle) padSub.textContent = latched ? '시작과 함께 사요' : '톡 치면 시작과 함께 사요'
      else padSub.textContent = '누르고 있으면 시작과 함께 사요'
      padSub.className = 'pad-sub'
    } else {
      padMain.textContent = tapToggle ? '톡 치면 사요' : '누르고 있으면 사요'
      padSub.textContent = tapToggle ? '한 번 더 치면 팔아요' : '떼면 바로 팔아요'
      padSub.className = 'pad-sub'
    }
  }

  /**
   * Opens or closes the position with feedback. No phase checks. `byPlayer`
   * is false for the forced sell when the round pauses.
   */
  const trade = (on: boolean, byPlayer = true) => {
    if (on === round.holding) return
    setHolding(round, on)
    if (round.holding !== on) return
    haptic(on ? 10 : 6)
    if (on) sfx.buy()
    else sfx.sell()
    if (coach && byPlayer) {
      if (on) coach.buy()
      else coach.sell(round.tick, performance.now() - pressedAt)
    }
    announce(on ? '샀어요' : `팔았어요, 이번 매매 ${formatPct(round.equity / round.entryEquity - 1, 1)}`)
    renderPad()
  }

  /** Holding follows the inputs, but only while time is running. */
  const sync = () => {
    if (running()) trade(inputs.size > 0 || latched)
  }

  /** A finger or key went down on the pad. */
  const press = (input: Input) => {
    unlockAudio()
    if (tapToggle) {
      // Each tap flips what the player wants; time decides when it happens.
      pressedAt = performance.now()
      latched = !latched
      if (!running()) renderPad()
      sync()
      return
    }
    if (inputs.size === 0) pressedAt = performance.now()
    latched = false
    inputs.add(input)
    sync()
  }

  const checkpoint = () => {
    if (mode.kind !== 'daily' || phase !== 'live') return
    lastCheckpoint = elapsed
    // What the round is worth if it ended now, closing fee included.
    const closing = round.holding ? 1 - market.feeRate : 1
    try {
      save.progressDaily(mode.key, {
        yourReturn: (round.equity * closing) / round.startEquity - 1,
        held: [...round.held],
      })
    } catch (err) {
      logError(err, 'progressDaily')
    }
  }

  const pause = (reason: PauseReason) => {
    if (phase === 'done') return
    // Nobody can let go of a pad they can't see: sell first, then stop time.
    inputs.clear()
    latched = false
    trade(false, false)
    pauses.add(reason)
    lastNow = null
    countdown.textContent = ''
    checkpoint()
    renderPad()
  }

  const unpause = (reason: PauseReason) => {
    if (!pauses.delete(reason) || pauses.size > 0 || phase === 'done') return
    lastNow = null
    if (phase === 'live') resumeLeft = RESUME_MS
    renderPad()
  }

  /** The result without saving it: the tutorial, or when saving failed. */
  const unsavedResult = (): Parameters<Navigate>[0] => {
    if (round.holding) setHolding(round, false)
    advanceTo(round, playTicks)
    const result = summarize(round)
    let habits: RoundHabits | undefined
    try {
      habits = analyzeRound(market, result.held, result.fees)
    } catch (e) {
      logError(e, 'analyzeRound')
    }
    return { name: 'result', mode, market, result, habits, record: null, unlocked: [] }
  }

  const finish = () => {
    if (phase === 'done') return
    phase = 'done'
    cancelAnimationFrame(raf)
    inputs.clear()
    // The same tone for every result: no win jingle.
    sfx.end()
    let route: Parameters<Navigate>[0]
    if (tutorial) {
      // A coached round is a lesson, not a record: it never enters the
      // practice stats, unlocks or habit history. It does replace the intro.
      try {
        save.markIntroSeen()
      } catch (err) {
        logError(err, 'markIntroSeen')
      }
      route = unsavedResult()
    } else if (isChallenge(market)) {
      // A friend's chart: never in practice stats, unlocks or habit history.
      route = unsavedResult()
    } else {
      try {
        route = { name: 'result', mode, market, ...completeRound(mode, market, round) }
      } catch (err) {
        // Saving failed. The player still sees how the round went.
        logError(err, 'completeRound')
        route = unsavedResult()
      }
    }
    go(route)
  }

  const quit = () => {
    if (phase === 'done') return
    if (phase === 'countdown' || (mode.kind === 'practice' && !isLong)) {
      go({ name: 'home' })
      return
    }
    if (pauses.has('sheet')) return
    pause('sheet')
    confirmSheet({
      title: mode.kind === 'daily' ? '오늘 차트를 여기서 끝낼까요?' : '장기 모드를 그만할까요?',
      body:
        mode.kind === 'daily'
          ? '지금 들고 있던 건 팔고, 남은 시간은 현금으로 계산해서 기록해요. 오늘은 다시 할 수 없어요.'
          : '지금까지 한 판은 기록되지 않아요.',
      confirm: mode.kind === 'daily' ? '여기서 끝내기' : '그만하기',
      cancel: '계속하기',
      onConfirm: mode.kind === 'daily' ? finish : () => go({ name: 'home' }),
      onCancel: () => unpause('sheet'),
      // Back on the pad, so Space keeps working as the pad.
      returnFocus: pad,
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
        h('span', { class: 'play-meta' }, dateTag, clock),
      ),
      h(
        'p',
        { class: 'equity-label' },
        `${mode.kind === 'daily' ? `오늘의 차트 #${mode.day}` : tutorial ? '처음 연습' : isChallenge(market) ? '친구 도전' : isLong ? '장기 모드 · 1년' : '연습'} · ${product.name} · 가상 돈`,
      ),
      equity,
      delta,
      tutorial ? h('p', { class: 'play-note' }, DISCLAIMER) : null,
    ),
    h('div', { class: 'chart-wrap' }, canvas, news, countdown),
    pad,
  )

  const chart = new Chart(canvas, market)
  const marks = market.news.map((n) => historyTicks + n.at)

  const onDown = (e: PointerEvent) => {
    if (e.button > 0) return
    e.preventDefault()
    try {
      pad.setPointerCapture?.(e.pointerId)
    } catch {
      // Pointer already gone.
    }
    // A touch means the window has focus again.
    unpause('blur')
    press(e.pointerId)
  }
  const onUp = (e: PointerEvent) => {
    if (inputs.delete(e.pointerId)) sync()
  }
  const onClick = (e: MouseEvent) => {
    // detail 0: activated by a screen reader or switch control, not a finger.
    if (e.detail !== 0 || !running()) return
    latched = !round.holding
    sync()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (!isPadKey(e) || anySheetOpen()) return
    // Space and Enter on the close button (or any control) belong to that control.
    const target = e.target
    if (target !== pad && target instanceof Element && target.closest('button, a, input, textarea, select, [contenteditable]')) return
    e.preventDefault()
    if (e.repeat || inputs.has(e.code)) return
    press(e.code)
  }
  const onKeyUp = (e: KeyboardEvent) => {
    if (!inputs.has(e.code)) return
    e.preventDefault()
    inputs.delete(e.code)
    sync()
  }
  const onVisibility = () => {
    if (document.hidden) {
      pause('hidden')
    } else {
      unpause('hidden')
      if (document.hasFocus()) unpause('blur')
    }
  }
  const onBlur = () => pause('blur')
  const onFocus = () => unpause('blur')
  const onPageHide = () => checkpoint()

  pad.addEventListener('pointerdown', onDown)
  pad.addEventListener('pointerup', onUp)
  pad.addEventListener('pointercancel', onUp)
  pad.addEventListener('lostpointercapture', onUp)
  pad.addEventListener('click', onClick)
  pad.addEventListener('contextmenu', (e) => e.preventDefault())
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  window.addEventListener('focus', onFocus)
  window.addEventListener('pagehide', onPageHide)
  document.addEventListener('visibilitychange', onVisibility)

  let shownNews = -1
  let shownCoach: string | null = null
  const updateNews = (tick: number) => {
    const idx = market.news.findIndex((n) => tick >= n.at && tick < n.impactAt + NEWS_SHOW_AFTER)
    const line = coach ? coach.line(tick, round.holding) : null
    if (idx === shownNews && line === shownCoach) return
    const fresh = idx !== shownNews
    shownNews = idx
    shownCoach = line
    if (idx < 0 && !line) {
      news.classList.remove('show')
      return
    }
    if (idx < 0) {
      // A coach line on its own.
      news.classList.add('coach-only')
      newsText.textContent = line
      coachText.textContent = ''
    } else {
      const n = market.news[idx]
      news.classList.remove('coach-only')
      newsTag.textContent = newsKindLabel(market.product, n.kind)
      newsTag.className = `news-tag ${n.kind}`
      toneTag.textContent = newsToneLabel(n)
      toneTag.className = `news-tone ${n.implied > 0 ? 'up' : 'down'}`
      newsText.textContent = n.blindHeadline
      coachText.textContent = line ?? ''
      if (fresh) {
        haptic(4)
        sfx.news(n.kind)
      }
    }
    news.classList.add('show')
  }

  const renderNumbers = () => {
    const diff = round.equity - round.startEquity
    const ratio = round.equity / round.startEquity - 1
    const tone = direction(diff)
    equity.textContent = formatWon(round.equity)
    delta.textContent = `${formatWonDelta(diff)} (${formatPct(ratio)})`
    delta.className = `equity-delta num ${tone}`
  }

  /** False when the round was aborted instead. */
  const goLive = (): boolean => {
    if (mode.kind === 'daily') {
      // Another tab, or a stale screen, already played today's chart.
      // startDaily re-reads storage and refuses if any entry exists.
      if (!save.startDaily(mode.key, playPrice(market, playTicks) / playPrice(market, 0) - 1)) {
        phase = 'done'
        toast('오늘 차트는 이미 했어요')
        go({ name: 'home' })
        return false
      }
    }
    phase = 'live'
    countdown.textContent = ''
    renderPad()
    // Holding through the countdown buys at the open.
    sync()
    return true
  }

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame)
    const dt = lastNow === null ? 0 : Math.max(0, now - lastNow)
    lastNow = now

    if (pauses.size === 0) {
      if (phase === 'countdown') {
        countdownLeft -= dt
        if (countdownLeft <= 0) {
          if (!goLive()) return
        } else {
          countdown.textContent = String(Math.ceil(countdownLeft / (COUNTDOWN_MS / 3)))
          if (coach) updateNews(0)
        }
      } else if (phase === 'live' && resumeLeft > 0) {
        resumeLeft -= dt
        if (resumeLeft <= 0) {
          resumeLeft = 0
          countdown.textContent = ''
          renderPad()
          sync()
        } else {
          countdown.textContent = String(Math.ceil(resumeLeft / 1000))
        }
      } else if (phase === 'live') {
        elapsed += dt
      }
    }

    let playHead = 0
    if (phase === 'live') {
      playHead = Math.min(elapsed / TICK_MS, playTicks)
      advanceTo(round, Math.floor(playHead))
      updateNews(Math.floor(playHead))
      const secsLeft = Math.max(0, Math.ceil(roundSeconds - elapsed / 1000))
      clock.textContent = clockText(secsLeft)
      if (secsLeft !== lastSecsLeft) {
        lastSecsLeft = secsLeft
        // A soft tick for each of the last five seconds.
        if (secsLeft >= 1 && secsLeft <= 5) sfx.tick()
      }
      if (dateTag) dateTag.textContent = calendarLabel(dayOf(market, Math.floor(playHead)))
      clock.classList.toggle('hurry', secsLeft <= 5)
      renderNumbers()
      if (round.holding) renderPad()
      if (isOver(round)) {
        finish()
        return
      }
      if (running() && elapsed - lastCheckpoint >= CHECKPOINT_MS) checkpoint()
    }

    const head = historyTicks + playHead
    const from = Math.max(0, head - windowTicks * 0.82)
    chart.draw({
      from,
      to: from + windowTicks,
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
    back() {
      quit()
      return true
    },
    destroy() {
      // Leaving mid-round by any route keeps the result so far.
      checkpoint()
      cancelAnimationFrame(raf)
      chart.destroy()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibility)
    },
  }
}
