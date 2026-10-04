import { dailySeed, dateKey, EPOCH_KEY } from '../core/daily'
import { direction, formatPct, formatWon } from '../core/format'
import {
  bestStreak,
  calendarState,
  canReplay,
  monthGrid,
  previousSeason,
  weekSummary,
  winRate,
  type CalendarState,
} from '../core/growth'
import { generateMarket } from '../core/market'
import { PRODUCTS } from '../core/products'
import { seasonDaysLeft, seasonLastDay, seasonOf } from '../core/season'
import { skillCopy, skillRoundsCounted, skillTest, SKILL_MIN_ROUNDS } from '../core/skill'
import { save, type DailyHistoryItem } from '../core/storage'
import type { Navigate, Screen } from './app'
import { h, icons, svg } from './dom'
import { showIntro } from './intro'
import { showProductSheet } from './products'
import { archivedLabel, fromArchive, MEDAL_LINE, MEDAL_RULE, seasonDetail, seasonVersus, SEASON_RULE } from './season'
import { openSheet } from './sheet'
import { FREEZE_RULE, productOf, weekCells, weekLabel, weekLegend } from './week'

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일']

const CELL_WORD: Record<CalendarState, string> = {
  beat: '시장 이긴 날',
  behind: '시장에 못 미친 날',
  abandoned: '중간에 나간 날',
  frozen: '휴장일',
  missed: '안 한 날',
  today: '오늘',
  future: '',
  before: '',
}

/** "11월 3일" */
function dayLabel(key: string) {
  const [, m, d] = key.split('-').map(Number)
  return `${m}월 ${d}일`
}

/** Rules show once before the first round, wherever it starts from. */
function withIntro(start: () => void) {
  if (save.seenIntro()) return start()
  showIntro(() => {
    save.markIntroSeen()
    start()
  })
}

/**
 * A past daily chart, replayed as an ordinary practice round: same seed and
 * product, so the same chart, but it never touches the daily record, the
 * season account or the streak. Today and later are never offered.
 *
 * INTEGRATION: session.ts still counts it as a practice round (unlocks,
 * habit and luck history). A `replayOf?: string` on the practice Mode would
 * let it skip habit/luck history, since a replayed chart's future is known.
 */
export function startReplay(go: Navigate, key: string, today = dateKey()) {
  if (!canReplay(key, today)) return
  const market = generateMarket(dailySeed(key), productOf(key), 'short')
  go({ name: 'play', mode: { kind: 'practice' }, market })
}

function showReplaySheet(go: Navigate, key: string, played: DailyHistoryItem | undefined) {
  const product = PRODUCTS[productOf(key)]
  let close = () => {}
  const startBtn = h(
    'button',
    {
      class: 'btn btn-primary',
      onclick: () => {
        close()
        withIntro(() => startReplay(go, key))
      },
    },
    played ? '복기하기' : '해볼게요',
  )
  const body = played
    ? played.abandoned
      ? '중간에 나간 차트예요. 이미 본 차트라 연습으로만 해요.'
      : `그날 나 ${formatPct(played.yourReturn, 1)}, 그냥 들고 있었으면 ${formatPct(played.buyHoldReturn, 1)}였어요. 이미 아는 차트라 연습으로만 해요.`
    : `그날의 ${product.name} 차트를 연습으로 해요.`
  const scrim = h(
    'div',
    {
      class: 'sheet-scrim',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'replay-title',
      onclick: (e: Event) => e.target === scrim && close(),
    },
    h(
      'div',
      { class: 'sheet' },
      h('h2', { id: 'replay-title' }, `${dayLabel(key)} 차트${played ? ' 복기' : ''}`),
      h('p', { class: 'sheet-body' }, body, ' 계좌와 연속 기록에는 들어가지 않아요.'),
      h(
        'div',
        { class: 'sheet-actions' },
        h('button', { class: 'btn btn-quiet', onclick: () => close() }, '닫기'),
        startBtn,
      ),
    ),
  )
  close = openSheet(scrim, { initialFocus: startBtn })
}

