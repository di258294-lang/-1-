import { platform } from '#platform'
import {
  challengeAccess,
  challengeLabel,
  challengeShareText,
  challengeUrl,
  cleanName,
  decodeChallenge,
  encodeChallenge,
  NAME_MAX_CHARS,
  outcome,
  takeChallengeCode,
  type Challenge,
} from '../core/challenge'
import { dateKey } from '../core/daily'
import { direction, formatPct } from '../core/format'
import { generateMarket, LENGTHS, type Market } from '../core/market'
import type { RoundResult } from '../core/round'
import { save } from '../core/storage'
import type { Mode, Navigate } from './app'
import { h, toast } from './dom'
import { logError } from './errors'
import { showIntro } from './intro'
import { openSheet } from './sheet'
import { isTutorial } from './tutorial'

/**
 * Friend challenges: the same chart, head to head, no server.
 *
 * A challenge round runs through the ordinary play route as a practice
 * round, so app.ts needs no new route: the market object itself is the flag
 * (like the tutorial). INTEGRATION: play.ts must ask isChallenge(market) and
 * keep the round out of every record (practice stats, unlocks, habit and
 * luck history), and result.ts shows challengeCompare() and
 * challengeButton(). See the report for the exact lines.
 */
const challenges = new WeakMap<Market, Challenge>()
/** The player's own luck percentile per round, once the result screen has it. */
const lucks = new WeakMap<Market, number>()
/** Compare cards waiting for the luck percentile. */
const luckListeners = new WeakMap<Market, (p: number) => void>()

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

function playedToday(today: string) {
  try {
    return save.daily(today) !== undefined
  } catch {
    return false
  }
}

