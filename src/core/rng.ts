/** Small, fast, deterministic PRNGs. Same seed, same chart, on every device. */
export type Rng = {
  next(): number
  range(min: number, max: number): number
  int(min: number, maxInclusive: number): number
  gauss(): number
  pick<T>(items: readonly T[]): T
  chance(p: number): boolean
}

export function hashString(input: string): number {
  // FNV-1a, 32 bit
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Wraps a uniform [0, 1) source with the helpers the game uses. */
function wrap(next: () => number): Rng {
  let spare: number | null = null
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    gauss() {
      if (spare !== null) {
        const s = spare
        spare = null
        return s
      }
      let u = 0
      let v = 0
      while (u === 0) u = next()
      while (v === 0) v = next()
      const mag = Math.sqrt(-2 * Math.log(u))
      spare = mag * Math.sin(2 * Math.PI * v)
      return mag * Math.cos(2 * Math.PI * v)
    },
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (p) => next() < p,
  }
}

/** mulberry32: the market generator. Its output must never change (charts are keyed by seed). */
export function createRng(seed: number): Rng {
  let a = seed >>> 0
  return wrap(() => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  })
}

/** splitmix32: turns one 32-bit seed into a stream of well-mixed 32-bit words. */
export function splitmix32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x9e3779b9) | 0
    let t = a ^ (a >>> 16)
    t = Math.imul(t, 0x21f0aaad)
    t ^= t >>> 15
    t = Math.imul(t, 0x735a2d97)
    t ^= t >>> 15
    return t >>> 0
  }
}

/**
 * sfc32 (Small Fast Chaotic, 128-bit state), seeded through splitmix32. A
 * different family from the market's mulberry32, so a stream drawn from it
 * (for example the luck test's random placements) can never line up with
 * the stream that drew the chart.
 */
export function createSfc32(seed: number): Rng {
  const mix = splitmix32(seed)
  let a = mix()
  let b = mix()
  let c = mix()
  let d = mix()
  const step = () => {
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return t >>> 0
  }
  for (let i = 0; i < 12; i++) step()
  return wrap(() => step() / 4294967296)
}
