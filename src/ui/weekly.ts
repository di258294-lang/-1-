import { dailySeed, dateKey } from '../core/daily'
import { generateMarket } from '../core/market'
import { save } from '../core/storage'
import { pastWeeks, weeklyProgress, type DayMark, type WeeklyDay, type WeeklyProgress } from '../core/weekly'
import { h } from './dom'
import { logError } from './errors'
import { openSheet } from './sheet'
import { productOf } from './week'

/**
 * The weekly constraint challenge on home (one row) and on the records
 * screen (a card, plus a line for every finished week). Read-only: progress
 * is recomputed from the saved dailies each time, nothing is stored.
 */

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일']

const dayOf = (key: string): WeeklyDay | undefined => {
  const d = save.daily(key)
  return d && { key, ...d }
}

const marketOf = (d: WeeklyDay) => generateMarket(dailySeed(d.key), productOf(d.key), 'short')

function progress(today = dateKey()): WeeklyProgress | null {
  try {
    return weeklyProgress(today, dayOf, marketOf)
  } catch (err) {
    logError(err, 'weeklyProgress')
    return null
  }
}

/** "3번 중 1번", or "완료": words, not a fraction. */
const countText = (p: WeeklyProgress) => (p.done ? '완료' : `${p.goal}번 중 ${p.passed}번`)

/** "10월 5일~11일", "9월 28일~10월 4일" */
function weekRange(p: WeeklyProgress) {
  const md = (key: string) => key.slice(5).split('-').map(Number)
  const [m1, d1] = md(p.days[0].key)
  const [m2, d2] = md(p.days[6].key)
  return `${m1}월 ${d1}일~${m1 === m2 ? '' : `${m2}월 `}${d2}일`
}

const MARK_CLASS: Record<DayMark, string> = {
  pass: 'wk-played',
  fail: 'wk-missed',
  skip: 'wk-before',
  none: 'wk-before',
  today: 'wk-today',
  future: 'wk-future',
}

const MARK_WORD: Record<DayMark, string> = {
  pass: '해낸 날',
  fail: '못 한 날',
  skip: '소문이 없어서 세지 않은 날',
  none: '안 한 날',
  today: '오늘',
  future: '남은 날',
}

/** Monday to Sunday, filled where the day kept the rule. */
function dayCells(p: WeeklyProgress, today: string) {
  const label = p.days.map((d, i) => `${WEEKDAYS[i]} ${MARK_WORD[d.mark]}`).join(', ')
  return h(
    'div',
    { class: 'wk-sheet', role: 'img', 'aria-label': label },
    h(
      'span',
      { class: 'wk wk-lg', 'aria-hidden': 'true' },
      ...p.days.map((d, i) =>
        h(
          'span',
          { class: `wk-cell ${MARK_CLASS[d.mark]}${d.key === today ? ' wk-now' : ''}` },
          h('span', { class: 'wk-day' }, WEEKDAYS[i]),
          h('span', { class: 'wk-dot' }, d.mark === 'pass' ? '✓' : ''),
        ),
      ),
    ),
  )
}

const goalLine = (p: WeeklyProgress) => {
  const skipped = p.days.filter((d) => d.mark === 'skip').length
  return `이번 주 오늘의 차트 중 ${p.goal}번 해내면 완료예요.${skipped ? ` 소문이 없어서 세지 않은 날이 ${skipped}일 있어요.` : ''}`
}

