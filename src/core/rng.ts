/** Small, fast, deterministic PRNG. Same seed, same chart, on every device. */
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

export function createRng(seed: number): Rng {
  let a = seed >>> 0
  let spare: number | null = null

  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

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
