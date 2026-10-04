import {
  challengeAccess,
  challengeLabel,
  cleanName,
  decodeChallenge,
  encodeChallenge,
  NAME_MAX_CHARS,
  outcome,
  takeChallengeCode,
  type Challenge,
} from '../core/challenge'
import { shownGap } from '../core/copy'
import { dateKey } from '../core/daily'
import { direction, formatPct } from '../core/format'
import { generateMarket, LENGTHS, type Market } from '../core/market'
import type { RoundResult } from '../core/round'
import { roundShareText } from '../core/share'
import { save } from '../core/storage'
import type { Mode, Navigate } from './app'
import { h, toast } from './dom'
import { logError } from './errors'
import { startDaily, withIntro } from './gate'
import { challengeShareUrl, rememberNick, savedNick, shareOut } from './share'
import { openSheet } from './sheet'
import { isTutorial } from './tutorial'

/**
 * Friend challenges: the same chart, head to head, no server.
 *
 * A challenge round runs through the ordinary play route as a practice
 * round, so app.ts needs no new route: the market object itself is the flag
 * (like the tutorial). play.ts asks isChallenge(market) and keeps the round
 * out of every record; result.ts shows challengeCompare() as the headline.
 *
 * A same-day link to today's daily chart, opened before the player has done
 * it, is kept (save.setPendingChallenge) and offered on the result
 * screen right after the daily (ux2 P0-2).
 */
const challenges = new WeakMap<Market, Challenge>()
/** The player's own luck percentile per round, once the result screen has it (it travels in the link). */
const lucks = new WeakMap<Market, number>()

/** True for a round started from a friend's link. */
export function isChallenge(market: Market) {
  return challenges.has(market)
}

/** The friend's challenge behind this round, if any. */
export function challengeOf(market: Market): Challenge | null {
  return challenges.get(market) ?? null
}

// ---------------------------------------------------------------------------
// Opening a link

/**
 * Reads ?c= from the address and removes it at once, so a reload or a
 * shared screenshot of the address bar doesn't carry it on. Call once at boot.
 */
export function takeChallengeParam(): string | null {
  try {
    const { code, rest } = takeChallengeCode(location.href)
    if (code !== null) history.replaceState(history.state, '', rest)
    return code
  } catch (err) {
    logError(err, 'takeChallengeParam')
    return null
  }
}

function infoSheet(title: string, body: string) {
  let close = () => {}
  const ok = h('button', { class: 'btn btn-primary', onclick: () => close() }, '알겠어요')
  const scrim = h(
    'div',
    {
      class: 'sheet-scrim',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'challenge-title',
      onclick: (e: Event) => e.target === scrim && close(),
    },
    h(
      'div',
      { class: 'sheet' },
      h('p', { class: 'habit-kicker' }, '친구의 도전장'),
      h('h2', { id: 'challenge-title' }, title),
      h('p', { class: 'sheet-body' }, body),
      ok,
    ),
  )
  close = openSheet(scrim, { initialFocus: ok })
}

const subject = (c: Challenge) => (c.name ? `${c.name} 님이` : '친구가')
const whoOf = (c: Challenge) => (c.name ? `${c.name} 님` : '친구')

function playedToday(today: string) {
  try {
    return save.daily(today) !== undefined
  } catch {
    return false
  }
}

function seenIntro() {
  try {
    return save.seenIntro()
  } catch {
    return true
  }
}

function safeEncode(c: Challenge): string | null {
  try {
    return encodeChallenge(c)
  } catch {
    return null
  }
}