function calendar(
  go: Navigate,
  season: string,
  today: string,
  byKey: Map<string, DailyHistoryItem>,
  frozen: ReadonlySet<string>,
) {
  const first = [...byKey.keys()].sort()[0] ?? '9999'
  const grid = h('div', { class: 'cal-grid', role: 'grid', 'aria-label': `${archivedLabel(season).replace(' 시즌', '')} 달력` })
  grid.append(h('div', { class: 'cal-row cal-head', role: 'row' }, ...WEEKDAYS.map((w) => h('span', { role: 'columnheader' }, w))))
  for (const week of monthGrid(season)) {
    const row = h('div', { class: 'cal-row', role: 'row' })
    for (const key of week) {
      if (!key) {
        row.append(h('span', { class: 'cal-cell cal-pad', role: 'gridcell' }))
        continue
      }
      const entry = byKey.get(key)
      const raw = calendarState(key, today, entry, frozen)
      // Before the player's first round nothing was missed: show it plain.
      const fresh = raw === 'missed' && key < first
      const state = fresh ? 'open' : raw
      const n = String(Number(key.slice(8)))
      const word = fresh ? '' : CELL_WORD[raw]
      if (canReplay(key, today)) {
        const label = `${dayLabel(key)}${word ? `, ${word}` : ''}. ${entry ? '복기하기' : '지난 차트 해보기'}`
        row.append(
          h(
            'button',
            { class: `cal-cell cal-${state}`, role: 'gridcell', 'aria-label': label, onclick: () => showReplaySheet(go, key, entry) },
            n,
          ),
        )
      } else {
        row.append(
          h('span', { class: `cal-cell cal-${state}`, role: 'gridcell', 'aria-label': `${dayLabel(key)}${word ? `, ${word}` : ''}` }, n),
        )
      }
    }
    grid.append(row)
  }
  return h('section', { class: 'cal' }, h('h2', { class: 'rec-h' }, archivedLabel(season).replace(' 시즌', '')), grid)
}

function calLegend() {
  const item = (cls: CalendarState, text: string) =>
    h('span', { class: 'wk-key' }, h('span', { class: `cal-cell cal-key cal-${cls}` }), text)
  return h(
    'p',
    { class: 'wk-legend cal-legend', 'aria-hidden': 'true' },
    item('beat', '시장 이긴 날'),
    item('behind', '못 미친 날'),
    item('abandoned', '중간에 나감'),
    item('frozen', '휴장일'),
  )
}

const listRow = (label: string, sub: string | null, value: Node | string, onclick?: () => void) =>
  h(
    onclick ? 'button' : 'div',
    { class: 'list-row', onclick },
    h('span', { class: 'list-label' }, label, sub ? h('small', null, sub) : null),
    h(
      'span',
      { class: 'list-value num' },
      value,
      onclick ? h('span', { class: 'chev', 'aria-hidden': 'true' }, '›') : null,
    ),
  )