/** False (with a sheet saying why) when the chart can't be played right now. */
function allowed(c: Challenge) {
  const today = dateKey()
  const access = challengeAccess(c, today, playedToday(today))
  if (access === 'today') {
    infoSheet(
      '오늘의 차트를 먼저 하고 오면 겨룰 수 있어요',
      '친구가 오늘의 차트로 도전장을 보냈어요. 지금 열면 오늘 차트를 미리 보게 돼요. 오늘의 차트를 끝내고 링크를 다시 눌러 주세요.',
    )
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
  if (!allowed(c)) return

  let close = () => {}
  const startBtn = h(
    'button',
    {
      class: 'btn btn-primary',
      onclick: () => {
        close()
        // The rules first for a newcomer; the guided tutorial still waits
        // for their first daily chart.
        if (save.seenIntro()) startChallenge(go, c)
        else showIntro(() => startChallenge(go, c))
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
  if (!allowed(c)) return
  let market: Market
  try {
    market = generateMarket(c.seed, c.product, c.length)
  } catch (err) {
    logError(err, 'challenge market')
    toast('차트를 그리지 못했어요')
    return
  }
  challenges.set(market, c)
  go({ name: 'play', mode: { kind: 'practice' }, market })
}

// ---------------------------------------------------------------------------
// Sending one

const NICK_KEY = 'hold.nick'

function savedNick() {
  try {
    return cleanName(localStorage.getItem(NICK_KEY)) ?? ''
  } catch {
    return ''
  }
}

function rememberNick(name: string | null) {
  try {
    if (name) localStorage.setItem(NICK_KEY, name)
    else localStorage.removeItem(NICK_KEY)
  } catch {
    // Private mode: the name just isn't remembered.
  }
}

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
  try {
    encodeChallenge(c)
    return c
  } catch {
    return null
  }
}

async function sendChallenge(c: Challenge) {
  const url = challengeUrl(await platform.shareUrl(), encodeChallenge(c))
  await platform.share(challengeShareText(c, url))
}

function showSendSheet(market: Market, result: Pick<RoundResult, 'yourReturn'>, mode: Mode) {
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
  const hint = h('p', { class: 'sheet-note' }, `친구에게는 이 차트와 내 수익률 ${formatPct(result.yourReturn, 1)}만 가요.`)
  const send = () => {
    const raw = input.value.trim()
    const name = raw ? cleanName(raw) : null
    if (raw && !name) {
      hint.textContent = `이름은 글자와 숫자로 ${NAME_MAX_CHARS}자까지 쓸 수 있어요.`
      input.focus()
      return
    }
    const c = challengeFor(market, result, mode, name)
    if (!c) return
    rememberNick(name)
    close()
    sendChallenge(c).catch((err) => logError(err, 'sendChallenge'))
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
      h('h2', { id: 'send-title' }, '친구에게 도전장 보내기'),
      h('p', { class: 'sheet-body' }, '친구가 링크를 열면 똑같은 차트로 겨뤄요.'),
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
  close = openSheet(scrim, { initialFocus: sendBtn })
}

/**
 * "친구에게 도전장 보내기" for the result screen, or null when the round
 * can't be sent (the tutorial). Works for daily, practice, long and
 * challenge rounds alike.
 */
export function challengeButton(market: Market, result: Pick<RoundResult, 'yourReturn'>, mode: Mode): HTMLElement | null {
  if (!challengeFor(market, result, mode, null)) return null
  return h(
    'button',
    { class: 'btn btn-text challenge-send', onclick: () => showSendSheet(market, result, mode) },
    challenges.has(market) ? '친구에게 다시 도전장 보내기' : '친구에게 도전장 보내기',
  )
}

// ---------------------------------------------------------------------------
// The head to head

/** "상위 12%", "하위 30%", the luck card's own wording. */
function rank(p: number) {
  return p >= 0.5 ? `상위 ${Math.max(1, Math.round((1 - p) * 100))}%` : `하위 ${Math.max(1, Math.round(p * 100))}%`
}

function luckLine(mine: number | null, friend: number | null, topic: string): string | null {
  if (mine !== null && friend !== null) {
    return `무작위로 누른 판들과 견주면 나는 ${rank(mine)}, ${topic} ${rank(friend)}예요.`
  }
  if (mine !== null) return `무작위로 누른 판들과 견주면 나는 ${rank(mine)}예요.`
  if (friend !== null) return `무작위로 누른 판들과 견주면 ${topic} ${rank(friend)}였어요.`
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
 * The head-to-head card for a challenge round's result: me, the friend and
 * holding all along, and who won. Null for any other round. The luck line
 * fills in when the result screen calls challengeLuck().
 */
export function challengeCompare(market: Market, result: Pick<RoundResult, 'yourReturn' | 'buyHoldReturn'>): HTMLElement | null {
  const c = challenges.get(market)
  if (!c) return null
  const who = c.name ? `${c.name} 님` : '친구'
  const { result: res, gap } = outcome(result.yourReturn, c.ret)
  const gapText = `${(gap * 100).toFixed(1)}%p`
  const title =
    res === 'win' ? `${who}보다 ${gapText} 앞섰어요` : res === 'lose' ? `${subject(c)} ${gapText} 앞섰어요` : '똑같이 해서 비겼어요'
  const line = h('p', { class: 'habit-line num' })
  const setLine = (mine: number | null) => {
    const text = luckLine(mine, c.luck, c.name ? `${c.name} 님은` : '친구는')
    line.textContent = text ?? ''
    line.hidden = !text
  }
  setLine(lucks.get(market) ?? null)
  luckListeners.set(market, (p) => setLine(p))
  return h(
    'section',
    { class: 'habit-card challenge-card' },
    h('p', { class: 'habit-kicker' }, `${who}의 도전장 · ${challengeLabel(c)}`),
    h('h2', { class: 'habit-title num' }, title),
    h(
      'div',
      { class: 'rows challenge-rows' },
      row('나', result.yourReturn, true),
      row(who, c.ret),
      row('그냥 들고 있었으면', result.buyHoldReturn),
    ),
    line,
  )
}

/**
 * The result screen's luck test finished: remembers the percentile (it
 * travels in a challenge sent from this round) and fills the compare card.
 */
export function challengeLuck(market: Market, percentile: number) {
  if (!Number.isFinite(percentile)) return
  lucks.set(market, percentile)
  luckListeners.get(market)?.(percentile)
}
