import { describe, expect, it } from 'vitest'
import { bridgeLine, edgeParts, edgeWords, gradeLineShown, largestPart, shownGap, shownPct } from './copy'

describe('returns in words', () => {
  it('uses the rounded numbers on screen', () => {
    expect(shownPct(-0.0004)).toBe(0)
    expect(shownPct(0.0749)).toBe(7.5)
    // 나 -0.7% · 시장 0.0%: the gap is 0.7, not the raw 0.66.
    expect(shownGap(-0.0071, -0.0004)).toBe('0.7%')
  })

  it('says each case plainly', () => {
    expect(edgeWords(0.018, 0.08)).toBe('그냥 들고 있기보다 6.2% 덜 벌었어요')
    expect(edgeWords(0.05, 0.01)).toBe('그냥 들고 있기보다 4.0% 더 벌었어요')
    expect(edgeWords(-0.01, -0.05)).toBe('그냥 들고 있기보다 4.0% 덜 잃었어요')
    expect(edgeWords(-0.05, -0.01)).toBe('그냥 들고 있기보다 4.0% 더 잃었어요')
    expect(edgeWords(-0.02, 0.03)).toBe('그냥 들고 있기보다 5.0% 뒤졌어요')
    expect(edgeWords(0.02, -0.03)).toBe('그냥 들고 있기보다 5.0% 앞섰어요')
    expect(edgeWords(0.0301, 0.0299)).toBe('그냥 들고 있기와 같았어요')
    expect(edgeWords(-0.0071, -0.0004)).toBe('시장은 그대로였는데 0.7% 잃었어요')
    expect(edgeWords(0.012, 0.0002)).toBe('시장은 그대로였는데 1.2% 벌었어요')
  })

  it('fixes the gap in a grade line and handles a market at 0.0', () => {
    // Where raw and rounded agree, the line is left alone.
    const you = 0.01849
    const bh = 0.08049
    const raw = `${Math.abs((you - bh) * 100).toFixed(1)}%`
    expect(raw).toBe('6.2%')
    expect(shownGap(you, bh)).toBe('6.2%')
    const line = `그냥 들고 있었으면 ${raw} 더 벌었어요.`
    expect(gradeLineShown(line, you, bh)).toBe(line)
    expect(gradeLineShown('그냥 들고 있었으면 0.6% 덜 잃었어요.', -0.0071, -0.0004)).toBe('시장은 그대로였는데 0.7% 잃었어요.')
    expect(gradeLineShown('그냥 들고 있었으면 0.5% 더 벌었어요.', 0.0144, 0.0196)).toBe('그냥 들고 있었으면 0.6% 더 벌었어요.')
  })
})

describe('bridge line (stats2 §5)', () => {
  const base = { cashReturn: 0.0001, startEquity: 10_000_000 }

  it('splits the edge into parts that add up', () => {
    const r = { ...base, yourReturn: 0.01, buyHoldReturn: 0.05, heldRatio: 0.4, fees: 50_000 }
    const p = edgeParts(r)
    expect(p.exposure + p.fees + p.timing).toBeCloseTo(r.yourReturn - r.buyHoldReturn, 12)
    expect(p.exposure).toBeCloseTo(-0.6 * 0.05 + 0.6 * 0.0001, 12)
    expect(p.fees).toBeCloseTo(-0.005, 12)
  })

  it('only blames holding time when exposure is the largest part', () => {
    // Held 30% of a +6% market, few fees: exposure dominates.
    const short = { ...base, yourReturn: 0.03, buyHoldReturn: 0.06, heldRatio: 0.3, fees: 20_000 }
    expect(largestPart(edgeParts(short))).toBe('exposure')
    expect(bridgeLine(short, 0.9)).toContain('들고 있던 시간이 짧아')
    // Held 80%, but 30 trades of fees: fees dominate.
    const churn = { ...base, yourReturn: 0.0, buyHoldReturn: 0.01, heldRatio: 0.8, fees: 300_000 }
    expect(largestPart(edgeParts(churn))).toBe('fees')
    expect(bridgeLine(churn, 0.85)).toContain('수수료')
    expect(bridgeLine(churn, 0.85)).not.toContain('들고 있던 시간이 짧아')
  })

  it('stays quiet when the grade and the comparison agree', () => {
    expect(bridgeLine({ ...base, yourReturn: 0.05, buyHoldReturn: 0.01, heldRatio: 0.5, fees: 0 }, 0.9)).toBeNull()
    expect(bridgeLine({ ...base, yourReturn: 0.0, buyHoldReturn: 0.05, heldRatio: 0.5, fees: 0 }, 0.3)).toBeNull()
  })
})
