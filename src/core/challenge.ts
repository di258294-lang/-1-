import { dailySeed, keyForDay, nextKey } from './daily'

/** Kept here for older imports; the date math lives in daily.ts. */
export { keyForDay }
import { ENGINE_VERSION, type RoundLength } from './market'
import { formatPct } from './format'
import { shownPct } from './copy'
import { PRODUCTS, type ProductKey } from './products'

/**
 * Friend challenge links: "I made +4.2% on this chart, can you beat it?"
 *
 * Everything the friend needs to draw the same chart travels in the link, so
 * no server is involved: the seed, product and length (the market generator
 * is deterministic), the engine version (a new engine draws a different
 * chart from the same seed), the sender's return, the day number for a
 * daily chart, the sender's luck percentile when known, and an optional
 * short nickname. Nothing else, and nothing personal.
 *
 * Wire format, version 1, big-endian bytes then base64url:
 *   0      format version (1)
 *   1      ENGINE_VERSION
 *   2-5    seed, uint32
 *   6      product index << 1 | length (0 short, 1 long)
 *   7-10   return in basis points (0.01%), int32
 *   11-12  daily day number, uint16 (0 = not a daily)
 *   13     luck percentile 0..100, or 255 when unknown
 *   14     nickname byte length n (0..NAME_MAX_BYTES)
 *   15..   nickname, UTF-8
 *   last 3 checksum: FNV-1a over everything before it, top 24 bits
 *
 * The checksum catches truncated and hand-edited links; it is not security.
 * The link carries no state anyone could profit from forging.
 */

export const CHALLENGE_FORMAT = 1
export const CHALLENGE_PARAM = 'c'

/**
 * Append-only: the index is on the wire. Never reorder or remove, or old
 * links open the wrong product.
 */
const WIRE_PRODUCTS: readonly ProductKey[] = ['stock', 'bond', 'gold', 'coin', 'lev2']
const LENGTH_CODES: readonly RoundLength[] = ['short', 'long']

const HEADER_BYTES = 15
const CHECK_BYTES = 3
/** Nicknames: up to 8 letters, digits or spaces, at most 24 UTF-8 bytes. */
export const NAME_MAX_CHARS = 8
const NAME_MAX_BYTES = 24
/** Longest code a valid link can carry, checked before decoding anything. */
const MAX_CODE_CHARS = Math.ceil(((HEADER_BYTES + NAME_MAX_BYTES + CHECK_BYTES) * 4) / 3)
/** A player cannot lose more than everything, and +10000% is far past any real round. */
const MIN_RETURN_BP = -10_000
const MAX_RETURN_BP = 1_000_000
const MAX_DAY = 0xffff
const NO_LUCK = 255
/** Future daily seeds are guarded this many days ahead. */
const FUTURE_GUARD_DAYS = 31

export type Challenge = {
  seed: number
  product: ProductKey
  length: RoundLength
  /** Sender's return as a ratio (0.042 = +4.2%), rounded to 0.01%. */
  ret: number
  /** Daily chart number (#1 = EPOCH_KEY), or null for a practice chart. */
  day: number | null
  /** Sender's luck-test percentile 0..1 (rounded to 1%), or null. */
  luck: number | null
  /** Optional nickname, already cleaned. */
  name: string | null
}

export type DecodeResult =
  | { ok: true; challenge: Challenge }
  /** invalid: garbage, truncated, tampered or out of range. old/new: made with another engine version. */
  | { ok: false; reason: 'invalid' | 'old' | 'new' }

/** Whether a decoded challenge may be played right now. */
export type ChallengeAccess = 'ok' | 'today' | 'future'

const NAME_RE = /^[\p{L}\p{N}](?:[\p{L}\p{N} ]*[\p{L}\p{N}])?$/u

