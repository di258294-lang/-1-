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

export function haptic(ms = 8) {
  try {
    navigator.vibrate?.(ms)
  } catch {
    // Not supported. Fine.
  }
}

let toastEl: HTMLElement | null = null
let toastTimer = 0

export function toast(message: string) {
  if (!toastEl) {
    toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' })
    document.body.append(toastEl)
  }
  toastEl.textContent = message
  toastEl.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toastEl?.classList.remove('show'), 1800)
}

export function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
