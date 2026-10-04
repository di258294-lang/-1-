import type { Lesson } from '../core/lessons'
import { h } from './dom'

/** A short lesson card: a kicker, a title and at most three sentences. */
export function lessonCard(lesson: Lesson, kicker = '알아 두면 좋은 것') {
  return h(
    'section',
    { class: 'lesson-card' },
    h('p', { class: 'habit-kicker' }, kicker),
    h('h2', { class: 'habit-title' }, lesson.title),
    h('p', { class: 'habit-line num' }, lesson.line),
  )
}

/**
 * Help line for players whose real-money trading feels out of control
 * (learning-design report §6). Shown once, in fine print, where the game
 * talks about the player's own habits, never on a result.
 */
export const HELPLINE = '실제 돈으로 하는 매매를 멈추기 어렵다면 한국도박문제예방치유원 상담전화 1336에서 도움을 받을 수 있어요.'
