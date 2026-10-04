import { platform } from '#platform'
import { leaderboardScore } from '../core/reach'
import { h, toast } from './dom'
import { logError } from './errors'

/**
 * The Toss game leaderboard: one score per daily goes in, and "순위 보기"
 * opens Toss's own ranking screen. Toss build only; everywhere else
 * platform.leaderboard is null and every entry point here returns null or
 * does nothing. Ranks never earn anything in the game.
 */

/** Days submitted in this session, so one daily is never sent twice. */
const sent = new Set<string>()
/** A score Toss turned down for lack of a game profile: tried once more after the board was opened. */
let pending: { key: string; score: number } | null = null

/** Whether "순위 보기" can be shown. */
export function leaderboardAvailable(): boolean {
  try {
    return platform.leaderboard?.supported() ?? false
  } catch {
    return false
  }
}

/**
 * Submit a recorded daily's score (core/reach.ts leaderboardScore: the edge
 * over buy-and-hold in basis points). Call once, right after the daily was
 * recorded; repeats for the same day are ignored. Fire-and-forget.
 */
export function submitDailyScore(key: string, result: { yourReturn: number; buyHoldReturn: number }): void {
  const board = platform.leaderboard
  if (!board || sent.has(key)) return
  const score = leaderboardScore(result.yourReturn, result.buyHoldReturn)
  if (score === null) return
  sent.add(key)
  board
    .submit(score)
    .then((status) => {
      pending = status === 'no-profile' ? { key, score } : null
    })
    .catch((err) => logError(err, 'leaderboard submit'))
}

/** Open Toss's ranking screen; a score waiting for a game profile goes in after it. */
export async function openLeaderboard(): Promise<void> {
  const board = platform.leaderboard
  if (!board) return
  const opened = await board.open().catch(() => false)
  if (!opened) {
    toast('지금은 순위를 열 수 없어요')
    return
  }
  const retry = pending
  pending = null
  if (retry) await board.submit(retry.score).catch(() => 'failed')
}

/** The result screen's "순위 보기" (a text button), or null where there is no board. */
export function leaderboardButton(): HTMLButtonElement | null {
  if (!leaderboardAvailable()) return null
  return h('button', { class: 'btn btn-text', onclick: () => void openLeaderboard() }, '순위 보기')
}

/** The records screen's row, in its list style, or null where there is no board. */
export function leaderboardRow(): HTMLButtonElement | null {
  if (!leaderboardAvailable()) return null
  return h(
    'button',
    { class: 'list-row', onclick: () => void openLeaderboard() },
    h('span', { class: 'list-label' }, '순위 보기', h('small', null, '오늘의 차트에서 시장보다 앞선 만큼으로 매겨요')),
    h('span', { class: 'list-value' }, h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')),
  )
}
