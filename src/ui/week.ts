import { EPOCH_KEY } from '../core/daily'
import { daysToNextFreeze } from '../core/growth'
import { dailyProduct, PRODUCTS, type ProductKey } from '../core/products'
import { save, type StreakState } from '../core/storage'
import { FREEZE_CAP, FREEZE_EVERY, type DayState } from '../core/streak'
import { h } from './dom'
import { openSheet } from './sheet'

/** Monday first, matching StreakState.week. */
const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일']

const STATE_WORD: Record<DayState, string> = {
  played: '한 날',
  frozen: '휴장일로 지킨 날',
  missed: '빠진 날',
  today: '오늘',
  future: '남은 날',
}

export const FREEZE_RULE = `${FREEZE_EVERY}일 연속으로 하면 휴장일이 1개 생겨요. 하루 빠지면 자동으로 써서 연속 기록을 지켜요. 최대 ${FREEZE_CAP}개까지 모여요.`

/** The product a day was played with, else the one it was scheduled with. */
export function productOf(key: string): ProductKey {
  return save.daily(key)?.product ?? dailyProduct(key)
}

/**
 * Seven cells, Monday to Sunday: the weekday, and a dot with that day's
 * product initial. Filled = played, ring = kept by a 휴장일, grey = missed,
 * outlined = today, faint = still to come. Decorative: the caller labels it.
 */
export function weekCells(state: StreakState, today: string, size: 'sm' | 'lg' = 'sm') {
  const row = h('span', { class: `wk wk-${size}`, 'aria-hidden': 'true' })
  weekDays(state).forEach(({ key, state: s }, i) => {
    row.append(
      h(
        'span',
        { class: `wk-cell wk-${s}${key === today ? ' wk-now' : ''}` },
        h('span', { class: 'wk-day' }, WEEKDAYS[i]),
        h('span', { class: 'wk-dot' }, PRODUCTS[productOf(key)].name[0]),
      ),
    )
  })
  return row
}

type Cell = { key: string; state: DayState | 'before' }

/**
 * Days before the first daily chart, or before the player's first round,
 * were never missed: they show blank instead of grey, so a newcomer's week
 * doesn't open full of gaps.
 */
function weekDays(state: StreakState): Cell[] {
  const first = save.dailyHistory()[0]?.key ?? '9999'
  return state.week.map((d) =>
    d.state === 'missed' && (d.key < EPOCH_KEY || d.key < first) ? { key: d.key, state: 'before' } : d,
  )
}

const word = (c: Cell, today: string) =>
  c.state === 'before' ? '기록 전' : c.key === today && c.state === 'played' ? '오늘 한 날' : STATE_WORD[c.state]

/** "월 한 날, 화 빠진 날, ..." for screen readers. */
export function weekLabel(state: StreakState, today: string) {
  return weekDays(state)
    .map((c, i) => `${WEEKDAYS[i]} ${word(c, today)}`)
    .join(', ')
}

function nextFreezeLine(state: StreakState, today: string) {
  const played = save
    .dailyHistory()
    .filter((d) => !d.abandoned)
    .map((d) => d.key)
  const next = daysToNextFreeze(played, state.frozen, today, state.tokens)
  const held = `지금 휴장일 ${state.tokens}개`
  return next === null ? `${held}, 최대로 모았어요.` : `${held}. ${next}일 더 하면 1개 생겨요.`
}

/** The key under the strip, so the symbols never need guessing. */
export function weekLegend() {
  const item = (cls: string, text: string) =>
    h('span', { class: 'wk-key' }, h('span', { class: `wk-cell wk-${cls}` }, h('span', { class: 'wk-dot' })), text)
  return h(
    'p',
    { class: 'wk-legend', 'aria-hidden': 'true' },
    item('played', '한 날'),
    item('frozen', '휴장일'),
    item('missed', '빠진 날'),
  )
}

/** Tapping the strip: what 휴장일 are, in plain words. Opened by the player only. */
export function showStreakSheet(state: StreakState, today: string, onRecords?: () => void) {
  let close = () => {}
  const ok = h('button', { class: 'btn btn-primary', onclick: () => close() }, '확인')
  const scrim = h(
    'div',
    {
      class: 'sheet-scrim',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'streak-title',
      onclick: (e: Event) => e.target === scrim && close(),
    },
    h(
      'div',
      { class: 'sheet' },
      h('h2', { id: 'streak-title' }, state.days > 0 ? `${state.days}일 연속이에요` : '이번 주 기록'),
      h('div', { class: 'wk-sheet', role: 'img', 'aria-label': weekLabel(state, today) }, weekCells(state, today, 'lg'), weekLegend()),
      h('p', { class: 'sheet-body' }, FREEZE_RULE, h('br'), h('b', { class: 'wk-tokens' }, nextFreezeLine(state, today))),
      h(
        'div',
        { class: onRecords ? 'sheet-actions' : 'wk-actions' },
        onRecords
          ? h(
              'button',
              {
                class: 'btn btn-quiet',
                onclick: () => {
                  close()
                  onRecords()
                },
              },
              '기록 보기',
            )
          : null,
        ok,
      ),
    ),
  )
  close = openSheet(scrim, { initialFocus: ok })
}

/** The home strip: one tappable row, weekdays left, 휴장일 count right. */
export function weekStripButton(state: StreakState, today: string, onRecords: () => void) {
  return h(
    'button',
    {
      class: 'wk-strip',
      'aria-label': `이번 주 기록. ${weekLabel(state, today)}. 휴장일 ${state.tokens}개. 누르면 설명이 나와요.`,
      onclick: () => showStreakSheet(state, today, onRecords),
    },
    weekCells(state, today),
    h(
      'span',
      { class: 'wk-side', 'aria-hidden': 'true' },
      h('span', { class: 'num' }, `휴장일 ${state.tokens}개`),
      h('span', { class: 'chev' }, '›'),
    ),
  )
}
