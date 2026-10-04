/**
 * Compact on-disk codes for bulky round data.
 *
 * A daily round stores which ticks you held (400 booleans for a short round).
 * As JSON that is ~2.4 KB a day, close to 1 MB a year, and localStorage gives
 * up around 5 MB. Players press a handful of times per round, so the array is
 * a few long runs: run-length coding shrinks a typical day to ~10-30 chars.
 *
 * Format: run lengths in base 36, joined by '.', alternating not-held / held
 * and always starting with a not-held run (which may be 0).
 *   []                      -> ''
 *   [F, F, T, T, T, F]      -> '2.3.1'
 *   [T, T]                  -> '0.2'
 */

/** Runs longer than this are rejected on decode, so a corrupt code can't allocate gigabytes. */
const MAX_DECODED = 1_000_000
const CODE_RE = /^[0-9a-z]+(\.[0-9a-z]+)*$/

export function encodeHeld(held: readonly boolean[]): string {
  if (held.length === 0) return ''
  const runs: number[] = []
  let value = false
  let run = 0
  for (const h of held) {
    if (Boolean(h) === value) {
      run++
    } else {
      runs.push(run)
      value = !value
      run = 1
    }
  }
  runs.push(run)
  return runs.map((n) => n.toString(36)).join('.')
}

/** Inverse of encodeHeld. Returns null for anything that isn't a valid code. */
export function decodeHeld(code: string): boolean[] | null {
  if (code === '') return []
  if (typeof code !== 'string' || !CODE_RE.test(code)) return null
  const runs = code.split('.').map((s) => parseInt(s, 36))
  let total = 0
  for (const n of runs) {
    if (!Number.isSafeInteger(n) || n < 0) return null
    total += n
    if (total > MAX_DECODED) return null
  }
  const out = new Array<boolean>(total)
  let i = 0
  let value = false
  for (const n of runs) {
    out.fill(value, i, i + n)
    i += n
    value = !value
  }
  return out
}
