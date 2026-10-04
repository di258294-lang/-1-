// Lives here rather than in ui/dom.ts so the platform layer can show the
// clipboard toast without importing the UI (ui/dom.ts re-exports it).

let toastEl: HTMLElement | null = null
let toastTimer = 0

export function toast(message: string) {
  if (!toastEl) {
    toastEl = document.createElement('div')
    toastEl.className = 'toast'
    toastEl.setAttribute('role', 'status')
    toastEl.setAttribute('aria-live', 'polite')
    document.body.append(toastEl)
  }
  toastEl.textContent = message
  toastEl.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toastEl?.classList.remove('show'), 1800)
}

/** Clipboard API first, then the legacy execCommand path for old WebViews. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Not available (insecure context, old WebView) or denied.
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
    document.body.append(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

/** Shared clipboard fallback used by every platform's share(). */
export async function copyWithToast(text: string) {
  toast((await copyText(text)) ? '결과를 복사했어요' : '복사하지 못했어요')
}