/**
 * A nickname safe to put in a link and on screen: letters, digits and single
 * spaces, at most NAME_MAX_CHARS characters. Anything else (links, symbols,
 * emoji, control characters) gives null, so nothing but a name can travel.
 */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.normalize('NFC').trim().replace(/\s+/g, ' ')
  if (!name || !NAME_RE.test(name)) return null
  if ([...name].length > NAME_MAX_CHARS) return null
  if (new TextEncoder().encode(name).length > NAME_MAX_BYTES) return null
  return name
}

function fnv1a(bytes: Uint8Array, end: number) {
  let h = 0x811c9dc5
  for (let i = 0; i < end; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function toBase64Url(bytes: Uint8Array) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(code: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(code) || code.length % 4 === 1) return null
  try {
    const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'))
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

const toBp = (ret: number) => Math.round(ret * 10_000)

/**
 * The link code for a finished round. Throws on values no real round can
 * produce (a NaN return, an unknown product), so a bug never ships a link
 * that the friend's game would reject.
 */
export function encodeChallenge(c: Challenge, engine = ENGINE_VERSION): string {
  const product = WIRE_PRODUCTS.indexOf(c.product)
  const length = LENGTH_CODES.indexOf(c.length)
  const bp = toBp(c.ret)
  if (product < 0 || length < 0) throw new Error('challenge: unknown product or length')
  if (!Number.isInteger(c.seed) || c.seed < 0 || c.seed > 0xffffffff) throw new Error('challenge: bad seed')
  if (!Number.isFinite(bp) || bp <= MIN_RETURN_BP || bp > MAX_RETURN_BP) throw new Error('challenge: return out of range')
  if (c.day !== null && (!Number.isInteger(c.day) || c.day < 1 || c.day > MAX_DAY)) throw new Error('challenge: bad day')
  const name = c.name === null ? null : cleanName(c.name)
  const nameBytes = name ? new TextEncoder().encode(name) : new Uint8Array(0)
  const luck = c.luck === null || !Number.isFinite(c.luck) ? NO_LUCK : Math.max(0, Math.min(100, Math.round(c.luck * 100)))

  const bytes = new Uint8Array(HEADER_BYTES + nameBytes.length + CHECK_BYTES)
  const view = new DataView(bytes.buffer)
  view.setUint8(0, CHALLENGE_FORMAT)
  view.setUint8(1, engine)
  view.setUint32(2, c.seed)
  view.setUint8(6, (product << 1) | length)
  view.setInt32(7, bp)
  view.setUint16(11, c.day ?? 0)
  view.setUint8(13, luck)
  view.setUint8(14, nameBytes.length)
  bytes.set(nameBytes, HEADER_BYTES)
  const end = HEADER_BYTES + nameBytes.length
  const check = fnv1a(bytes, end) >>> 8
  view.setUint8(end, check >>> 16)
  view.setUint8(end + 1, (check >>> 8) & 0xff)
  view.setUint8(end + 2, check & 0xff)
  return toBase64Url(bytes)
}

/** Inverse of encodeChallenge. Never throws: any bad input is a reason. */
export function decodeChallenge(code: unknown, engine = ENGINE_VERSION): DecodeResult {
  const bad = { ok: false, reason: 'invalid' } as const
  if (typeof code !== 'string' || code.length === 0 || code.length > MAX_CODE_CHARS) return bad
  const bytes = fromBase64Url(code)
  if (!bytes || bytes.length < HEADER_BYTES + CHECK_BYTES) return bad
  const view = new DataView(bytes.buffer)
  const nameLen = view.getUint8(14)
  const end = HEADER_BYTES + nameLen
  if (nameLen > NAME_MAX_BYTES || bytes.length !== end + CHECK_BYTES) return bad
  const check = (view.getUint8(end) << 16) | (view.getUint8(end + 1) << 8) | view.getUint8(end + 2)
  if (check !== fnv1a(bytes, end) >>> 8) return bad
  if (view.getUint8(0) !== CHALLENGE_FORMAT) return bad

  // Checked after the checksum, so a corrupted byte reads as a broken link,
  // not as a version problem.
  const linkEngine = view.getUint8(1)
  if (linkEngine !== engine) return { ok: false, reason: linkEngine < engine ? 'old' : 'new' }

  const seed = view.getUint32(2)
  const kind = view.getUint8(6)
  const product = WIRE_PRODUCTS[kind >> 1]
  const length = LENGTH_CODES[kind & 1]
  const bp = view.getInt32(7)
  const dayRaw = view.getUint16(11)
  const luckRaw = view.getUint8(13)
  if (!product) return bad
  if (bp <= MIN_RETURN_BP || bp > MAX_RETURN_BP) return bad
  if (luckRaw > 100 && luckRaw !== NO_LUCK) return bad

  let name: string | null = null
  if (nameLen > 0) {
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(HEADER_BYTES, end))
    } catch {
      return bad
    }
    name = cleanName(text)
    if (name !== text) return bad
  }

  const day = dayRaw === 0 ? null : dayRaw
  // A daily link must point at that day's real chart: the daily seed, short.
  if (day !== null && (seed !== dailySeed(keyForDay(day)) || length !== 'short')) return bad

  return {
    ok: true,
    challenge: { seed, product, length, ret: bp / 10_000, day, luck: luckRaw === NO_LUCK ? null : luckRaw / 100, name },
  }
}

/**
 * Today's daily chart stays secret until the player has played it: a
 * challenge on it (or on any chart drawn from today's daily seed, whatever
 * the link claims) waits until then. Charts from days that haven't come yet
 * are never playable.
 */
export function challengeAccess(c: Challenge, today: string, playedToday: boolean): ChallengeAccess {
  if (c.day !== null) {
    const key = keyForDay(c.day)
    if (key > today) return 'future'
    if (key === today && !playedToday) return 'today'
    return 'ok'
  }
  if (c.seed === dailySeed(today)) return playedToday ? 'ok' : 'today'
  let key = today
  for (let i = 0; i < FUTURE_GUARD_DAYS; i++) {
    key = nextKey(key)
    if (c.seed === dailySeed(key)) return 'future'
  }
  return 'ok'
}

/**
 * Takes the challenge code out of a URL. Returns the code (null when there
 * is none) and the URL to replace the current one with, so a reload does
 * not open the challenge again.
 */
export function takeChallengeCode(href: string): { code: string | null; rest: string } {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return { code: null, rest: href }
  }
  const code = url.searchParams.get(CHALLENGE_PARAM)
  if (code === null) return { code: null, rest: href }
  url.searchParams.delete(CHALLENGE_PARAM)
  return { code, rest: `${url.pathname}${url.search}${url.hash}` }
}

