/** Shared types that both core logic and screens depend on. */

/**
 * How a round is being played. Long vs short lives on the Market itself.
 * `replayOf` (a past daily's date key) marks a replay of a known chart: it is
 * played like practice but leaves no habit, luck, unlock or mission trace.
 */
export type Mode = { kind: 'daily'; key: string; day: number } | { kind: 'practice'; replayOf?: string }

/** Player preferences, kept in the save file (storage.getSettings / updateSettings). */
export type Settings = {
  sound: boolean
  haptics: boolean
  /** Tap once to buy, tap again to sell, instead of press-and-hold. */
  tapToggle: boolean
  /** The name put on challenge links ('' for none); always passes challenge.cleanName. */
  nick: string
}

/** The on/off settings (the switches in the settings sheet). */
export type ToggleKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings]

export const TOGGLE_KEYS: readonly ToggleKey[] = ['sound', 'haptics', 'tapToggle']

export const DEFAULT_SETTINGS: Settings = { sound: true, haptics: true, tapToggle: false, nick: '' }
