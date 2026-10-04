import { h } from './dom'

type OpenSheet = {
  scrim: HTMLElement
  /** Called when the sheet is dismissed (Esc, back, scrim tap), not on removal by navigation. */
  onDismiss?: () => void
  returnFocus: HTMLElement | null
}

/** Open sheets, topmost last. Sheets live on body, outside the screen root. */
const stack: OpenSheet[] = []

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

function onKey(e: KeyboardEvent) {
  const top = stack[stack.length - 1]
  if (!top) return
  if (e.key === 'Escape') {
    e.preventDefault()
    closeTopSheet()
    return
  }
  if (e.key !== 'Tab') return
  // Keep focus inside the top sheet.
  const items = [...top.scrim.querySelectorAll<HTMLElement>(FOCUSABLE)]
  if (items.length === 0) {
    e.preventDefault()
    return
  }
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  if (e.shiftKey && (active === first || !top.scrim.contains(active))) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (active === last || !top.scrim.contains(active))) {
    e.preventDefault()
    first.focus()
  }
}

let listening = false

/**
 * Shows a sheet and registers it, so navigation, Esc and the platform back
 * button can close it. Returns a function that closes it without onDismiss.
 */
export function openSheet(
  scrim: HTMLElement,
  opts: { onDismiss?: () => void; initialFocus?: HTMLElement | null; returnFocus?: HTMLElement | null } = {},
) {
  if (!listening) {
    window.addEventListener('keydown', onKey)
    listening = true
  }
  const active = document.activeElement
  const entry: OpenSheet = {
    scrim,
    onDismiss: opts.onDismiss,
    returnFocus: opts.returnFocus ?? (active instanceof HTMLElement && active !== document.body ? active : null),
  }
  stack.push(entry)
  document.body.append(scrim)
  const target = opts.initialFocus ?? scrim.querySelector<HTMLElement>(FOCUSABLE)
  target?.focus({ preventScroll: true })
  return () => removeSheet(entry, true)
}

function removeSheet(entry: OpenSheet, restoreFocus: boolean) {
  const i = stack.indexOf(entry)
  if (i < 0) return false
  stack.splice(i, 1)
  entry.scrim.remove()
  if (restoreFocus && entry.returnFocus?.isConnected) entry.returnFocus.focus({ preventScroll: true })
  return true
}

export function anySheetOpen() {
  return stack.length > 0
}

/** Dismisses the topmost sheet as if cancelled. False when none is open. */
export function closeTopSheet(): boolean {
  const top = stack[stack.length - 1]
  if (!top) return false
  removeSheet(top, true)
  top.onDismiss?.()
  return true
}

/** Removes every sheet without callbacks. The router calls this before each screen. */
export function closeAllSheets() {
  while (stack.length) removeSheet(stack[stack.length - 1], false)
}

export function confirmSheet(opts: {
  title: string
  body: string
  confirm: string
  cancel: string
  onConfirm: () => void
  onCancel: () => void
  /** Where focus goes when the sheet closes; defaults to the element that opened it. */
  returnFocus?: HTMLElement | null
}) {
  let close = () => {}
  const done = (fn: () => void) => () => {
    close()
    fn()
  }
  const cancelBtn = h('button', { class: 'btn btn-primary', onclick: done(opts.onCancel) }, opts.cancel)
  const scrim = h(
    'div',
    { class: 'sheet-scrim', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'confirm-title', 'aria-describedby': 'confirm-body' },
    h(
      'div',
      { class: 'sheet' },
      h('h2', { id: 'confirm-title' }, opts.title),
      h('p', { class: 'sheet-body', id: 'confirm-body' }, opts.body),
      h(
        'div',
        { class: 'sheet-actions' },
        h('button', { class: 'btn btn-quiet', onclick: done(opts.onConfirm) }, opts.confirm),
        cancelBtn,
      ),
    ),
  )
  // The safe choice gets focus, so a stray Enter or Space keeps playing.
  close = openSheet(scrim, { onDismiss: opts.onCancel, initialFocus: cancelBtn, returnFocus: opts.returnFocus })
}