export function recordsScreen(go: Navigate): Screen {
  const today = dateKey()
  const history = save.dailyHistory()
  const byKey = new Map(history.map((d) => [d.key, d]))
  const streak = save.streakState(today)
  const frozen = new Set(streak.frozen)
  const playedKeys = history.filter((d) => !d.abandoned).map((d) => d.key)
  const best = Math.max(bestStreak(playedKeys, streak.frozen, today), streak.days)
  const week = weekSummary(history, today)
  const wins = winRate(history)
  const season = save.seasonSummary(today)
  const past = save.pastSeasons()
  const luck = save.habitRecords().map((r) => r.luckPct)
  const skill = skillTest(luck)
  const practiceBest = save.practiceBest()

  const top = h(
    'div',
    { class: 'topbar' },
    h('button', { class: 'icon-btn', 'aria-label': '홈으로', onclick: () => go({ name: 'home' }) }, svg(icons.close)),
  )

  // This week: the strip, the count, and what 휴장일 are.
  const weekCard = h(
    'section',
    { class: 'habit-card' },
    h('p', { class: 'habit-kicker' }, '이번 주'),
    h(
      'h2',
      { class: 'habit-title num' },
      week.played ? `${week.played}일 참여 · 시장 이긴 날 ${week.beat}일` : '이번 주는 아직이에요',
    ),
    h('div', { class: 'wk-sheet', role: 'img', 'aria-label': weekLabel(streak, today) }, weekCells(streak, today, 'lg'), weekLegend()),
    h(
      'p',
      { class: 'habit-line num' },
      `${streak.days ? `${streak.days}일 연속 · ` : ''}최고 ${best}일 · 휴장일 ${streak.tokens}개`,
    ),
    h('p', { class: 'fine' }, FREEZE_RULE),
  )

  // Calendars: this month, and last month once it has daily charts.
  const thisMonth = seasonOf(today)
  const lastMonth = previousSeason(thisMonth)
  const lastHasDays = seasonLastDay(lastMonth) >= EPOCH_KEY || history.some((d) => seasonOf(d.key) === lastMonth)
  const calendars = h(
    'section',
    { class: 'rec-sec' },
    calendar(go, thisMonth, today, byKey, frozen),
    lastHasDays ? calendar(go, lastMonth, today, byKey, frozen) : null,
    calLegend(),
    h('p', { class: 'fine' }, '지난 날을 누르면 그날 차트를 연습으로 해볼 수 있어요. 이미 한 날은 복기예요.'),
  )

  const seasonLine = {
    you: season.accountReturn,
    market: season.market,
    cash: season.cash,
    days: season.days,
    beatDays: season.beatDays,
  }
  const seasonCard = h(
    'section',
    { class: 'habit-card' },
    h('p', { class: 'habit-kicker' }, `${season.label} · 끝까지 ${seasonDaysLeft(today)}일`),
    h('h2', { class: 'habit-title num' }, season.days ? seasonVersus(seasonLine) : formatWon(season.account)),
    h('p', { class: 'habit-line num' }, season.days ? seasonDetail(seasonLine) : '이번 달 오늘의 차트를 하면 계좌가 움직여요.'),
    h('p', { class: 'fine' }, `${SEASON_RULE} ${MEDAL_RULE}`),
  )

  const counted = skillRoundsCounted(luck)
  const copy = skill && skillCopy(skill)
  const skillCard = h(
    'section',
    { class: 'habit-card' },
    h('p', { class: 'habit-kicker' }, '운일까 실력일까 · 여러 판 모아 보기'),
    h('h2', { class: 'habit-title num' }, copy ? copy.headline : `${SKILL_MIN_ROUNDS}판 이상 하면 보여줘요`),
    h(
      'p',
      { class: 'habit-line num' },
      copy ? copy.line : `사고판 판이 지금 ${counted}판이에요. ${SKILL_MIN_ROUNDS - counted}판 더 하면 돼요.`,
    ),
    h('p', { class: 'fine' }, '내가 사고판 횟수와 보유 시간은 그대로 두고, 타이밍만 무작위로 바꾼 판들과 비교했어요.'),
  )

  const totals = h(
    'section',
    { class: 'list' },
    listRow(
      '시장 이긴 날',
      '오늘의 차트 전체',
      wins.played ? `${wins.played}일 중 ${wins.beat}일` : '아직 없어요',
    ),
    listRow('연속 기록', `최고 ${best}일`, `${streak.days}일`),
    listRow(
      '연습 최고 수익률',
      null,
      practiceBest === null ? '아직 없어요' : h('span', { class: direction(practiceBest) }, formatPct(practiceBest)),
    ),
  )

  const seasons = past.length
    ? h(
        'section',
        { class: 'rec-sec' },
        h('h2', { class: 'rec-h' }, '지난 시즌'),
        h(
          'div',
          { class: 'list' },
          ...[...past].reverse().map((s) => {
            const line = fromArchive(s)
            return h(
              'div',
              { class: 'list-row' },
              h(
                'span',
                { class: 'list-label' },
                archivedLabel(s.season),
                h('small', null, `${s.days}일 참여 · 시장 이긴 날 ${s.beatDays}일`),
                s.medal ? h('small', { class: 'recap-medal' }, MEDAL_LINE) : null,
              ),
              h(
                'span',
                { class: 'list-value num' },
                h(
                  'span',
                  null,
                  h('span', { class: direction(line.you) }, `나 ${formatPct(line.you, 1)}`),
                  h('small', { class: 'rec-ghost' }, `시장 ${formatPct(line.market, 1)}`),
                ),
              ),
            )
          }),
        ),
      )
    : null

  const more = h(
    'section',
    { class: 'list' },
    listRow('내 매매 습관', null, '', () => go({ name: 'habits' })),
    listRow('장기 모드', '1년치 시장을 5분에', '5분', () => withIntro(() => showProductSheet(go, 'long'))),
  )

  return {
    el: h(
      'main',
      { class: 'screen records' },
      top,
      h('h1', { class: 'result-grade' }, '내 기록'),
      weekCard,
      calendars,
      seasonCard,
      skillCard,
      totals,
      seasons,
      more,
    ),
  }
}
