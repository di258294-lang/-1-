import { generateMarket, playPrice, type Market, type NewsEvent } from './market'

/**
 * The first-launch practice round: about 20 seconds of a hand-picked stock
 * chart, with coach lines in the news banner. The chart is found by search
 * instead of hard-coded, so it keeps its shape when the engine is retuned.
 */

/** 20 seconds of play. */
export const TUTORIAL_TICKS = 200
/** Seeds searched, in order. The first that fits wins. */
const SEARCH_SEEDS = 2000
/** Used when nothing in the range fits: any stock chart still works. */
const FALLBACK = { seed: 1, start: 0 }

/** How long the news banner stays up, in ticks after impact (matches play.ts). */
export const NEWS_SHOW_AFTER = 24
/** The last stretch of the round where the goal is spelled out. */
const GOAL_TICKS = 45
/** A short-tap warning stays this long. */
const TAP_SHOW_TICKS = 35
/** A hold shorter than this sells almost as soon as it buys. */
export const TAP_MS = 300

/**
 * A window of a generated market, re-based so play starts at `start`. History
 * keeps the same number of days as before, taken from just before the window.
 */
export function sliceMarket(full: Market, start: number, ticks: number): Market {
  // Absolute index of the new history's first tick.
  const from = start
  const news = full.news
    .filter((n) => n.at >= start && n.impactAt + NEWS_SHOW_AFTER < start + ticks)
    .map((n) => ({ ...n, at: n.at - start, impactAt: n.impactAt - start }))
  return {
    ...full,
    playTicks: ticks,
    prices: full.prices.slice(from, from + full.historyTicks + ticks + 1),
    underlying: full.underlying?.slice(from, from + full.historyTicks + ticks + 1),
    yields: full.yields?.slice(from, from + full.historyTicks + ticks + 1),
    news,
  }
}

/** Price move over the first second after a headline's impact. */
function reaction(m: Market, n: NewsEvent) {
  const to = Math.min(m.playTicks, n.impactAt + 10)
  return playPrice(m, to) / playPrice(m, Math.max(0, n.impactAt - 1)) - 1
}

export type FlatStretch = { from: number; to: number }

/**
 * A quiet stretch of at least `len` ticks with no headline on screen, where
 * the price stays inside a narrow band. Holding there earns nothing.
 */
export function flatStretch(m: Market, len = 30, band = 0.012): FlatStretch | null {
  const busy = (t: number) => m.news.some((n) => t >= n.at - 4 && t < n.impactAt + NEWS_SHOW_AFTER)
  for (let from = 0; from + len <= m.playTicks; from++) {
    let lo = Infinity
    let hi = -Infinity
    let ok = true
    for (let t = from; t <= from + len; t++) {
      if (busy(t)) {
        ok = false
        break
      }
      const p = playPrice(m, t)
      lo = Math.min(lo, p)
      hi = Math.max(hi, p)
    }
    if (ok && hi / lo - 1 < band) return { from, to: from + len }
  }
  return null
}

/**
 * What the tutorial needs: an up filing in the first half that visibly lifts
 * the price, then a rumor that turns out wrong, and a flat stretch.
 */
export function tutorialProblems(m: Market): string[] {
  const problems: string[] = []
  if (m.product !== 'stock') problems.push('product')
  if (m.playTicks !== TUTORIAL_TICKS) problems.push('length')
  if (m.news.length !== 2) problems.push('news count')
  const [filing, rumor] = m.news
  if (!filing || filing.kind !== 'filing' || filing.implied !== 1) problems.push('filing')
  else {
    if (filing.at < 40 || filing.at > m.playTicks / 2 - 10) problems.push('filing timing')
    if (reaction(m, filing) < 0.012) problems.push('filing reaction')
  }
  if (!rumor || rumor.kind !== 'rumor' || rumor.actual === rumor.implied) problems.push('rumor')
  else {
    // Off the screen in time to leave the goal line a few seconds of its own.
    if (rumor.at < m.playTicks / 2 || rumor.impactAt + NEWS_SHOW_AFTER > m.playTicks - GOAL_TICKS + 10) {
      problems.push('rumor timing')
    }
    if (reaction(m, rumor) * rumor.implied > -0.012) problems.push('rumor reaction')
  }
  if (!flatStretch(m)) problems.push('flat')
  return problems
}

export type TutorialPick = { seed: number; start: number }

let picked: TutorialPick | null | undefined

/** Searches a fixed seed range in order; null when nothing fits. */
export function findTutorial(): TutorialPick | null {
  if (picked !== undefined) return picked
  picked = null
  for (let seed = 1; seed <= SEARCH_SEEDS && !picked; seed++) {
    const full = generateMarket(seed, 'stock', 'short')
    // Whole trading days, so the chart's day grid stays where it was.
    for (let start = 0; start + TUTORIAL_TICKS <= full.playTicks; start += full.ticksPerDay) {
      if (tutorialProblems(sliceMarket(full, start, TUTORIAL_TICKS)).length === 0) {
        picked = { seed, start }
        break
      }
    }
  }
  return picked
}

/** The tutorial chart. Never throws for want of a perfect seed. */
export function tutorialMarket(): Market {
  const pick = findTutorial() ?? FALLBACK
  return sliceMarket(generateMarket(pick.seed, 'stock', 'short'), pick.start, TUTORIAL_TICKS)
}

// ---------------------------------------------------------------------------
// Coach

export const COACH = {
  press: '지금 눌러보세요. 누르고 있는 동안만 들고 있어요',
  release: '손을 떼면 팔아요',
  pressToggle: '지금 톡 쳐보세요. 한 번 치면 사요',
  releaseToggle: '한 번 더 치면 팔아요',
  filing: '회사 공식 발표예요. 믿어도 돼요',
  rumor: '소문은 반은 틀려요',
  goal: '그냥 계속 들고 있는 것보다 더 벌면 이겨요',
  tap: '짧게 톡 치면 사자마자 팔려요. 손가락을 대고 있어야 해요.',
} as const

/**
 * Decides the coach line from what the player has done so far. Pure state:
 * play.ts reports buys and sells, and asks for the line each frame.
 */
export class Coach {
  private bought = false
  /** Sold after a real hold (not a tap). */
  private released = false
  private tapAt: number | null = null

  constructor(
    private readonly market: Market,
    /** Tap-to-toggle input: taps are the controls, never a mistake. */
    private readonly toggle = false,
  ) {}

  buy() {
    this.bought = true
    // Trying again is the fix: the next hold hears the usual line.
    this.tapAt = null
  }

  /** A sell the player made, with how long the position was held. */
  sell(tick: number, heldMs: number) {
    if (!this.toggle && heldMs < TAP_MS) this.tapAt = tick
    else this.released = true
  }

  /** The coach line for this moment, or null for none. */
  line(tick: number, holding: boolean): string | null {
    if (this.tapAt !== null && tick - this.tapAt < TAP_SHOW_TICKS) return COACH.tap
    const n = this.market.news.find((e) => tick >= e.at && tick < e.impactAt + NEWS_SHOW_AFTER)
    if (n) return n.kind === 'filing' ? COACH.filing : COACH.rumor
    if (tick >= this.market.playTicks - GOAL_TICKS) return COACH.goal
    if (!this.bought) return this.toggle ? COACH.pressToggle : COACH.press
    if (holding && !this.released) return this.toggle ? COACH.releaseToggle : COACH.release
    return null
  }
}
