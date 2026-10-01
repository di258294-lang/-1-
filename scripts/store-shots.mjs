// Captures store screenshots from a running preview server.
//
//   npm run build && npx vite preview --port 4173 &
//   node scripts/store-shots.mjs ios       # 1320x2868, App Store 6.9"
//   node scripts/store-shots.mjs android   # 1080x2160, Google Play phone
import { chromium } from '@playwright/test'
import { existsSync, mkdirSync } from 'node:fs'

const target = process.argv[2] ?? 'ios'
const sizes = {
  ios: { width: 440, height: 956, scale: 3 },
  android: { width: 360, height: 720, scale: 3 },
}
const { width, height, scale } = sizes[target]
const out = `store/${target}`
mkdirSync(out, { recursive: true })

const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const browser = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {})
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale, colorScheme: 'light' })
const url = process.env.URL ?? 'http://localhost:4173/'
const shot = (name) => page.screenshot({ path: `${out}/${name}.png` })

// Skip the first-run sheet; the store shows the game, not the rules.
await page.goto(url)
await page.evaluate(() => {
  localStorage.setItem('hold.save.v1', JSON.stringify({ v: 1, daily: {}, practice: { rounds: 0, best: null }, seenIntro: true, habits: [] }))
})
await page.reload()
await page.waitForTimeout(700)
await shot('1-home')

// A daily round: hold through the opening, catch a headline mid-hold.
await page.getByRole('button', { name: '시작하기' }).click()
await page.waitForTimeout(2600)
const pad = await page.locator('.pad').boundingBox()
await page.mouse.move(pad.x + pad.width / 2, pad.y + pad.height / 2)
await page.mouse.down()
await page.waitForSelector('.news.show', { timeout: 30000 })
await page.waitForTimeout(900)
await shot('2-play')
await page.mouse.up()
const t0 = Date.now()
while (!(await page.locator('.result-grade').count()) && Date.now() - t0 < 45000) {
  await page.mouse.down()
  await page.waitForTimeout(4000)
  await page.mouse.up()
  await page.waitForTimeout(1500)
}
await page.waitForSelector('.result-grade')
await page.waitForTimeout(600)
await shot('3-result')

// Four earlier rounds so the type screen is unlocked.
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('hold.save.v1'))
  const r = (holder, chicken, scalper, chaser, rumor) => ({ holder, chicken, scalper, chaser, rumor })
  s.habits.unshift(
    { id: 'seed1', scores: r(0.72, 0.18, 0.1, 0.22, 0.31) },
    { id: 'seed2', scores: r(0.81, 0.12, 0.05, 0.1, 0.45) },
    { id: 'seed3', scores: r(0.64, 0.3, 0.2, 0.05, 0.22) },
    { id: 'seed4', scores: r(0.77, 0.21, 0.1, 0.28, 0.4) },
  )
  localStorage.setItem('hold.save.v1', JSON.stringify(s))
})
await page.getByRole('button', { name: '홈으로' }).click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: '내 매매 습관' }).click()
await page.waitForTimeout(500)
await shot('4-habits')

await browser.close()
console.log(`${out}: 4 screenshots at ${width * scale}x${height * scale}`)
