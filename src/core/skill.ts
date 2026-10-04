/**
 * Cumulative skill test over several rounds.
 *
 * Each round's luck test (luck.ts) gives a percentile: the share of random
 * traders with the player's own style (same trade count and time in the
 * market) who did worse on the same chart. If timing were pure luck, that
 * percentile would be about Uniform(0, 1) on every round, independently.
 *
 * The mean of N such percentiles then has mean 1/2 and variance 1/(12N), so
 *   z = (p̄ - 0.5) · √(12N)
 * is close to standard normal under luck (the CLT is already good at N = 5
 * for uniforms). The one-sided probability that luck alone gives a mean at
 * least this high is 1 - Φ(z).
 *
 * It compares against random placement of the player's own trades, not
 * against the market or other players, and it never claims skill: it only
 * says how unlikely luck alone would be.
 */

/** Rounds used, newest first: older habits shouldn't drown out recent ones. */
export const SKILL_WINDOW = 10
/** Below this, one lucky round swings the mean too much to say anything. */
export const SKILL_MIN_ROUNDS = 5

export type SkillResult = {
  /** Rounds used (SKILL_MIN_ROUNDS..SKILL_WINDOW). */
  n: number
  /** Mean luck percentile, 0..1. */
  mean: number
  z: number
  /** One-sided probability of a mean at least this high under pure luck, 0..1. */
  pLuck: number
}

/**
 * erf by Abramowitz & Stegun 7.1.26 (absolute error below 1.5e-7), which is
 * far finer than the rounding the screen shows.
 */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const a = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * a)
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
  return sign * (1 - poly * Math.exp(-a * a))
}

/** Standard normal CDF Φ. */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2))
}

/**
 * `percentiles` oldest first, as habitRecords() stores them; null entries
 * (no luck test) are skipped. Returns null below SKILL_MIN_ROUNDS.
 */
export function skillTest(
  percentiles: ReadonlyArray<number | null | undefined>,
  window = SKILL_WINDOW,
  min = SKILL_MIN_ROUNDS,
): SkillResult | null {
  const ps = percentiles
    .filter((p): p is number => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1)
    .slice(-window)
  const n = ps.length
  if (n < min) return null
  const mean = ps.reduce((a, b) => a + b, 0) / n
  const z = (mean - 0.5) * Math.sqrt(12 * n)
  // Clamp the tiny erf error so 0.5 in gives exactly 0.5 out.
  const pLuck = Math.min(1, Math.max(0, z === 0 ? 0.5 : 1 - normalCdf(z)))
  return { n, mean, z, pLuck }
}

/** Luck-tested rounds so far, for the "N판 더 하면" line. */
export function skillRoundsCounted(percentiles: ReadonlyArray<number | null | undefined>): number {
  return percentiles.filter((p) => typeof p === 'number' && Number.isFinite(p)).length
}

/**
 * Screen copy, kept here so it is tested with the numbers. "상위 X%" is the
 * share of random placements that did at least as well; below the middle it
 * reads "하위" instead.
 */
export function skillCopy(r: SkillResult) {
  const above = r.mean >= 0.5
  const rank = Math.max(1, Math.round((above ? 1 - r.mean : r.mean) * 100))
  const p = r.pLuck * 100
  const chance = p < 1 ? '1% 미만' : p > 99 ? '99% 이상' : `약 ${Math.round(p)}%`
  return {
    headline: `최근 ${r.n}판 평균, 무작위 배치보다 ${above ? '상위' : '하위'} ${rank}%`,
    line: `운만으로 이런 평균이 나올 확률 ${chance}.`,
  }
}