/** The sheet for a link to today's daily chart before the player has done it. */
function todayFirstSheet(go: Navigate, c: Challenge) {
  let close = () => {}
  const startBtn = h(
    'button',
    {
      class: 'btn btn-primary',
      onclick: () => {
        close()
        // A newcomer still gets the tutorial first; its result hands off to the daily.
        withIntro(go, () => startDaily(go))
      },
    },
    '오늘의 차트부터 할게요',
  )
  const scrim = h(
    'div',
    {
      class: 'sheet-scrim',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'challenge-title',
      onclick: (e: Event) => e.target === scrim && close(),
    },
    h(
      'div',
      { class: 'sheet' },
      h('p', { class: 'habit-kicker' }, '친구의 도전장'),
      h('h2', { id: 'challenge-title' }, `${subject(c)} 오늘의 차트로 도전장을 보냈어요`),
      h('p', { class: 'sheet-body' }, '오늘 차트를 먼저 끝내면 바로 이어서 겨룰 수 있어요. 40초면 돼요.'),
      seenIntro()
        ? null
        : h(
            'p',
            { class: 'sheet-note' },
            'HOLD는 화면을 누르고 있는 동안만 사는 가상 투자 게임이에요. 그냥 계속 들고 있는 것보다 더 벌면 이겨요. 실제 돈은 오가지 않아요.',
          ),
      h(
        'div',
        { class: 'sheet-actions' },
        h('button', { class: 'btn btn-quiet', onclick: () => close() }, '다음에 할게요'),
        startBtn,
      ),
    ),
  )
  close = openSheet(scrim, { initialFocus: startBtn })
}

/** False (with a sheet saying why) when the chart can't be played right now. */
function allowed(go: Navigate, c: Challenge, code?: string) {
  const today = dateKey()
  const access = challengeAccess(c, today, playedToday(today))
  if (access === 'today') {
    // Kept, so the result screen of today's daily can offer it.
    save.setPendingChallenge(code ?? safeEncode(c))
    todayFirstSheet(go, c)
    return false
  }
  if (access === 'future') {
    infoSheet('아직 열리지 않은 차트예요', '그날이 오면 겨뤄 볼 수 있어요.')
    return false
  }
  return true
}

/**
 * Shows what the link holds: the friend's result and a button to play the
 * same chart, or a friendly line about why it can't open. Call after the
 * home screen is up (sheets sit on top of the current screen).
 */
export function openChallenge(go: Navigate, code: string) {
  const decoded = decodeChallenge(code)
  if (!decoded.ok) {
    if (decoded.reason === 'old') {
      infoSheet('예전 차트라 열 수 없어요', '그사이 게임이 바뀌어서 이 차트를 똑같이 그릴 수 없어요. 친구에게 새로 보내 달라고 해 주세요.')
    } else if (decoded.reason === 'new') {
      infoSheet('새 버전에서 보낸 도전장이에요', 'HOLD를 최신 버전으로 바꾸면 열 수 있어요.')
    } else {
      infoSheet('도전장 링크가 깨졌어요', '링크가 중간에 잘렸거나 바뀐 것 같아요. 친구에게 다시 보내 달라고 해 주세요.')
    }
    return
  }
  const c = decoded.challenge
  if (!allowed(go, c, code)) return

  let close = () => {}
  const startBtn = h(
    'button',
    {
      class: 'btn btn-primary',
      onclick: () => {
        close()
        // The rules first for a newcomer, without marking them seen: the
        // guided tutorial still waits for their first daily chart.
        withIntro(go, () => startChallenge(go, c), 'rules')
      },
    },
    '겨뤄 보기',
  )
  const seconds = LENGTHS[c.length].seconds
  const scrim = h(
    'div',
    {
      class: 'sheet-scrim',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'challenge-title',
      onclick: (e: Event) => e.target === scrim && close(),
    },
    h(
      'div',
      { class: 'sheet' },
      h('p', { class: 'habit-kicker' }, '친구의 도전장'),
      h(
        'h2',
        { id: 'challenge-title' },
        `${subject(c)} 이 차트에서 `,
        h('span', { class: `num ${direction(c.ret)}` }, formatPct(c.ret, 1)),
        '를 냈어요.',
      ),
      h('p', { class: 'sheet-body' }, '같은 차트로 겨뤄 볼래요?'),
      h(
        'p',
        { class: 'sheet-note num' },
        `${challengeLabel(c)} · ${seconds >= 60 ? `${seconds / 60}분` : `${seconds}초`}. 연습 판이라 내 기록에는 남지 않아요.`,
      ),
      h(
        'div',
        { class: 'sheet-actions' },
        h('button', { class: 'btn btn-quiet', onclick: () => close() }, '다음에 할게요'),
        startBtn,
      ),
    ),
  )
  close = openSheet(scrim, { initialFocus: startBtn })
}

