import { describe, expect, it } from 'vitest'
import { erf, normalCdf, skillCopy, skillRoundsCounted, skillTest, SKILL_MIN_ROUNDS, SKILL_WINDOW } from './skill'

describe('normal CDF', () => {
  it('matches known values', () => {
    expect(erf(0)).toBeCloseTo(0, 7)
    expect(erf(1)).toBeCloseTo(0.8427008, 6)
    expect(erf(-1)).toBeCloseTo(-0.8427008, 6)
    expect(normalCdf(0)).toBeCloseTo(0.5, 7)
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 5)
    expect(normalCdf(-1.644854)).toBeCloseTo(0.05, 5)
    expect(normalCdf(3)).toBeCloseTo(0.9986501, 6)
  })
})

describe('skillTest', () => {
  it('needs at least five luck-tested rounds', () => {
    expect(SKILL_MIN_ROUNDS).toBe(5)
    expect(skillTest([])).toBeNull()
    expect(skillTest([0.9, 0.9, 0.9, 0.9])).toBeNull()
    // nulls (rounds without a luck test) don't count
    expect(skillTest([0.9, null, 0.9, 0.9, undefined, 0.9])).toBeNull()
    expect(skillTest([0.9, 0.9, 0.9, 0.9, 0.9])).not.toBeNull()
  })

  it('gives probability one half when every round sits in the middle', () => {
    const r = skillTest([0.5, 0.5, 0.5, 0.5, 0.5, 0.5])!
    expect(r.mean).toBe(0.5)
    expect(r.z).toBe(0)
    expect(r.pLuck).toBe(0.5)
  })

  it('computes z = (mean - 0.5) * sqrt(12N) and 1 - Φ(z)', () => {
    const five = skillTest([0.7, 0.7, 0.7, 0.7, 0.7])!
    expect(five.n).toBe(5)
    expect(five.z).toBeCloseTo(0.2 * Math.sqrt(60), 9) // 1.5492
    expect(five.pLuck).toBeCloseTo(0.0606676, 5)

    const ten = skillTest(new Array(10).fill(0.8))!
    expect(ten.z).toBeCloseTo(3.2863353, 6)
    expect(ten.pLuck).toBeCloseTo(0.0005075, 6)

    const eight = skillTest(new Array(8).fill(0.6))!
    expect(eight.z).toBeCloseTo(0.9797959, 6)
    expect(eight.pLuck).toBeCloseTo(0.1635934, 5)
  })

  it('is symmetric below the middle', () => {
    const low = skillTest([0.3, 0.3, 0.3, 0.3, 0.3])!
    expect(low.z).toBeCloseTo(-1.5491933, 6)
    expect(low.pLuck).toBeCloseTo(1 - 0.0606676, 5)
  })

  it('uses only the newest ten rounds', () => {
    expect(SKILL_WINDOW).toBe(10)
    const old = new Array(20).fill(0)
    const recent = new Array(10).fill(0.8)
    const r = skillTest([...old, ...recent])!
    expect(r.n).toBe(10)
    expect(r.mean).toBeCloseTo(0.8, 12)
  })

  it('drops values outside 0..1', () => {
    expect(skillTest([0.5, 0.5, 0.5, 0.5, 2, Number.NaN])).toBeNull()
    expect(skillRoundsCounted([0.1, null, 0.2, undefined])).toBe(2)
  })
})

describe('skillCopy', () => {
  it('says the rank and how unlikely luck is, never "skill"', () => {
    const c = skillCopy(skillTest([0.7, 0.7, 0.7, 0.7, 0.7])!)
    expect(c.headline).toBe('최근 5판 평균, 무작위 배치보다 상위 30%')
    expect(c.line).toBe('운만으로 이런 평균이 나올 확률 약 6%.')
    expect(`${c.headline}${c.line}`).not.toContain('실력이 있')
  })

  it('reads 하위 below the middle and bounds tiny probabilities', () => {
    expect(skillCopy(skillTest([0.3, 0.3, 0.3, 0.3, 0.3])!).headline).toContain('하위 30%')
    expect(skillCopy(skillTest(new Array(10).fill(0.8))!).line).toContain('1% 미만')
    expect(skillCopy(skillTest(new Array(10).fill(0.02))!).line).toContain('99% 이상')
  })
})
