import { describe, expect, it } from 'vitest'
import { createRng } from './rng'
import { erf, normalCdf, skillBand, skillCopy, skillRoundsCounted, skillTest, SKILL_MIN_ROUNDS, SKILL_WINDOW, SKILL_Z_SHOW } from './skill'

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
  it('shows the mean rank with its range below z = 2.9, and no chance line', () => {
    const r = skillTest([0.7, 0.7, 0.7, 0.7, 0.7])! // z = 1.55
    const c = skillCopy(r)
    expect(c.showsChance).toBe(false)
    expect(c.headline).toBe('최근 5판 평균, 아무 때나 누른 판보다 잘한 비율 70%')
    // ±1.645·√(1/60) = ±0.212
    expect(c.line).toContain('49~91%')
    expect(c.line).toContain('구별되지 않아요')
    expect(c.line).not.toMatch(/확률|경우는 약/)
    expect(skillBand(10)).toBeCloseTo(0.15, 2)
  })

  it('does not call a mean above the band proof while z < 2.9', () => {
    const c = skillCopy(skillTest(new Array(10).fill(0.7))!) // z = 2.19
    expect(c.showsChance).toBe(false)
    expect(c.line).toContain('아직 단정하지 않아요')
  })

  it('shows the frequency line only at z >= 2.9, with the repeated-looks caveat', () => {
    const c = skillCopy(skillTest(new Array(10).fill(0.8))!) // z = 3.29
    expect(c.showsChance).toBe(true)
    expect(c.line).toBe('아무렇게나 누른 가상 플레이어가 최근 10판 평균으로 이만큼 이상 낸 경우는 1% 미만이에요. 자주 확인하면 우연히 낮게 나오는 때도 있어요.')
    expect(SKILL_Z_SHOW).toBe(2.9)
  })

  it('always carries the caveat and never claims skill', () => {
    for (const ps of [[0.3, 0.3, 0.3, 0.3, 0.3], new Array(10).fill(0.8), new Array(10).fill(0.02)]) {
      const c = skillCopy(skillTest(ps)!)
      expect(c.caveat).toContain('작은 수익에서 바로 파는 방식은 이 비교에서 높게 나오기 쉬워요')
      expect(`${c.headline}${c.line}${c.caveat}`).not.toMatch(/실력이 있|운만으로 이런|실력일/)
    }
    expect(skillCopy(skillTest(new Array(10).fill(0.02))!).line).toContain('더 나았던 경우가 많았어요')
  })

  it('keeps pure luck under the chance line in at most 5% of players over 50 looks', () => {
    // Uniform percentiles, looks after every round from 5 to 50, as the card does.
    const rng = createRng(2026)
    let ever = 0
    const P = 2000
    for (let p = 0; p < P; p++) {
      const ps: number[] = []
      let hit = false
      for (let r = 1; r <= 50 && !hit; r++) {
        ps.push(rng.next())
        const s = skillTest(ps)
        if (s && skillCopy(s).showsChance) hit = true
      }
      if (hit) ever++
    }
    expect(ever / P).toBeLessThan(0.06)
  })
})