/** Plays the friend's chart as a practice round. */
export function startChallenge(go: Navigate, c: Challenge) {
  // The sheet may have sat open past midnight: check again.
  if (!allowed(go, c)) return
  let market: Market
  try {
    market = generateMarket(c.seed, c.product, c.length)
  } catch (err) {
    logError(err, 'challenge market')
    toast('차트를 그리지 못했어요')
    return
  }
  // The waiting challenge is the one being played now.
  const code = safeEncode(c)
  if (code && save.pendingChallenge() === code) save.setPendingChallenge(null)
  challenges.set(market, c)
  go({ name: 'play', mode: { kind: 'practice' }, market })
}

/**
 * "민지 님의 도전장이 기다려요 · 같은 차트로 겨뤄 보기 ›": the challenge kept
 * from a same-day link, once today's chart is done. Null when there is none
 * or it can't be played yet.
 */
export function pendingChallengeCard(go: Navigate): HTMLElement | null {
  const code = save.pendingChallenge()
  if (!code) return null
  const decoded = decodeChallenge(code)
  if (!decoded.ok) {
    save.setPendingChallenge(null)
    return null
  }
  const c = decoded.challenge
  const today = dateKey()
  if (challengeAccess(c, today, playedToday(today)) !== 'ok') return null
  return h(
    'button',
    { class: 'unlock challenge-pending', onclick: () => startChallenge(go, c) },
    h('span', null, `${whoOf(c)}의 도전장이 기다려요 · `, h('b', null, '같은 차트로 겨뤄 보기')),
    h('span', { 'aria-hidden': 'true' }, '›'),
  )
}

// ---------------------------------------------------------------------------
// Sending one

type Shareable = Pick<RoundResult, 'yourReturn' | 'buyHoldReturn' | 'held'>

/** The challenge a finished round would send, or null when it can't travel. */
function challengeFor(market: Market, result: Pick<RoundResult, 'yourReturn'>, mode: Mode, name: string | null): Challenge | null {
  if (isTutorial(market)) return null
  // A challenge round keeps the friend's day, so a reply is the same chart.
  const day = mode.kind === 'daily' ? mode.day : (challenges.get(market)?.day ?? null)
  const c: Challenge = {
    seed: market.seed,
    product: market.product,
    length: market.length,
    ret: result.yourReturn,
    day,
    luck: lucks.get(market) ?? null,
    name,
  }
  return safeEncode(c) ? c : null
}

/** What a non-daily share calls the round: 친구 도전, 지난 차트, 장기 1년 or 연습. */
function roundLabel(market: Market, mode: Mode) {
  if (challenges.has(market)) return '친구 도전'
  if (mode.kind === 'practice' && mode.replayOf) return '지난 차트'
  return market.length === 'long' ? '장기 1년' : '연습'
}

/**
 * 공유하기 on the result screen: the round's share text, always with the
 * challenge link (?c=) and "같은 차트로 나보다 잘할 수 있어요?" (ux2 P1-10).
 * Daily charts, a friend's daily chart included, share spoiler-free.
 */
export async function shareRound(market: Market, result: Shareable, mode: Mode, name: string | null = savedNick() || null) {
  const c = challengeFor(market, result, mode, name)
  const day = mode.kind === 'daily' ? mode.day : (challenges.get(market)?.day ?? null)
  let streak = 0
  if (mode.kind === 'daily') {
    try {
      streak = save.streak(mode.key)
    } catch {
      // No streak line.
    }
  }
  const text = roundShareText({
    market,
    result,
    day,
    url: await challengeShareUrl(c),
    streak,
    label: roundLabel(market, mode),
  })
  await shareOut(text)
}

