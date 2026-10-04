import { platform } from '#platform'
import type { Market } from '../core/market'
import { shareText } from '../core/share'

/**
 * The game's public link. Not location.origin: that drops the GitHub Pages
 * sub-path on the web and is capacitor://localhost or https://localhost in
 * the apps. The Toss build returns a toss.im link to the mini-app.
 */
export const shareUrl = () => platform.shareUrl()

export async function shareResult(opts: {
  market: Market
  yourReturn: number
  buyHoldReturn: number
  held: boolean[]
  day: number | null
  key?: string
}) {
  const text = shareText({
    market: opts.market,
    result: { yourReturn: opts.yourReturn, buyHoldReturn: opts.buyHoldReturn, held: opts.held },
    day: opts.day,
    url: await shareUrl(),
  })
  await shareOut(text)
}

/** Share sheet when available, otherwise copy to the clipboard with a toast. */
export function shareOut(text: string) {
  return platform.share(text)
}
