import { platform } from '#platform'
import { save } from '../core/storage'

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
  /** Settings: three sliders, plainer than a gear. */
  settings:
    '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true"><path d="M4 6h14M4 11h14M4 16h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="6" r="2.2" style="fill:var(--canvas)" stroke="currentColor" stroke-width="1.8"/><circle cx="14" cy="11" r="2.2" style="fill:var(--canvas)" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="16" r="2.2" style="fill:var(--canvas)" stroke="currentColor" stroke-width="1.8"/></svg>',
}

/**
 * A short tap through the platform (Taptic Engine / vibrator in the apps,
 * Toss haptics in the mini-app, vibrate() on the web). The number keeps the
 * old call sites working: 10+ is a press, 6-9 a release, below that a tick.
 */
export function haptic(ms = 8) {
  if (!hapticsOn()) return
  platform.haptic(ms >= 10 ? 'press' : ms >= 6 ? 'release' : 'tick')
}

/** settings.haptics, read fresh so a change in the settings sheet applies at once. */
function hapticsOn() {
  try {
    return save.getSettings().haptics
  } catch {
    return true
  }
}

export function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/**
 * One quiet line when the save can't be written (QA #3): the browser's
 * storage is full or blocked, or the save came from a newer version.
 */
export function storageWarning(): HTMLElement | null {
  try {
    if (!save.lastWriteFailed() && !save.readOnly()) return null
  } catch {
    // Can't even ask: say so.
  }
  return h('p', { class: 'fine storage-warn', role: 'status' }, '기록이 저장되지 않고 있어요. 브라우저 저장 공간을 확인해 주세요.')
}
