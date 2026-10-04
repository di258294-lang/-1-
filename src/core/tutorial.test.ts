import { describe, expect, it } from 'vitest'
import { generateMarket, playPrice } from './market'
import { analyzeRound } from './habits'
import { advanceTo, createRound, isOver, setHolding, summarize } from './round'
import {
  Coach,
  COACH,
  findTutorial,
  flatStretch,
  NEWS_SHOW_AFTER,
  sliceMarket,
  TAP_MS,
  TUTORIAL_TICKS,
  tutorialMarket,
  tutorialProblems,
} from './tutorial'

describe('tutorial market', () => {
  it('finds a seed in range with every property the coach relies on', () => {
    // If an engine retune breaks this, widen SEARCH_SEEDS or loosen the checks
    // in tutorialProblems; the game itself falls back to a plain chart.
    const pick = findTutorial()
    expect(pick).not.toBeNull()
    const m = tutorialMarket()
    expect(tutorialProblems(m)).toEqual([])

    const [filing, rumor] = m.news
    expect(m.news).toHaveLength(2)
    expect(filing.kind).toBe('filing')
    expect(filing.implied).toBe(1)
    expect(filing.at).toBeLessThan(TUTORIAL_TICKS / 2)
    expect(rumor.kind).toBe('rumor')
    expect(rumor.actual).not.toBe(rumor.implied)
    expect(flatStretch(m)).not.toBeNull()
  })

  it('is about 20 seconds of a stock chart with a full history', () => {
    const m = tutorialMarket()
    expect(m.product).toBe('stock')
    expect(m.playTicks).toBe(TUTORIAL_TICKS)
    expect(m.prices).toHaveLength(m.historyTicks + m.playTicks + 1)
    expect(m.prices.every((p) => Number.isFinite(p) && p > 0)).toBe(true)
  })

  it('is the same chart every time', () => {
    expect(tutorialMarket().prices).toEqual(tutorialMarket().prices)
  })

  it('slices prices and re-bases news to the window', () => {
    const full = generateMarket(62, 'stock', 'short')
    const start = 40
    const m = sliceMarket(full, start, TUTORIAL_TICKS)
    for (let t = 0; t <= TUTORIAL_TICKS; t++) expect(playPrice(m, t)).toBe(playPrice(full, start + t))
    for (const n of m.news) {
      expect(n.at).toBeGreaterThanOrEqual(0)
      expect(n.impactAt + NEWS_SHOW_AFTER).toBeLessThan(TUTORIAL_TICKS)
    }
  })

  it('plays through the round engine and habit analysis', () => {
    const m = tutorialMarket()
    const r = createRound(m)
    advanceTo(r, 30)
    setHolding(r, true)
    advanceTo(r, 120)
    setHolding(r, false)
    advanceTo(r, m.playTicks)
    expect(isOver(r)).toBe(true)
    const result = summarize(r)
    expect(result.held).toHaveLength(TUTORIAL_TICKS)
    expect(() => analyzeRound(m, result.held, result.fees)).not.toThrow()
  })
})

describe('coach', () => {
  const m = tutorialMarket()
  const [filing, rumor] = m.news

  it('walks through press, release, filing, rumor and the goal', () => {
    const c = new Coach(m)
    expect(c.line(0, false)).toBe(COACH.press)
    c.buy()
    expect(c.line(10, true)).toBe(COACH.release)
    c.sell(20, 1200)
    expect(c.line(25, false)).toBeNull()
    expect(c.line(filing.at, false)).toBe(COACH.filing)
    expect(c.line(rumor.at + 1, true)).toBe(COACH.rumor)
    expect(c.line(m.playTicks - 5, true)).toBe(COACH.goal)
  })

  it('warns about a tap, then moves on', () => {
    const c = new Coach(m)
    c.buy()
    c.sell(12, TAP_MS - 100)
    expect(c.line(13, false)).toBe(COACH.tap)
    expect(c.line(30, false)).toBe(COACH.tap)
    expect(c.line(60, false)).not.toBe(COACH.tap)
    // A tap is not a release: the next hold still hears "let go to sell".
    c.buy()
    expect(c.line(31, true)).toBe(COACH.release)
  })

  it('never calls a tap a mistake in tap-to-toggle mode', () => {
    const c = new Coach(m, true)
    expect(c.line(0, false)).toBe(COACH.pressToggle)
    c.buy()
    expect(c.line(5, true)).toBe(COACH.releaseToggle)
    c.sell(6, 50)
    expect(c.line(7, false)).not.toBe(COACH.tap)
  })

  it('keeps coach copy plain: no em dashes', () => {
    for (const line of Object.values(COACH)) expect(line).not.toMatch(/[—–]/)
  })
})
