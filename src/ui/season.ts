import { formatPct } from '../core/format'
import { unseenSeason } from '../core/growth'
import { MEDAL_MIN_DAYS } from '../core/records'
import { SEASON_START, seasonLabel } from '../core/season'
import { save, type ArchivedSeason } from '../core/storage'
import { h, icons, svg } from './dom'

/**
 * Season pieces shared by home and the records screen: the closed-season
 * recap card and the "which recaps were dismissed" memory.
 *
 * The dismissed list lives in the save file (seenSeasons). Builds before
 * that kept it under its own localStorage key; it is still read, so a recap
 * dismissed there does not come back, and folded into the save on the next
 * dismissal.
 */
export const SEEN_SEASONS_KEY = 'hold.seen.seasons'

export const SEASON_RULE = '말일에 시장 대비 성적으로 결산해요.'
export const MEDAL_RULE = `${MEDAL_MIN_DAYS}일 이상 하고 시장보다 앞서면 메달을 받아요.`

function legacySeen(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_SEASONS_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function seenSeasons(): string[] {
  return [...new Set([...save.seenSeasons(), ...legacySeen()])].sort()
}

export function markSeasonsSeen(seasons: string[]) {
  save.markSeasonsSeen([...legacySeen(), ...seasons])
}

/** '2026-10' -> '10월 시즌'. */
export const archivedLabel = (season: string) => seasonLabel(`${season}-01`)

type Line = { you: number; market: number; cash: number; days: number; beatDays: number }

export function fromArchive(s: ArchivedSeason): Line {
  return { you: s.final / SEASON_START - 1, market: s.market, cash: s.cash, days: s.days, beatDays: s.beatDays }
}

/** "나 +6.1% · 시장 +2.3%" */
export const seasonVersus = (s: Line) => `나 ${formatPct(s.you, 1)} · 시장 ${formatPct(s.market, 1)}`
/** "예금 +0.25% · 18일 참여 · 시장 이긴 날 11일" */
export const seasonDetail = (s: Line) =>
  `예금 ${formatPct(s.cash, 2)} · ${s.days}일 참여 · 시장 이긴 날 ${s.beatDays}일`

export const MEDAL_LINE = '메달: 시장보다 앞서서 시즌을 마쳤어요'

/** The newest closed season the player hasn't dismissed. */
export function pendingRecap() {
  return unseenSeason(save.pastSeasons(), seenSeasons())
}

/**
 * Recap of a closed month. Shown in the page, never as a sheet that pops up
 * on its own. Tapping opens the records screen; the x dismisses it for good.
 */
export function recapCard(
  s: ArchivedSeason & { season: string },
  opts: { onOpen: () => void; onDismiss: () => void },
) {
  const line = fromArchive(s)
  const card = h(
    'section',
    { class: 'recap-card' },
    h(
      'button',
      { class: 'recap-card-body', onclick: opts.onOpen },
      h('span', { class: 'habit-kicker' }, `${archivedLabel(s.season)} 결산`),
      h('span', { class: 'habit-title num' }, seasonVersus(line)),
      h('span', { class: 'habit-line num' }, seasonDetail(line)),
      s.medal ? h('span', { class: 'recap-medal' }, MEDAL_LINE) : null,
    ),
    h(
      'button',
      {
        class: 'icon-btn recap-close',
        'aria-label': `${archivedLabel(s.season)} 결산 닫기`,
        onclick: () => {
          markSeasonsSeen(save.pastSeasons().map((p) => p.season))
          card.remove()
          opts.onDismiss()
        },
      },
      svg(icons.close),
    ),
  )
  return card
}
