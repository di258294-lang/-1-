/** Shared types that both core logic and screens depend on. */

/** How a round is being played. Long vs short lives on the Market itself. */
export type Mode = { kind: 'daily'; key: string; day: number } | { kind: 'practice' }
