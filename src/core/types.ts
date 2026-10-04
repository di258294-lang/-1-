/** Shared types that both core logic and screens depend on. */

/** How a round is being played. Long vs short lives on the Market itself. */
export type Mode = { kind: 'daily'; key: string; day: number } | { kind: 'practice' }

/** Player preferences, kept in the save file (storage.getSettings / updateSettings). */
export type Settings = {
  sound: boolean
  haptics: boolean
  /** Tap once to buy, tap again to sell, instead of press-and-hold. */
  tapToggle: boolean
}

export const DEFAULT_SETTINGS: Settings = { sound: true, haptics: true, tapToggle: false }
