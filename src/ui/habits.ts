import {
  BAND_LABELS,
  HABIT_KEYS,
  HABIT_LABELS,
  habitBand,
  habitTrend,
  NO_HABIT_TYPES,
  PROFILE_MIN_ROUNDS,
  PROFILE_WINDOW,
  profileFrom,
  TREND_MIN_ROUNDS,
  TREND_SKIP,
  TREND_STEP,
  TREND_WINDOW,
  TYPES,
  type HabitKey,
  type HabitTrend,
} from '../core/habits'
import { profileShareText } from '../core/share'
import { save } from '../core/storage'
import type { Navigate, Screen } from './app'
import { h, icons, svg } from './dom'
import { HELPLINE } from './lesson'
import { activeMissionBlock } from './missions'
import { showProductSheet } from './products'
import { shareOut, shareUrl } from './share'

const MEASURES: Record<HabitKey, string> = {
  holder: '손해 보는 중에 같은 시간 보통 흔들리는 폭보다 훨씬 깊게 버텼는지',
  chicken: '수익 중에 팔고 나서, 아무 때나 판 것보다 가격이 더 올랐는지',
  scalper: '한 판 동안 얼마나 자주 사고팔았는지 (40초 기준으로 환산)',
  chaser: '2초 사이 급하게 오른 직후에, 우연보다 자주 샀는지',
  rumor: '소문이 뜨고 가격이 움직이기 전에, 우연보다 자주 반응했는지',
}

const CHANGE: Record<HabitTrend['change'], string> = { down: '줄었어요', up: '늘었어요', same: '비슷해요' }

/** "6~15판 평균 62 → 최근 10판 31 · 줄었어요" */
function trendLine(t: HabitTrend) {
  const n = (x: number) => Math.round(x * 100)
  return `${TREND_SKIP + 1}~${TREND_SKIP + TREND_WINDOW}판 평균 ${n(t.from)} → 최근 ${TREND_WINDOW}판 ${n(t.to)} · ${CHANGE[t.change]}`
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
  const helpline = h('p', { class: 'fine' }, HELPLINE)

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
        activeMissionBlock(),
        h(
          'section',
          { class: 'measures' },
          ...HABIT_KEYS.map((k) =>
            h('div', { class: 'measure' }, h('b', null, HABIT_LABELS[k]), h('span', null, MEASURES[k])),
          ),
        ),
        h('div', { class: 'home-actions' }, h('button', { class: 'btn btn-primary', onclick: practice }, '연습 한 판')),
        helpline,
      ),
    }
  }

  const type = TYPES[profile.type]
  const strongest = HABIT_KEYS.reduce((a, b) => (profile.scores[b] > profile.scores[a] ? b : a))
  // 관망형, 탐색 중 and 기계형 have no leading habit: nothing is highlighted for them.
  const named = !NO_HABIT_TYPES.includes(profile.type)
  const allLow = HABIT_KEYS.every((k) => habitBand(profile.scores[k]) === 'low')
  const trends = Object.fromEntries(HABIT_KEYS.map((k) => [k, habitTrend(history, k)])) as Record<HabitKey, HabitTrend | null>
  const bars = h(
    'section',
    { class: 'meters' },
    ...HABIT_KEYS.map((k) => {
      const v = Math.round(profile.scores[k] * 100)
      const band = BAND_LABELS[habitBand(profile.scores[k])]
      const lead = named && k === strongest
      const trend = trends[k]
      return h(
        'div',
        { class: `meter${lead ? ' lead' : ''}` },
        h('div', { class: 'meter-head' }, h('span', null, HABIT_LABELS[k]), h('span', null, band)),
        h('div', { class: 'meter-track', role: 'img', 'aria-label': `${HABIT_LABELS[k]} ${band}` }, h('i', { style: `width:${Math.max(2, v)}%` })),
        h('p', { class: 'meter-note' }, MEASURES[k]),
        trend ? h('p', { class: 'meter-note num' }, trendLine(trend)) : null,
      )
    }),
  )
  const anyTrend = HABIT_KEYS.some((k) => trends[k])

  return {
    el: h(
      'main',
      { class: 'screen' },
      top,
      h('p', { class: 'result-title' }, `최근 ${profile.rounds}판으로 본 내 성향`),
      h('h1', { class: 'type-name' }, type.name),
      h('p', { class: 'type-line' }, type.line),
      allLow ? h('p', { class: 'fine' }, '다섯 가지 모두 낮음이라 유형은 판마다 바뀔 수 있어요.') : null,
      activeMissionBlock() ?? h('div', { class: 'tip' }, h('span', null, '다음 판에서 해볼 것'), h('b', null, type.tip)),
      bars,
      h(
        'p',
        { class: 'fine' },
        `높음은 우연이라고 보기 어려울 만큼 뚜렷하다는 뜻이에요. 최근 ${PROFILE_WINDOW}판까지만 반영해서 습관을 고치면 성향도 바뀌어요.`,
      ),
      h(
        'p',
        { class: 'fine' },
        anyTrend
          ? `변화는 ${TREND_SKIP + 1}~${TREND_SKIP + TREND_WINDOW}판과 최근 ${TREND_WINDOW}판의 점수 평균을 견줘요. 우연으로 보기 어려울 만큼 차이가 클 때만 줄었다·늘었다고 하고, ${TREND_STEP}판마다 한 번씩 다시 봐요. 처음 ${TREND_SKIP}판은 유형을 정할 때 쓴 판이라 빼요.`
          : `변화는 아직 판단하기 일러요. 습관을 잴 수 있었던 판이 ${TREND_MIN_ROUNDS}판쯤 쌓이면 보여 줘요.`,
      ),
      h(
        'div',
        { class: 'result-actions' },
        h('button', { class: 'btn btn-quiet', onclick: practice }, '연습 한 판'),
        h('button', { class: 'btn btn-primary', onclick: async () => shareOut(profileShareText(profile, await shareUrl())) }, '공유하기'),
      ),
      helpline,
    ),
  }
}
