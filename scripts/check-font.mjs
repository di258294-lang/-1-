// Fails when the source uses Korean characters that the committed font
// subset (src/assets/pretendard-subset.woff2) cannot draw. Those would fall
// back to a system font mid-word. Fix by running `npm run font`.
//
//   node scripts/check-font.mjs
//
// No dependencies: reads the woff2 cmap with Node's built-in brotli.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { brotliDecompressSync } from 'node:zlib'

const ROOT = new URL('..', import.meta.url).pathname
const FONT = join(ROOT, 'src/assets/pretendard-subset.woff2')

const KNOWN_TAGS = (
  'cmap head hhea hmtx maxp name OS/2 post cvt  fpgm glyf loca prep CFF  VORG EBDT EBLC gasp hdmx kern LTSH PCLT ' +
  'VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG  sbix acnt avar bdat bloc bsln cvar ' +
  'fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill'
).match(/.{4}\s?/g).map((t) => t.slice(0, 4))

/** Returns the set of code points the woff2 font maps to a real glyph. */
export function woff2Coverage(buf) {
  if (buf.toString('latin1', 0, 4) !== 'wOF2') throw new Error('not a woff2 file')
  const numTables = buf.readUInt16BE(12)
  const compressedSize = buf.readUInt32BE(20)
  let pos = 48
  const base128 = () => {
    let value = 0
    for (let i = 0; i < 5; i++) {
      const b = buf[pos++]
      value = value * 128 + (b & 0x7f)
      if (!(b & 0x80)) return value
    }
    throw new Error('bad UIntBase128')
  }
  const tables = []
  for (let i = 0; i < numTables; i++) {
    const flags = buf[pos++]
    let tag
    if ((flags & 0x3f) === 0x3f) {
      tag = buf.toString('latin1', pos, pos + 4)
      pos += 4
    } else tag = KNOWN_TAGS[flags & 0x3f]
    const version = flags >> 6
    const origLength = base128()
    // glyf/loca: version 0 is the transformed form; others: non-zero is.
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0
    const length = transformed ? base128() : origLength
    tables.push({ tag, length })
  }
  const data = brotliDecompressSync(buf.subarray(pos, pos + compressedSize))
  let offset = 0
  let cmap = null
  for (const t of tables) {
    if (t.tag === 'cmap') cmap = data.subarray(offset, offset + t.length)
    offset += t.length
  }
  if (!cmap) throw new Error('font has no cmap')
  return parseCmap(cmap)
}

function parseCmap(c) {
  const n = c.readUInt16BE(2)
  const subtables = []
  for (let i = 0; i < n; i++) {
    const r = 4 + i * 8
    subtables.push({ platform: c.readUInt16BE(r), encoding: c.readUInt16BE(r + 2), offset: c.readUInt32BE(r + 4) })
  }
  const covered = new Set()
  for (const s of subtables) {
    const format = c.readUInt16BE(s.offset)
    if (format === 12) {
      const groups = c.readUInt32BE(s.offset + 12)
      for (let g = 0; g < groups; g++) {
        const r = s.offset + 16 + g * 12
        const start = c.readUInt32BE(r)
        const end = c.readUInt32BE(r + 4)
        const glyph = c.readUInt32BE(r + 8)
        for (let cp = start; cp <= end; cp++) if (glyph + (cp - start) !== 0) covered.add(cp)
      }
    } else if (format === 4) {
      const segs = c.readUInt16BE(s.offset + 6) / 2
      const ends = s.offset + 14
      const starts = ends + segs * 2 + 2
      const deltas = starts + segs * 2
      const ranges = deltas + segs * 2
      for (let i = 0; i < segs; i++) {
        const end = c.readUInt16BE(ends + i * 2)
        const start = c.readUInt16BE(starts + i * 2)
        const delta = c.readInt16BE(deltas + i * 2)
        const rangeAt = ranges + i * 2
        const rangeOffset = c.readUInt16BE(rangeAt)
        for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
          let glyph
          if (rangeOffset === 0) glyph = (cp + delta) & 0xffff
          else {
            const g = c.readUInt16BE(rangeAt + rangeOffset + (cp - start) * 2)
            glyph = g === 0 ? 0 : (g + delta) & 0xffff
          }
          if (glyph !== 0) covered.add(cp)
        }
      }
    }
  }
  return covered
}

function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) sourceFiles(path, out)
    else if (/\.(ts|css)$/.test(name)) out.push(path)
  }
  return out
}

const isKorean = (cp) => (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0x3131 && cp <= 0x318e)

function main() {
  const covered = woff2Coverage(readFileSync(FONT))
  const files = [...sourceFiles(join(ROOT, 'src')), join(ROOT, 'index.html')]
  const missing = new Map()
  let used = 0
  const seen = new Set()
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const ch of text) {
      const cp = ch.codePointAt(0)
      if (!isKorean(cp)) continue
      if (!seen.has(cp)) {
        seen.add(cp)
        used++
      }
      if (covered.has(cp)) continue
      if (!missing.has(ch)) missing.set(ch, new Set())
      missing.get(ch).add(relative(ROOT, file))
    }
  }
  if (missing.size) {
    console.error(`Font subset is missing ${missing.size} Korean character(s) used in the source:`)
    for (const [ch, where] of missing) console.error(`  ${ch}  U+${ch.codePointAt(0).toString(16).toUpperCase()}  ${[...where].join(', ')}`)
    console.error('\nRun `npm run font` (pip install fonttools brotli) and commit src/assets/pretendard-subset.woff2.')
    process.exit(1)
  }
  console.log(`Font subset covers all ${used} Korean characters used in the source (${covered.size} code points).`)
}

main()
