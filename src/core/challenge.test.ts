import { describe, expect, it } from 'vitest'
import {
  challengeAccess,
  challengeLabel,
  challengeShareText,
  challengeUrl,
  cleanName,
  decodeChallenge,
  encodeChallenge,
  keyForDay,
  outcome,
  takeChallengeCode,
  type Challenge,
} from './challenge'
import { dailySeed, dayNumber, nextKey } from './daily'
import { ENGINE_VERSION } from './market'

const practice: Challenge = {
  seed: 3_141_592_653,
  product: 'coin',
  length: 'short',
  ret: 0.0423,
  day: null,
  luck: 0.87,
  name: null,
}

const daily = (day: number, extra: Partial<Challenge> = {}): Challenge => ({
  seed: dailySeed(keyForDay(day)),
  product: 'stock',
  length: 'short',
  ret: -0.0151,
  day,
  luck: null,
  name: null,
  ...extra,
})

function decoded(code: string) {
  const r = decodeChallenge(code)
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`)
  return r.challenge
}

/** Flips one bit of the decoded bytes and re-encodes, keeping valid base64url. */
function flipBit(code: string, byte: number, bit = 0) {
  const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = [...bin].map((c) => c.charCodeAt(0))
  bytes[byte] ^= 1 << bit
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe('challenge links', () => {
  it('round-trips a practice challenge', () => {
    expect(decoded(encodeChallenge(practice))).toEqual(practice)
  })

  it('round-trips every product, both lengths and signed returns', () => {
    for (const product of ['stock', 'bond', 'gold', 'coin', 'lev2'] as const) {
      for (const length of ['short', 'long'] as const) {
        for (const ret of [-0.9999, -0.0001, 0, 0.0001, 3.5, 99.99]) {
          const c: Challenge = { ...practice, product, length, ret, luck: null }
          expect(decoded(encodeChallenge(c))).toEqual(c)
        }
      }
    }
  })

  it('round-trips a daily challenge with a nickname', () => {
    const c = daily(4, { name: '민지', luck: 0.5 })
    expect(decoded(encodeChallenge(c))).toEqual(c)
  })

  it('rounds the return to 0.01% and luck to 1%', () => {
    const c = decoded(encodeChallenge({ ...practice, ret: 0.123456, luck: 0.12345 }))
    expect(c.ret).toBe(0.1235)
    expect(c.luck).toBe(0.12)
  })

  it('keeps seed edge values', () => {
    for (const seed of [0, 1, 0x7fffffff, 0x80000000, 0xffffffff]) {
      expect(decoded(encodeChallenge({ ...practice, seed })).seed).toBe(seed)
    }
  })

  it('makes short URLs, even with the longest nickname', () => {
    const base = 'https://di258294-lang.github.io/-1-/'
    const longest = encodeChallenge({ ...daily(65535 - 1, {}), seed: dailySeed(keyForDay(65534)), name: '가나다라마바사아' })
    expect(challengeUrl(base, longest).length).toBeLessThan(200)
    expect(challengeUrl(base, encodeChallenge(practice)).length).toBeLessThan(120)
    // URL-safe without escaping.
    expect(longest).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('rejects any single flipped bit', () => {
    const code = encodeChallenge(daily(3, { name: 'Jay', luck: 0.4 }))
    const bytes = atob(code.replace(/-/g, '+').replace(/_/g, '/')).length
    for (let i = 0; i < bytes; i++) {
      for (let bit = 0; bit < 8; bit++) {
        const r = decodeChallenge(flipBit(code, i, bit))
        expect(r.ok, `byte ${i} bit ${bit}`).toBe(false)
      }
    }
  })

  it('rejects truncated and extended codes', () => {
    const code = encodeChallenge(practice)
    for (let n = 0; n < code.length; n++) expect(decodeChallenge(code.slice(0, n)).ok).toBe(false)
    expect(decodeChallenge(`${code}A`).ok).toBe(false)
    expect(decodeChallenge(`${code}AAAA`).ok).toBe(false)
  })

  it('rejects garbage without throwing', () => {
    const junk: unknown[] = [
      undefined,
      null,
      42,
      {},
      [],
      '',
      ' ',
      '%%%',
      '====',
      'hello world',
      'A',
      'AAAAAAAAAAAAAAAAAAAAAAAAA',
      'x'.repeat(10_000),
      '<script>alert(1)</script>',
      '🙂🙂🙂',
    ]
    for (const j of junk) expect(decodeChallenge(j)).toEqual({ ok: false, reason: 'invalid' })
    // Random byte strings almost never pass a 24-bit checksum.
    let passed = 0
    for (let i = 0; i < 2000; i++) {
      const len = 18 + (i % 30)
      const bytes = Array.from({ length: len }, (_, k) => (Math.imul(i + 1, 2654435761) >>> (k % 24)) & 0xff)
      const code = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      if (decodeChallenge(code).ok) passed++
    }
    expect(passed).toBe(0)
  })

  it('tells old and new engine versions apart', () => {
    expect(decodeChallenge(encodeChallenge(practice, ENGINE_VERSION - 1))).toEqual({ ok: false, reason: 'old' })
    expect(decodeChallenge(encodeChallenge(practice, ENGINE_VERSION + 1))).toEqual({ ok: false, reason: 'new' })
    expect(decodeChallenge(encodeChallenge(practice, 7), 7).ok).toBe(true)
  })

  it('rejects a daily link whose seed is not that day’s chart', () => {
    const forged = { ...daily(5), seed: practice.seed }
    expect(decodeChallenge(encodeChallenge(forged)).ok).toBe(false)
    const longDaily = { ...daily(5), length: 'long' as const }
    expect(decodeChallenge(encodeChallenge(longDaily)).ok).toBe(false)
  })

  it('refuses to encode values no round can produce', () => {
    expect(() => encodeChallenge({ ...practice, ret: Number.NaN })).toThrow()
    expect(() => encodeChallenge({ ...practice, ret: -1 })).toThrow()
    expect(() => encodeChallenge({ ...practice, ret: 1000 })).toThrow()
    expect(() => encodeChallenge({ ...practice, seed: -1 })).toThrow()
    expect(() => encodeChallenge({ ...practice, seed: 2 ** 32 })).toThrow()
    expect(() => encodeChallenge({ ...practice, day: 0 })).toThrow()
    expect(() => encodeChallenge({ ...practice, product: 'nope' as never })).toThrow()
  })

  it('drops a nickname that is not a plain name', () => {
    expect(decoded(encodeChallenge({ ...practice, name: 'http://x.y' })).name).toBeNull()
  })
})

describe('cleanName', () => {
  it('keeps short plain names', () => {
    expect(cleanName('민지')).toBe('민지')
    expect(cleanName('  Kim  Jay ')).toBe('Kim Jay')
    expect(cleanName('가나다라마바사아')).toBe('가나다라마바사아')
    expect(cleanName('J')).toBe('J')
  })

  it('rejects links, symbols, emoji and long names', () => {
    for (const bad of ['', '   ', 'a.b', 'x/y', '@me', '민지🙂', '가나다라마바사아자', 'a\u0000b', '010-1234', null, 3]) {
      expect(cleanName(bad), String(bad)).toBeNull()
    }
  })
})

describe('challengeAccess', () => {
  const today = '2026-10-04'
  const todayDay = dayNumber(today)

  it('holds back today’s daily until it is played', () => {
    expect(challengeAccess(daily(todayDay), today, false)).toBe('today')
    expect(challengeAccess(daily(todayDay), today, true)).toBe('ok')
  })

  it('lets past dailies through', () => {
    expect(challengeAccess(daily(todayDay - 1), today, false)).toBe('ok')
    expect(challengeAccess(daily(1), today, false)).toBe('ok')
  })

  it('never opens a future daily', () => {
    expect(challengeAccess(daily(todayDay + 1), today, true)).toBe('future')
  })

  it('guards today’s and future daily seeds dressed up as practice', () => {
    const asPractice = (key: string) => ({ ...practice, seed: dailySeed(key), product: 'gold' as const })
    expect(challengeAccess(asPractice(today), today, false)).toBe('today')
    expect(challengeAccess(asPractice(today), today, true)).toBe('ok')
    expect(challengeAccess(asPractice(nextKey(today)), today, true)).toBe('future')
    expect(challengeAccess({ ...asPractice(today), length: 'long' }, today, false)).toBe('today')
  })

  it('lets ordinary practice charts through', () => {
    expect(challengeAccess(practice, today, false)).toBe('ok')
  })
})

describe('urls', () => {
  it('appends to the share base, keeping the GitHub Pages path', () => {
    expect(challengeUrl('https://di258294-lang.github.io/-1-/', 'abc')).toBe('https://di258294-lang.github.io/-1-/?c=abc')
    expect(challengeUrl('https://x.y/?ref=1', 'abc')).toBe('https://x.y/?ref=1&c=abc')
    expect(challengeUrl('https://x.y/#top', 'abc')).toBe('https://x.y/?c=abc#top')
    expect(challengeUrl('intoss://hold', 'abc')).toBe('intoss://hold?c=abc')
  })

  it('takes the code out and keeps everything else', () => {
    expect(takeChallengeCode('https://x.y/-1-/?c=abc&ref=1#h')).toEqual({ code: 'abc', rest: '/-1-/?ref=1#h' })
    expect(takeChallengeCode('https://x.y/-1-/?c=abc')).toEqual({ code: 'abc', rest: '/-1-/' })
    expect(takeChallengeCode('https://x.y/-1-/')).toEqual({ code: null, rest: 'https://x.y/-1-/' })
  })

  it('round-trips through a real URL', () => {
    const code = encodeChallenge(daily(2, { name: '하늘' }))
    const { code: back } = takeChallengeCode(challengeUrl('https://di258294-lang.github.io/-1-/', code))
    expect(decoded(back!)).toEqual(daily(2, { name: '하늘' }))
  })
})

describe('outcome', () => {
  it('compares at the shown precision', () => {
    expect(outcome(0.05, 0.042)).toEqual({ result: 'win', gap: 0.008 })
    expect(outcome(0.01, 0.042).result).toBe('lose')
    expect(outcome(0.04211, 0.0423).result).toBe('tie')
    // QA #11c: both print as -1.3%, so neither is ahead.
    expect(outcome(-0.013, -0.0125)).toEqual({ result: 'tie', gap: 0 })
  })
})

describe('share text', () => {
  it('names the chart and carries the link', () => {
    const text = challengeShareText(daily(4, { ret: 0.042 }), 'https://x.y/?c=abc')
    expect(text.split('\n')).toEqual([
      'HOLD 도전장 · 오늘의 차트 #4 · 주식 (가상 게임)',
      '이 차트에서 +4.2%를 냈어요. 같은 차트로 겨뤄 볼래요?',
      'https://x.y/?c=abc',
    ])
    expect(challengeLabel({ day: null, product: 'coin', length: 'long' })).toBe('장기 1년 · 코인')
    expect(challengeLabel(practice)).toBe('연습 · 코인')
  })
})