export type Outcome = 'win' | 'lose' | 'tie'

/**
 * Head to head at the precision the screen shows (0.1%), from the very
 * numbers formatPct prints, so "-1.3% vs -1.3%" is always a tie.
 */
export function outcome(you: number, friend: number): { result: Outcome; gap: number } {
  const a = Math.round(shownPct(you) * 10)
  const b = Math.round(shownPct(friend) * 10)
  return { result: a > b ? 'win' : a < b ? 'lose' : 'tie', gap: Math.abs(a - b) / 1000 }
}

/** "오늘의 차트 #4 · 주식", "연습 · 코인", "장기 1년 · 금". */
export function challengeLabel(c: Pick<Challenge, 'day' | 'product' | 'length'>): string {
  const name = PRODUCTS[c.product].name
  if (c.day !== null) return `오늘의 차트 #${c.day} · ${name}`
  return `${c.length === 'long' ? '장기 1년' : '연습'} · ${name}`
}

/** The message that carries the link. */
export function challengeShareText(c: Challenge, url: string): string {
  return [
    `HOLD 도전장 · ${challengeLabel(c)} (가상 게임)`,
    `이 차트에서 ${formatPct(c.ret, 1)}를 냈어요. 같은 차트로 겨뤄 볼래요?`,
    url,
  ].join('\n')
}
