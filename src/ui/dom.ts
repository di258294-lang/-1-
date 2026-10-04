import { platform } from '#platform'

export { toast } from '../platform/toast'

type Attrs = Record<string, string | number | boolean | EventListener | undefined>
type Child = Node | string | null | undefined | false

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === false) continue
      if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value)
      } else if (key === 'class') {
        el.className = String(value)
      } else {
        el.setAttribute(key, value === true ? '' : String(value))
      }
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    el.append(child)
  }
  return el
}

export function svg(markup: string) {
  const wrap = document.createElement('span')
  wrap.style.display = 'contents'
  wrap.innerHTML = markup
  return wrap
}

export const icons = {
  close:
    '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true"><path d="M5.5 5.5l11 11m0-11l-11 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
}

/**
 * A short tap through the platform (Taptic Engine / vibrator in the apps,
 * Toss haptics in the mini-app, vibrate() on the web). The number keeps the
 * old call sites working: 10+ is a press, 6-9 a release, below that a tick.
 */
export function haptic(ms = 8) {
  platform.haptic(ms >= 10 ? 'press' : ms >= 6 ? 'release' : 'tick')
}

export function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
