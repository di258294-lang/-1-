import { h } from './dom'

let region: HTMLElement | null = null
let pending = 0

/** Reads a short message to screen readers without moving focus. */
export function announce(message: string) {
  if (!region || !region.isConnected) {
    region = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' })
    document.body.append(region)
  }
  // Clearing first makes the same message ("샀어요") get read again.
  region.textContent = ''
  const el = region
  clearTimeout(pending)
  pending = window.setTimeout(() => {
    el.textContent = message
  }, 50)
}

/** Empties the live region, so a new screen never inherits the last one's message (ux2 P1-11). */
export function clearAnnouncements() {
  clearTimeout(pending)
  if (region) region.textContent = ''
}
