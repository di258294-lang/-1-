// Renders sample result cards (src/ui/card.ts) with the real canvas code, so
// the image can be checked without playing a round.
//
//   node scripts/card-preview.mjs          # store/card/square.png, story.png
//
// Starts a Vite dev server for the source modules; no build needed.
import { chromium } from '@playwright/test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'vite'

const out = 'store/card'
mkdirSync(out, { recursive: true })

const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'warn' })
await server.listen()
const url = server.resolvedUrls.local[0]

const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const browser = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {})
try {
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } })
  page.on('pageerror', (err) => console.error('page error:', err.message))
  await page.goto(url)
  const samples = [
    { name: 'square', format: 'square', streak: 12, typeName: '새가슴 익절형' },
    { name: 'story', format: 'story', streak: 12, typeName: '새가슴 익절형' },
    { name: 'square-plain', format: 'square', streak: null, typeName: null, practice: true },
  ]
  for (const s of samples) {
    const b64 = await page.evaluate(async (s) => {
      const { generateMarket, playPrice } = await import('/src/core/market.ts')
      const { dailySeed, dayNumber } = await import('/src/core/daily.ts')
      const { renderResultCard } = await import('/src/ui/card.ts')
      const key = '2026-11-09'
      const market = generateMarket(dailySeed(key), s.practice ? 'gold' : 'stock', 'short')
      // Held 2.5-8.5 s, 13-26 s and 33.5-40 s: 8 of 10 slices right on this chart.
      const held = Array.from({ length: market.playTicks }, (_, t) => (t >= 25 && t < 85) || (t >= 130 && t < 260) || t >= 335)
      const buyHold = playPrice(market, market.playTicks) / playPrice(market, 0) - 1
      const blob = await renderResultCard({
        format: s.format,
        market,
        result: { yourReturn: buyHold - 0.021, buyHoldReturn: buyHold, held },
        day: s.practice ? null : dayNumber(key),
        url: 'https://di258294-lang.github.io/-1-/',
        streak: s.streak,
        typeName: s.typeName,
      })
      const buf = new Uint8Array(await blob.arrayBuffer())
      let bin = ''
      for (const b of buf) bin += String.fromCharCode(b)
      return btoa(bin)
    }, s)
    writeFileSync(`${out}/${s.name}.png`, Buffer.from(b64, 'base64'))
    console.log(`${out}/${s.name}.png`)
  }
} finally {
  await browser.close()
  await server.close()
}
