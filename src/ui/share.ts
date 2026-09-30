import type { Market } from '../core/market'
import { shareText } from '../core/share'
import { toast } from './dom'

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
    url: location.origin,
  })
  try {
    if (navigator.share) {
      await navigator.share({ text })
      return
    }
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') return
  }
  try {
    await navigator.clipboard.writeText(text)
    toast('결과를 복사했어요')
  } catch {
    toast('복사하지 못했어요')
  }
}
