import {
  HABIT_KEYS,
  HABIT_LABELS,
  PROFILE_MIN_ROUNDS,
  PROFILE_WINDOW,
  profileFrom,
  TYPES,
  type HabitKey,
} from '../core/habits'
import { profileShareText } from '../core/share'
import { save } from '../core/storage'
import type { Navigate, Screen } from './app'
import { h, icons, svg } from './dom'
import { showProductSheet } from './products'
import { shareOut, shareUrl } from './share'

const MEASURES: Record<HabitKey, string> = {
  holder: '손해 보는 중에 같은 시간 보통 흔들리는 폭보다 훨씬 깊게 버텼는지',
  chicken: '수익 내고 팔고 나서, 아무 때나 판 것보다 가격이 더 올랐는지',
  scalper: '한 판 동안 얼마나 자주 사고팔았는지 (40초 기준으로 환산)',
  chaser: '2초 사이 급하게 오른 직후에, 우연보다 자주 샀는지',
  rumor: '지라시가 뜨고 가격이 움직이기 전에, 우연보다 자주 반응했는지',
}

export function habitsScreen(go: Navigate): Screen {
  const history = save.habitRecords()
  const profile = profileFrom(history)

  const practice = () => showProductSheet(go)

  const top = h(
    'div',
    { class: 'topbar' },
    h('button', { class: 'icon-btn', 'aria-label': '홈으로', onclick: () => go({ name: 'home' }) }, svg(icons.close)),
  )

  if (!profile) {
    const done = Math.min(history.length, PROFILE_MIN_ROUNDS)
    const steps = h('div', { class: 'steps', role: 'img', 'aria-label': `${PROFILE_MIN_ROUNDS}판 중 ${done}판` })
    for (let i = 0; i < PROFILE_MIN_ROUNDS; i++) steps.append(h('i', { class: i < done ? 'on' : '' }))
    return {
      el: h(
        'main',
        { class: 'screen' },
        top,
        h('p', { class: 'result-title' }, '매매 습관 진단'),
        h('h1', { class: 'result-grade' }, `${PROFILE_MIN_ROUNDS - done}판 더 하면 성향이 나와요`),
        h(
          'p',
          { class: 'result-line' },
          '누르고 뗀 순간을 보고 아래 다섯 가지를 재요. 매매가 한 번이라도 있었던 판만 세요.',
        ),
        steps,
        h(
          'section',
          { class: 'measures' },
          ...HABIT_KEYS.map((k) =>
            h('div', { class: 'measure' }, h('b', null, HABIT_LABELS[k]), h('span', null, MEASURES[k])),
          ),
        ),
        h('div', { class: 'home-actions' }, h('button', { class: 'btn btn-primary', onclick: practice }, '연습 한 판')),
      ),
    }
  }

  const type = TYPES[profile.type]
  const strongest = HABIT_KEYS.reduce((a, b) => (profile.scores[b] > profile.scores[a] ? b : a))
  const bars = h(
    'section',
    { class: 'meters' },
    ...HABIT_KEYS.map((k) => {
      const v = Math.round(profile.scores[k] * 100)
      const lead = profile.type !== 'machine' && profile.type !== 'watcher' && k === strongest
      return h(
        'div',
        { class: `meter${lead ? ' lead' : ''}` },
        h('div', { class: 'meter-head' }, h('span', null, HABIT_LABELS[k]), h('span', { class: 'num' }, `${v}`)),
        h('div', { class: 'meter-track' }, h('i', { style: `width:${Math.max(2, v)}%` })),
        h('p', { class: 'meter-note' }, MEASURES[k]),
      )
    }),
  )

  return {
    el: h(
      'main',
      { class: 'screen' },
      top,
      h('p', { class: 'result-title' }, `최근 ${profile.rounds}판으로 본 내 성향`),
      h('h1', { class: 'type-name' }, type.name),
      h('p', { class: 'type-line' }, type.line),
      h('div', { class: 'tip' }, h('span', null, '다음 판 미션'), h('b', null, type.tip)),
      bars,
      h(
        'p',
        { class: 'fine' },
        `점수는 0에서 100, 높을수록 그 습관이 강해요. 최근 ${PROFILE_WINDOW}판까지만 반영해서 습관을 고치면 성향도 바뀌어요.`,
      ),
      h(
        'div',
        { class: 'result-actions' },
        h('button', { class: 'btn btn-quiet', onclick: practice }, '연습 한 판'),
        h('button', { class: 'btn btn-primary', onclick: async () => shareOut(profileShareText(profile, await shareUrl())) }, '공유하기'),
      ),
    ),
  }
}
