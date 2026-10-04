/**
 * Everything the game needs from the shell it runs in: the browser, the
 * Capacitor apps (iOS/Android), or the Toss app (Apps in Toss mini-app).
 *
 * Import the active implementation from '#platform'. Vite points that alias
 * at toss.ts for `--mode toss` builds and at web.ts otherwise, so the Toss
 * SDK never reaches the web or Capacitor bundles.
 */
export type HapticKind = 'press' | 'release' | 'tick'

export interface PlatformStorage {
  get(key: string): Promise<string | null>
  /** Rejects when the value could not be stored anywhere. */
  set(key: string, value: string): Promise<void>
}

export interface Platform {
  readonly kind: 'web' | 'capacitor' | 'toss'
  /** Run once before the first render. Never rejects. */
  init(): Promise<void>
  /** Fire-and-forget; silently does nothing where unsupported. */
  haptic(kind: HapticKind): void
  /**
   * Share text through the system share sheet. Falls back to the clipboard
   * (with a toast) when no share sheet exists. Never rejects; a cancelled
   * share sheet is not an error.
   */
  share(text: string): Promise<void>
  /**
   * The link that opens the game, for share texts. `query` (already
   * URL-encoded, e.g. "c=AbC") is carried into the opened page's
   * location.search, which on Toss means building the deep link with it.
   */
  shareUrl(query?: string): Promise<string>
  storage: PlatformStorage
  /**
   * Open an outside page (absolute URL) in the system browser, never in the
   * game's own WebView. Resolves false when nothing could open it.
   */
  openUrl(url: string): Promise<boolean>
  /**
   * A link that opens the app while it is already running (Capacitor
   * appUrlOpen). The handler gets the full URL. Returns an unsubscribe function.
   */
  onOpenUrl(handler: (url: string) => void): () => void
  /**
   * Take over the system back action (Android back button, Toss back event).
   * While a handler is registered the default back behavior is blocked, so
   * the handler must navigate back or exit. Returns an unsubscribe function.
   */
  onBack(handler: () => void): () => void
  /** Leave the game (close the mini-app / app; on the web, go back past the game). */
  exit(): Promise<void>
  /** iOS edge swipe back. Turn off during a round so a swipe cannot quit it. */
  setSwipeBack(on: boolean): void
}
