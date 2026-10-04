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
 * The card is recomputed after every round over an overlapping window, so a
 * player looks many times. Under pure luck the 95th percentile of the
 * largest z over looks at rounds 5..50 is about 2.76 (stats audit §2); the
 * chance line only appears at z ≥ 2.9, which random players reach about 4%
 * of the time over 50 rounds instead of 53% with a one-look 5% cut.
 */
export const SKILL_Z_SHOW = 2.9
/**
 * True when the records card shows its chance line. The habits type 기계형
 * uses this too, so the two screens never disagree about timing.
 */
export const showsChance = (r: SkillResult | null): boolean => r !== null && r.z >= SKILL_Z_SHOW

/** One-sided 90% band for the mean percentile: ±1.645·√(1/(12n)). */
export const SKILL_BAND_Z = 1.645

export const skillBand = (n: number) => SKILL_BAND_Z * Math.sqrt(1 / (12 * n))

export type SkillCopy = {
  headline: string
  line: string
  /** Always shown: what the comparison is not. */
  caveat: string
  /** True when the chance line (z ≥ SKILL_Z_SHOW) is shown instead of the range. */
  showsChance: boolean
}

const pct = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 100)

/**
 * Screen copy, kept here so it is tested with the numbers. Frequency wording
 * only, never P(skill): the mean rank against random placements of the
 * player's own holds, the range that rank could easily be in, and the chance
 * line only when it survives the repeated looks.
 */
export function skillCopy(r: SkillResult): SkillCopy {
  const caveat = '작은 수익에서 바로 파는 방식은 이 비교에서 높게 나오기 쉬워요. 실력을 재는 점수가 아니에요.'
  const headline = `최근 ${r.n}판 평균, 아무 때나 누른 판보다 잘한 비율 ${pct(r.mean)}%`
  if (showsChance(r)) {
    const p = r.pLuck * 100
    const chance = p < 1 ? '1% 미만이에요' : `약 ${Math.round(p)}%예요`
    return {
      headline,
      line: `아무렇게나 누른 가상 플레이어가 최근 ${r.n}판 평균으로 이만큼 이상 낸 경우는 ${chance}. 자주 확인하면 우연히 낮게 나오는 때도 있어요.`,
      caveat,
      showsChance: true,
    }
  }
  const band = skillBand(r.n)
  const lo = pct(r.mean - band)
  const hi = pct(r.mean + band)
  const range = `판마다 흔들림이 커서 ${lo}~${hi}% 어딘가로 봐야 해요.`
  const line =
    r.mean - band > 0.5
      ? `${range} 50%보다 높아 보이지만, 자주 확인하다 보면 우연히 이 정도가 나오는 때도 있어서 아직 단정하지 않아요.`
      : r.mean + band < 0.5
        ? `${range} 같은 길이로 아무 때나 누른 판이 더 나았던 경우가 많았어요.`
        : `${range} 50%가 이 안에 있어서, 아무 때나 누른 것과 아직 구별되지 않아요.`
  return { headline, line, caveat, showsChance: false }
}
