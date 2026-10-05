import { describe, expect, it } from 'vitest'
import { isOneStore, startOneStore } from './onestore'

describe('ONE store bridge', () => {
  it('turns on only for the registered ?store=onestore URL', () => {
    expect(isOneStore('?store=onestore')).toBe(true)
    expect(isOneStore('?c=abc&store=onestore')).toBe(true)
    expect(isOneStore('')).toBe(false)
    expect(isOneStore('?store=toss')).toBe(false)
  })

  it('never loads the SDK on the plain web build', () => {
    // vitest runs with no ?store param: nothing starts, nothing is fetched.
    expect(startOneStore(() => false, () => {})).toBeNull()
  })
})
