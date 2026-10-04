import { cleanName } from '../core/challenge'

/**
 * TEMPORARY SHIM, delete at integration.
 *
 * Team B is adding these to the real store (src/core/storage.ts):
 *   save.getSettings().nick / save.updateSettings({ nick })
 *   save.pendingChallenge() / save.setPendingChallenge(code)
 * Until that lands, this object answers the same calls over localStorage.
 * Callers only ever write `pendingSave.<method>`, so the swap is one line:
 * replace the body of this file with
 *   export { save as pendingSave } from '../core/storage'
 * (or point each import at `save` from '../core/storage').
 */

/** The pre-settings nickname key; Team B's migration should read it once. */
const NICK_KEY = 'hold.nick'
const PENDING_KEY = 'hold.pendingChallenge'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null || value === '') localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Private mode: just not remembered.
  }
}

export const pendingSave = {
  getSettings(): { nick: string } {
    return { nick: cleanName(read(NICK_KEY)) ?? '' }
  },
  updateSettings(partial: { nick?: string }): { nick: string } {
    if (partial.nick !== undefined) write(NICK_KEY, cleanName(partial.nick))
    return pendingSave.getSettings()
  },
  pendingChallenge(): string | null {
    return read(PENDING_KEY)
  },
  setPendingChallenge(code: string | null) {
    write(PENDING_KEY, code)
  },
}
