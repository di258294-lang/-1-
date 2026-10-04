import { describe, expect, it } from 'vitest'
import { generateMarket, playPrice } from './market'
import {
  CHALLENGE_ASK,
  dailyShareText,
  practiceShareText,
  profileShareText,
  roundShareText,
  slices,
  timelineSquares,
  timingMarks,
} from './share'
import { TYPES, type Profile } from './habits'

const market = generateMarket(11)
const allHeld = new Array<boolean>(market.playTicks).fill(true)
const noneHeld = new Array<boolean>(market.playTicks).fill(false)
const url = 'https://x.y/-1-/?c=AbC'

describe('timing marks', () => {
  it('is right when holding through a rise or sitting out a fall, and the two complement', () => {
    const rises = slices(market).filter(([a, b]) => playPrice(market, b) > playPrice(market, a)).length
    const held = timingMarks(market, allHeld)
    const cash = timingMarks(market, noneHeld)
    expect(held.total).toBe(10)
    expect(held.right).toBe(rises)
    expect(cash.right).toBe(10 - rises)
    expect([...held.marks]).toHaveLength(10)
    expect(held.marks.replace(/⭕|❌/g, '')).toBe('')
    // Slice by slice, the held row and the cash row are opposites.
    const a = [...held.marks]
    const b = [...cash.marks]
    expect(a.every((m, i) => m !== b[i])).toBe(true)
  })

  it('scores 10/10 for holding exactly the rising slices, flat ones counted as falls', () => {
    const perfect = new Array<boolean>(market.playTicks).fill(false)
    for (const [a, b] of slices(market)) {
      const rose = playPrice(market, b) > playPrice(market, a)
      for (let t = a; t < b; t++) perfect[t] = rose
    }
    expect(timingMarks(market, perfect)).toMatchObject({ right: 10, marks: '⭕'.repeat(10) })
    expect(timingMarks(market, perfect.map((x) => !x)).right).toBe(0)
  })
})

describe('daily share', () => {
  const text = dailyShareText({ market, result: { yourReturn: 0.018, buyHoldReturn: 0.08, held: allHeld }, day: 5, url, streak: 12 })
  const lines = text.split('\n')

  it('gives nothing away about the chart', () => {
    expect(text).not.toMatch(/🟥|🟦|⬜/)
    expect(text).not.toContain('+1.8%')
    expect(text).not.toContain('+8.0%')
    expect(text).not.toContain('운')
  })

  it('says timing N/10, the edge over holding, the streak and the challenge link in at most 5 lines', () => {
    expect(lines.length).toBeLessThanOrEqual(5)
    expect(lines[0]).toBe('HOLD #5 · 주식 (가상 게임)')
    expect(lines[1]).toMatch(/^타이밍 \d+\/10 [⭕❌]{10}$/u)
    expect(lines[2]).toBe('그냥 들고 있기보다 -6.2% · 12일 연속')
    expect(lines[3]).toBe(`${CHALLENGE_ASK} ${url}`)
  })

  it('leaves out a one-day streak', () => {
    const one = dailyShareText({ market, result: { yourReturn: 0.05, buyHoldReturn: 0.01, held: allHeld }, day: 5, url, streak: 1 })
    expect(one.split('\n')[2]).toBe('그냥 들고 있기보다 +4.0%')
  })
})

describe('practice share', () => {
  it('keeps the numbers and squares, and the challenge ask', () => {
    const text = practiceShareText({ market, result: { yourReturn: 0.018, buyHoldReturn: 0.08, held: noneHeld }, url })
    const lines = text.split('\n')
    expect(lines.length).toBeLessThanOrEqual(5)
    expect(lines[0]).toBe('HOLD 연습 · 주식 (가상 게임)')
    expect(lines[1]).toBe('나 +1.8% · 그냥 들고 있기 +8.0%')
    expect(lines[2]).toBe(timelineSquares(market, noneHeld))
    expect(lines[2]).toBe('⬜'.repeat(10))
    expect(lines[3]).toBe(`${CHALLENGE_ASK} ${url}`)
  })

  it('names a friend round and a long round', () => {
    const r = { yourReturn: 0, buyHoldReturn: 0, held: noneHeld }
    expect(roundShareText({ market, result: r, day: null, url, label: '친구 도전' }).split('\n')[0]).toBe('HOLD 친구 도전 · 주식 (가상 게임)')
    const long = generateMarket(3, 'gold', 'long')
    expect(roundShareText({ market: long, result: r, day: null, url }).split('\n')[0]).toBe('HOLD 장기 1년 · 금 (가상 게임)')
  })

  it('goes spoiler-free whenever there is a day number', () => {
    const text = roundShareText({ market, result: { yourReturn: 0.01, buyHoldReturn: 0.02, held: allHeld }, day: 4, url, label: '친구 도전' })
    expect(text.split('\n')[0]).toBe('HOLD #4 · 주식 (가상 게임)')
    expect(text).toContain('타이밍 ')
  })
})

describe('habit type share', () => {
  it('reads like a personality test in four lines', () => {
    const profile: Profile = { type: 'chicken', scores: { holder: 0, chicken: 0.8, scalper: 0, chaser: 0, rumor: 0 }, rounds: 6 }
    const lines = profileShareText(profile, 'https://x.y').split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[0]).toBe('HOLD 매매 습관 진단 (게임)')
    expect(lines[1]).toBe(`나는 '${TYPES.chicken.name}'`)
    expect(TYPES.chicken.line.startsWith(lines[2])).toBe(true)
    expect(lines[2].endsWith('.')).toBe(true)
    expect(lines[3]).toBe('너는 무슨 형? https://x.y')
  })
})