function showSendSheet(market: Market, result: Shareable, mode: Mode, onNamed: (name: string | null) => void) {
  let close = () => {}
  const input = h('input', {
    class: 'challenge-name',
    type: 'text',
    maxlength: NAME_MAX_CHARS,
    autocomplete: 'off',
    enterkeyhint: 'send',
    placeholder: '보낼 이름 (안 써도 돼요)',
    'aria-label': '보낼 이름, 안 써도 돼요',
    value: savedNick(),
  })
  const hint = h('p', { class: 'sheet-note' }, '친구에게는 이 차트와 내 결과, 이 이름만 가요.')
  const send = () => {
    const raw = input.value.trim()
    const name = raw ? cleanName(raw) : null
    if (raw && !name) {
      hint.textContent = `이름은 글자와 숫자로 ${NAME_MAX_CHARS}자까지 쓸 수 있어요.`
      input.focus()
      return
    }
    rememberNick(name)
    onNamed(name)
    close()
    shareRound(market, result, mode, name).catch((err) => logError(err, 'shareRound'))
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      send()
    }
  })
  const sendBtn = h('button', { class: 'btn btn-primary', onclick: send }, '보내기')
  const scrim = h(
    'div',
    {
      class: 'sheet-scrim',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'send-title',
      onclick: (e: Event) => e.target === scrim && close(),
    },
    h(
      'div',
      { class: 'sheet' },
      h('h2', { id: 'send-title' }, '도전장에 이름 넣기'),
      h('p', { class: 'sheet-body' }, '친구가 링크를 열면 누가 보냈는지 보여요. 다음 공유부터도 이 이름이 들어가요.'),
      input,
      hint,
      h(
        'div',
        { class: 'sheet-actions' },
        h('button', { class: 'btn btn-quiet', onclick: () => close() }, '닫기'),
        sendBtn,
      ),
    ),
  )
  close = openSheet(scrim, { initialFocus: input })
}

/**
 * The optional name step under 공유하기 (which already sends the link), or
 * null when the round can't be sent (the tutorial).
 */
export function challengeButton(market: Market, result: Shareable, mode: Mode): HTMLElement | null {
  if (!challengeFor(market, result, mode, null)) return null
  const label = (nick: string | null) => (nick ? `보내는 이름 바꾸기 (지금: ${nick})` : '도전장에 내 이름 넣어 보내기')
  const btn: HTMLButtonElement = h(
    'button',
    { class: 'btn btn-text challenge-send', onclick: () => showSendSheet(market, result, mode, (name) => (btn.textContent = label(name))) },
    label(savedNick()),
  )
  return btn
}

// ---------------------------------------------------------------------------
// The head to head

function row(label: string, value: number, me = false) {
  return h(
    'div',
    { class: `row${me ? ' me' : ''}` },
    h('span', { class: 'row-label' }, label),
    h('span', { class: `row-value num ${direction(value)}` }, formatPct(value, 1)),
  )
}

/**
 * The head-to-head card for a challenge round's result: me, the friend and
 * holding all along, and who won. On that screen it is the headline (`h1`),
 * with the grade below it. Null for any other round. No luck line: it
 * contradicted the comparison it sat under (ux2 P0-3).
 */
export function challengeCompare(
  market: Market,
  result: Pick<RoundResult, 'yourReturn' | 'buyHoldReturn'>,
  heading: 'h1' | 'h2' = 'h2',
): HTMLElement | null {
  const c = challenges.get(market)
  if (!c) return null
  const who = whoOf(c)
  const { result: res } = outcome(result.yourReturn, c.ret)
  const gap = shownGap(result.yourReturn, c.ret)
  const title = res === 'win' ? `${who}보다 ${gap} 앞섰어요` : res === 'lose' ? `${subject(c)} ${gap} 앞섰어요` : '똑같이 해서 비겼어요'
  return h(
    'section',
    { class: 'habit-card challenge-card' },
    h('p', { class: 'habit-kicker' }, `${who}의 도전장 · ${challengeLabel(c)}`),
    h(heading, { class: 'habit-title num', ...(heading === 'h1' ? { tabindex: -1 } : {}) }, title),
    h(
      'div',
      { class: 'rows challenge-rows' },
      row('나', result.yourReturn, true),
      row(who, c.ret),
      row('그냥 들고 있었으면', result.buyHoldReturn),
    ),
  )
}

/** The result screen's luck test finished: the percentile travels in a challenge sent from this round. */
export function challengeLuck(market: Market, percentile: number) {
  if (!Number.isFinite(percentile)) return
  lucks.set(market, percentile)
}