function showWeeklySheet(p: WeeklyProgress, today: string, openRecords: () => void) {
  let close = () => {}
  const ok = h('button', { class: 'btn btn-primary', onclick: () => close() }, '알겠어요')
  const scrim = h(
    'div',
    {
      class: 'sheet-scrim',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'weekly-title',
      onclick: (e: Event) => e.target === scrim && close(),
    },
    h(
      'div',
      { class: 'sheet' },
      h('p', { class: 'habit-kicker' }, '이번 주 챌린지'),
      h('h2', { id: 'weekly-title' }, p.rule.title),
      h('p', { class: 'sheet-body' }, `${p.rule.detail} ${goalLine(p)}`),
      dayCells(p, today),
      h('p', { class: 'weekly-count num' }, p.done ? '이번 주 챌린지 완료' : `${p.goal}번 중 ${p.passed}번 해냈어요`),
      h(
        'div',
        { class: 'sheet-actions' },
        h(
          'button',
          {
            class: 'btn btn-quiet',
            onclick: () => {
              close()
              openRecords()
            },
          },
          '기록 보기',
        ),
        ok,
      ),
    ),
  )
  close = openSheet(scrim, { initialFocus: ok })
}

/** One home row: "이번 주 챌린지 · <rule>" and "3번 중 1번". Null if progress can't be read. */
export function weeklyRow(openRecords: () => void): HTMLElement | null {
  const today = dateKey()
  const p = progress(today)
  if (!p) return null
  return h(
    'button',
    {
      class: 'list-row weekly-row',
      'aria-label': `이번 주 챌린지 · ${p.rule.title}. ${p.done ? '완료' : `${p.goal}번 중 ${p.passed}번 해냈어요`}`,
      onclick: () => showWeeklySheet(p, today, openRecords),
    },
    // Not .weekly-label (one clipped line): the rule wraps under its label.
    h('span', { class: 'list-label' }, '이번 주 챌린지', h('small', null, p.rule.title)),
    h(
      'span',
      { class: 'list-value num' },
      p.done ? h('span', { class: 'up' }, countText(p)) : countText(p),
      h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'),
    ),
  )
}

/**
 * One line for the daily result screen, about the day just played:
 * "이번 주 챌린지 3번 중 2번 · 하루 더 하면 완료예요", or why the day didn't
 * count. Null if progress can't be read.
 */
export function weeklyResultLine(today = dateKey()): string | null {
  const p = progress(today)
  if (!p) return null
  const mark = p.days.find((d) => d.key === today)?.mark
  if (mark === 'skip') return '이번 주 챌린지 · 오늘 차트엔 소문이 없어서 세지 않았어요.'
  if (p.done) return '이번 주 챌린지 완료예요.'
  const left = p.goal - p.passed
  const daysLeft = p.days.filter((d) => d.key > today).length
  const tail = left <= daysLeft ? `${left === 1 ? '하루' : `${left}번`} 더 하면 완료예요.` : '월요일엔 새 챌린지가 나와요.'
  return `이번 주 챌린지 ${countText(p)} · ${tail}`
}

/** The records screen card, and below it every finished week that was completed. */
export function weeklySection(): HTMLElement | null {
  const today = dateKey()
  const p = progress(today)
  if (!p) return null
  let done: WeeklyProgress[] = []
  try {
    const first = save.dailyHistory().find((d) => !d.abandoned)?.key ?? null
    done = pastWeeks(today, first, dayOf, marketOf).filter((w) => w.done)
  } catch (err) {
    logError(err, 'pastWeeks')
  }
  return h(
    'section',
    { class: 'rec-sec weekly-sec' },
    h(
      'div',
      { class: 'habit-card' },
      h('p', { class: 'habit-kicker' }, `이번 주 챌린지 · ${weekRange(p)}`),
      h('h2', { class: 'habit-title' }, p.rule.title),
      dayCells(p, today),
      h('p', { class: 'habit-line num' }, p.done ? '이번 주 챌린지 완료' : `${p.goal}번 중 ${p.passed}번 해냈어요`),
      h('p', { class: 'fine' }, `${p.rule.detail} ${goalLine(p)}`),
    ),
    done.length
      ? h(
          'div',
          { class: 'list' },
          ...done.map((w) =>
            h(
              'div',
              { class: 'list-row' },
              h('span', { class: 'list-label' }, `${weekRange(w)} 챌린지 완료`, h('small', null, w.rule.title)),
              h('span', { class: 'list-value num' }, `${w.passed}번`),
            ),
          ),
        )
      : null,
  )
}
