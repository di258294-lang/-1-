import { platform } from '#platform'
import { CHALLENGE_PARAM, cleanName, encodeChallenge, type Challenge } from '../core/challenge'
import type { Market } from '../core/market'
import { roundShareText } from '../core/share'
import { logError } from './errors'
import { pendingSave } from './pending-shim'

/**
 * The game's public link. Not location.origin: that drops the GitHub Pages
 * sub-path on the web and is capacitor://localhost or https://localhost in
 * the apps. The Toss build returns a toss.im link to the mini-app.
 */
export const shareUrl = () => platform.shareUrl()

/** The saved nickname for challenge links ('' when none). */
export function savedNick(): string {
  try {
    return cleanName(pendingSave.getSettings().nick) ?? ''
  } catch {
    return ''
  }
}

export function rememberNick(name: string | null) {
  try {
    pendingSave.updateSettings({ nick: name ?? '' })
  } catch {
    // Not remembered; the link still goes out.
  }
}

/**
 * The link with this chart in it (?c=), so every share is a challenge
 * (ux2 P1-10). Falls back to the plain game link when the round can't travel.
 */
export async function challengeShareUrl(c: Challenge | null): Promise<string> {
  if (c) {
    try {
      return await platform.shareUrl(`${CHALLENGE_PARAM}=${encodeChallenge(c)}`)
    } catch (err) {
      logError(err, 'challengeShareUrl')
    }
  }
  return shareUrl()
}

/**
 * Home's "결과 공유하기" for today's finished chart: spoiler-free, with the
 * challenge link (the saved nickname rides along when there is one).
 */
export async function shareResult(opts: {
  market: Market
  yourReturn: number
  buyHoldReturn: number
  held: boolean[]
  day: number | null
  streak?: number
}) {
  const { market } = opts
  const c: Challenge = {
    seed: market.seed,
    product: market.product,
    length: market.length,
    ret: opts.yourReturn,
    day: opts.day,
    luck: null,
    name: savedNick() || null,
  }
  const text = roundShareText({
    market,
    result: { yourReturn: opts.yourReturn, buyHoldReturn: opts.buyHoldReturn, held: opts.held },
    day: opts.day,
    url: await challengeShareUrl(c),
    streak: opts.streak,
  })
  await shareOut(text)
}

/** Share sheet when available, otherwise copy to the clipboard with a toast. */
export function shareOut(text: string) {
  return platform.share(text)
}
