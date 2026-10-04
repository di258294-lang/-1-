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

/**
 * A shared ranking run by the platform (Toss game center). The game only
 * hands it a number and opens its screen; it never sees other players or
 * any identifier, and nothing in the game depends on a rank.
 */
export interface PlatformLeaderboard {
  /**
   * Whether this shell can submit and open the board right now (bridge
   * present, app version new enough). Never throws.
   */
  supported(): boolean
  /**
   * Submit one score (a finite integer). Resolves with what the board said:
   * 'ok', 'no-profile' (the player has no game profile yet; worth one more
   * try after the board was opened), or 'failed' (unsupported, not set up,
   * rejected). Never rejects.
   */
  submit(score: number): Promise<'ok' | 'no-profile' | 'failed'>
  /** Open the platform's ranking screen. Resolves false when it could not. Never rejects. */
  open(): Promise<boolean>
}

/** Times are local wall-clock Dates; each one fires once. */
export interface PlatformReminders {
  /**
   * The OS permission, asking for it when it was never asked. Call only from
   * a user's own action (turning the reminder on). Never rejects.
   */
  ensurePermission(): Promise<'granted' | 'denied'>
  /**
   * Replace every reminder this game scheduled with one per given time.
   * Rejects when the OS refused to schedule.
   */
  replace(times: Date[], title: string, body: string): Promise<void>
  /** Cancel every reminder this game scheduled. Never rejects. */
  cancelAll(): Promise<void>
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
  /** The Toss game leaderboard; null where there is none (web, Capacitor). */
  readonly leaderboard: PlatformLeaderboard | null
  /** Local daily reminders (Capacitor apps only); null where there are none. */
  readonly reminders: PlatformReminders | null
  /**
   * The store's own review prompt (Play In-App Review, SKStoreReviewController,
   * Toss Review.request); null where there is none. The OS decides whether it
   * shows at all, and the game never learns the outcome. Never rejects.
   */
  readonly requestReview: (() => Promise<void>) | null
}
