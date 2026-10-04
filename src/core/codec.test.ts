import { describe, expect, it } from 'vitest'
import { decodeHeld, encodeHeld } from './codec'
import { createRng } from './rng'

describe('held codec', () => {
  it('round-trips empty, all-false and all-true arrays', () => {
    for (const arr of [[], new Array(400).fill(false), new Array(400).fill(true), [true], [false]]) {
      expect(decodeHeld(encodeHeld(arr))).toEqual(arr)
    }
    expect(encodeHeld([])).toBe('')
    expect(encodeHeld([true, true])).toBe('0.2')
    expect(encodeHeld([false, false, true, true, true, false])).toBe('2.3.1')
  })

  it('round-trips random arrays of any density', () => {
    const rng = createRng(2026)
    for (let i = 0; i < 300; i++) {
      const len = Math.floor(rng.next() * 1200)
      const p = rng.next()
      const stickiness = rng.next()
      const arr: boolean[] = []
      let v = rng.next() < p
      for (let t = 0; t < len; t++) {
        if (rng.next() > stickiness) v = rng.next() < p
        arr.push(v)
      }
      expect(decodeHeld(encodeHeld(arr))).toEqual(arr)
    }
  })

  it('is far smaller than JSON for a typical round', () => {
    const held = new Array(400).fill(false)
    for (let t = 50; t < 120; t++) held[t] = true
    for (let t = 200; t < 330; t++) held[t] = true
    expect(encodeHeld(held).length).toBeLessThan(20)
    expect(JSON.stringify(held).length).toBeGreaterThan(2000)
  })

  it('rejects malformed codes', () => {
    for (const bad of ['x!', '1..2', '.1', '1.', '-1', ' 1', 'zzzzzzzzzzzz']) {
      expect(decodeHeld(bad)).toBeNull()
    }
  })
})
