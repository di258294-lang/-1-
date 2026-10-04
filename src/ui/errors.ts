import type { Navigate, Screen } from './app'
import { h } from './dom'

const KEY = 'hold.errors'
const KEEP = 20

export type LoggedError = { at: string; message: string; stack?: string; where?: string }

function describe(err: unknown) {
  if (err instanceof Error) return { message: `${err.name}: ${err.message}`, stack: err.stack?.slice(0, 600) }
  try {
    return { message: typeof err === 'string' ? err : JSON.stringify(err) ?? String(err) }
  } catch {
    return { message: String(err) }
  }
}

function readErrors(): LoggedError[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Keeps the last few errors on the device, for bug reports. Never throws. */
export function logError(err: unknown, where?: string) {
  try {
    console.error(where ?? 'error', err)
    const entry: LoggedError = { at: new Date().toISOString(), ...describe(err), where }
    localStorage.setItem(KEY, JSON.stringify([...readErrors(), entry].slice(-KEEP)))
  } catch {
    // Storage full or blocked. Nothing more to do.
  }
}

let installed = false

export function installErrorHandlers() {
  if (installed) return
  installed = true
  window.addEventListener('error', (e) => {
    // A benign browser notice, not a failure: layout settled a frame later.
    if (typeof e.message === 'string' && e.message.startsWith('ResizeObserver loop')) return
    logError(e.error ?? e.message, 'window.error')
  })
  window.addEventListener('unhandledrejection', (e) => logError(e.reason, 'unhandledrejection'))
}

/** Times the error screen was shown this session. */
let errorScreens = 0

/**
 * Shown when a screen fails to build, so the app is never left blank. From
 * the second time on (home itself may be what fails), it offers a reload
 * instead of another trip home.
 */
export function errorScreen(go: Navigate): Screen {
  const again = ++errorScreens > 1
  return {
    el: h(
      'main',
      { class: 'screen' },
      h('h1', { class: 'result-grade' }, '문제가 생겼어요'),
      h(
        'p',
        { class: 'result-line' },
        again
          ? '다시 불러와도 계속되면 앱을 완전히 닫았다가 열어 주세요. 지난 기록은 그대로 있어요.'
          : '홈으로 돌아가서 다시 해 주세요. 지난 기록은 그대로 있어요.',
      ),
      h(
        'div',
        { class: 'home-actions' },
        again
          ? h('button', { class: 'btn btn-primary', onclick: () => location.reload() }, '다시 불러오기')
          : h('button', { class: 'btn btn-primary', onclick: () => go({ name: 'home' }) }, '홈으로'),
      ),
    ),
  }
}
