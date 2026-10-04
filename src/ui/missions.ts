import {
  MISSIONS,
  progressOf,
  progressShort,
  progressText,
  type Attempt,
  type MissionOutcome,
  type MissionProgress,
} from '../core/missions'
import { save } from '../core/storage'
import { h } from './dom'

/**
 * Mission pieces for the result, habits and home screens. Plain text and
 * a dot strip: no confetti, no badges, no counts of trades. A mission is
 * about a habit, and only getting better at it is called a success.
 */

/** ●●○ for the judged rounds in the current window, oldest first. */
function dots(p: MissionProgress) {
  const recent: Array<Attempt | null> = [...p.recent]
  while (recent.length < p.window) recent.push(null)
  return h(
    'span',
    { class: 'mission-dots', 'aria-hidden': 'true' },
    ...recent.map((a) => h('i', { class: a ?? 'empty' })),
  )
}

function progressRow(p: MissionProgress) {
  return h('p', { class: 'mission-progress num' }, dots(p), h('span', null, progressText(p)))
}

const HEADLINE: Record<MissionOutcome['outcome'], string> = {
  pass: '이번 판은 성공이에요',
  fail: '이번 판은 아직이에요',
  ineligible: '이번 판은 미션에 해당하는 장면이 없었어요',
  new: '',
}

/** What completing means: kept the goal in recent rounds, not "changed the habit". */
function doneLine(p: MissionProgress) {
  const kept = p.need === p.window ? `${p.need}판 연속` : `최근 ${p.window}판 중 ${p.need}판에서`
  return `${kept} 목표를 지켰어요. 습관으로 굳었는지는 2주 뒤에 한 번 더 볼게요.`
}

/**
 * The mission verdict for the result screen: what was asked, what this
 * round's number was, and how far along the mission is. When the mission
 * was swapped without being completed, its progress no longer applies, so
 * the reason is shown instead.
 */
export function missionCard(outcome: MissionOutcome) {
  const def = MISSIONS[outcome.id]
  const title = outcome.completed ? '미션을 해냈어요' : HEADLINE[outcome.outcome]
  return h(
    'section',
    { class: `habit-card mission-card mission-${outcome.completed ? 'done' : outcome.outcome}` },
    h('p', { class: 'habit-kicker' }, `${outcome.recheck ? '다시 해보기 미션' : '미션'} · ${def.title}`),
    h('h2', { class: 'habit-title' }, title),
    h('p', { class: 'habit-line num' }, outcome.measure),
    outcome.completed
      ? h('p', { class: 'habit-line' }, doneLine(outcome.progress))
      : outcome.reason
        ? h('p', { class: 'habit-line' }, outcome.reason)
        : progressRow(outcome.progress),
  )
}

/** The active mission for the habits screen, or null before the first round. */
export function activeMissionBlock() {
  const active = save.coach().active
  if (!active) return null
  const def = MISSIONS[active.id]
  return h(
    'section',
    { class: 'habit-card mission-card' },
    h('p', { class: 'habit-kicker' }, active.recheck ? '지금 미션 · 다시 해보기' : '지금 미션'),
    h('h2', { class: 'habit-title' }, def.title),
    h('p', { class: 'habit-line' }, def.goal),
    h('p', { class: 'habit-line' }, def.why),
    progressRow(progressOf(active.id, active.attempts)),
  )
}

/**
 * One-line chip for the home screen: "지금 미션 · 한 번은 길게 들고 있기 · 3번 성공하면 완료 · 지금 1번".
 * Null when there is no mission yet (before the first finished round).
 */
export function missionChip(onOpen?: () => void): HTMLElement | null {
  const active = save.coach().active
  if (!active) return null
  const def = MISSIONS[active.id]
  const p = progressOf(active.id, active.attempts)
  return h(
    'button',
    { class: 'list-row mission-chip', onclick: onOpen ? () => onOpen() : undefined, 'aria-label': `지금 미션 ${def.title}, ${progressText(p)}` },
    // Words, not "1/3": the progress reads as its own line under the title.
    h('span', { class: 'list-label' }, '지금 미션', h('small', null, def.title), h('small', { class: 'num' }, progressShort(p))),
    onOpen ? h('span', { class: 'list-value' }, h('span', { class: 'chev', 'aria-hidden': 'true' }, '›')) : null,
  )
}
