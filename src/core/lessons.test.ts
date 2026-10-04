import { describe, expect, it } from 'vitest'
import { analyzeRound, roundInsight, type Insight } from './habits'
import { luckLesson, pickLesson, productLesson, roundLessons, type LessonContext } from './lessons'
import type { LuckResult } from './luck'
import { generateMarket, type Market } from './market'
import type { ProductKey } from './products'
import { createRng } from './rng'
import { advanceTo, createRound, setHolding, summarize } from './round'

const PRODUCTS: ProductKey[] = ['stock', 'bond', 'gold', 'coin', 'lev2']

/** Plays a round from a list of [from, to) holding stretches, through the real engine. */
function play(market: Market, runs: Array<[number, number]>) {
  const r = createRound(market)
  for (const [a, b] of runs) {
    advanceTo(r, a)
    setHolding(r, true)
    advanceTo(r, b)
    setHolding(r, false)
  }
  advanceTo(r, market.playTicks)
  return summarize(r)
}

function context(market: Market, runs: Array<[number, number]>, insight?: Insight): LessonContext {
  const result = play(market, runs)
  const habits = analyzeRound(market, result.held, result.fees)
  return { market, result, habits, insight: insight ?? roundInsight(habits) }
}

const sentences = (s: string) => s.split(/(?<=요\.|요\?|요!)\s*/).filter(Boolean).length

describe('micro-lessons', () => {
  it('stay short, plain and honest on every product and pattern', () => {
    const seen = new Set<string>()
    for (const product of PRODUCTS) {
      for (const length of ['short', 'long'] as const) {
        for (let s = 0; s < (length === 'short' ? 40 : 6); s++) {
          const m = generateMarket(700 + s, product, length)
          const rng = createRng(s + 1)
          const runs: Array<[number, number]> = []
          let t = rng.int(0, 40)
          const k = rng.int(0, 12)
          for (let i = 0; i < k && t < m.playTicks - 5; i++) {
            const len = rng.int(2, Math.max(3, Math.floor(m.playTicks / 6)))
            runs.push([t, Math.min(m.playTicks - 1, t + len)])
            t += len + rng.int(2, 60)
          }
          for (const l of roundLessons(context(m, runs))) {
            seen.add(l.id)
            expect(sentences(l.line), l.line).toBeLessThanOrEqual(3)
            expect(l.line).not.toMatch(/NaN|Infinity|undefined|지라시|공시/)
            expect(l.title.length).toBeLessThanOrEqual(24)
          }
        }
      }
    }
    // The common lessons all show up somewhere in this sweep.
    for (const id of ['L1', 'L2', 'L4', 'L6', 'p:bond', 'p:coin', 'p:lev2']) expect(seen.has(id), id).toBe(true)
  })

  it('shows fees to a scalper', () => {
    const m = generateMarket(3)
    const runs: Array<[number, number]> = Array.from({ length: 14 }, (_, i) => [i * 28, i * 28 + 6])
    const ids = roundLessons(context(m, runs)).map((l) => l.id)
    expect(ids).toContain('L1')
    const l1 = roundLessons(context(m, runs)).find((l) => l.id === 'L1')!
    expect(l1.line).toMatch(/0\.2%씩/)
  })

  it('leads with process over outcome when a warned habit still beat the market (L9)', () => {
    const m = generateMarket(5)
    const c = context(m, [[10, 60]])
    const warn: Insight = { tone: 'warn', habit: 'scalper', title: '', line: '' }
    const ahead = { ...c, insight: warn, result: { ...c.result, yourReturn: c.result.buyHoldReturn + 0.02 } }
    expect(roundLessons(ahead)[0].id).toBe('L9')
    const behind = { ...ahead, result: { ...c.result, yourReturn: c.result.buyHoldReturn - 0.02 } }
    expect(roundLessons(behind).map((l) => l.id)).not.toContain('L9')
  })

  it('says sitting out is a choice when the player barely held (L2)', () => {
    for (let s = 0; s < 40; s++) {
      const c = context(generateMarket(s), [])
      if (Math.abs(c.result.buyHoldReturn - c.result.cashReturn) >= 0.01) {
        expect(roundLessons(c).map((l) => l.id)).toContain('L2')
        return
      }
    }
    throw new Error('no round moved 1%')
  })

  it('picks each lesson only once, and the product lesson only once per product', () => {
    const c = context(generateMarket(9, 'coin'), [[0, 100]])
    const all = roundLessons(c).map((l) => l.id)
    expect(all).toContain('p:coin')
    const first = pickLesson(c, [])!
    const second = pickLesson(c, [first.id])
    expect(second?.id).not.toBe(first.id)
    expect(pickLesson(c, all)).toBeNull()
  })

  it('puts the luck lessons with the luck test: L8 for a very high rank, L7 for any extreme one', () => {
    const luck = (percentile: number, better: number): LuckResult => ({
      percentile,
      pValue: 1 - percentile,
      sims: 1000,
      nullReturns: [...Array.from({ length: 1000 - better }, () => 0), ...Array.from({ length: better }, () => 0.2)],
      playerReturn: 0.1,
      runs: 2,
    })
    expect(luckLesson(luck(0.98, 20), 5, [])?.id).toBe('L8')
    expect(luckLesson(luck(0.98, 20), 5, [])?.line).toMatch(/1,000번 중에도 20번/)
    expect(luckLesson(luck(0.98, 20), 5, ['L8'])?.id).toBe('L7')
    expect(luckLesson(luck(0.05, 900), 5, [])?.id).toBe('L7')
    expect(luckLesson(luck(0.05, 900), 2, [])).toBeNull()
    expect(luckLesson(luck(0.5, 500), 9, [])).toBeNull()
    expect(luckLesson(luck(0.98, 20), 5, ['L8'])?.line).not.toMatch(/실력/)
  })
})

describe('2x lesson rounding', () => {
  it('shows "단순 2배" as exactly twice the index as displayed', () => {
    for (const length of ['short', 'long'] as const) {
      for (let s = 0; s < (length === 'short' ? 200 : 40); s++) {
        const line = productLesson(generateMarket(s, 'lev2', length))!.line
        const m = line.match(/지수 ([+-]?[\d.]+)%, .* 단순 2배라면 ([+-]?[\d.]+)%/)
        expect(m, line).not.toBeNull()
        expect(Math.round(Number(m![2]) * 10), line).toBe(2 * Math.round(Number(m![1]) * 10))
      }
    }
  })
})
