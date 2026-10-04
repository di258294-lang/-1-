// Store screenshots and graphics, captured from the real production build.
//
//   npm run build && node scripts/store-shots.mjs          # everything
//   node scripts/store-shots.mjs play toss                   # just these
//
// Targets (all under store/, which git ignores except the old ios/android):
//   play      store/play/1-hold.png .. 6-challenge.png   1080x1920, caption + disclaimer
//             store/play/feature-graphic.png              1024x500
//   toss      store/toss/screenshot-1..3.png             636x1048
//             store/toss/thumbnail.png                    1932x828
//             store/toss/og.png                           1200x600
//   appstore  store/appstore/1-hold.png .. 6-challenge.png 1320x2868 (6.9")
// The raw app captures (1200x2400) land in store/raw/.
//
// How the states are reached: a fake clock (page.clock) pins the date to the
// week before launch day, 2026-11-02..08, and the script plays each day's
// real daily round two ways (see below), so the streak, the
// season account and the habit type are real. On 2026-11-09 (daily #40, a
// stock day with a 공식 발표 and a 소문) it captures home, then plays the
// round on a fixed press schedule and captures the rumor, the held line, the
// result, the friend challenge sheet and the habit screen. Math.random is
// seeded, so every run gives the same pictures.
//
// Serves dist/ with `vite preview` itself (set URL= to use a running server).
import { mkdirSync, readFileSync } from 'node:fs'
import { preview } from 'vite'
import { frameHtml, heroHtml, launch, ogHtml, renderHtml } from './lib/brand.mjs'

const ALL = ['play', 'toss', 'appstore']
const targets = process.argv.slice(2).filter((a) => ALL.includes(a))
const want = new Set(targets.length ? targets : ALL)

const VIEW = { width: 400, height: 800, scale: 3 }
const DAYS = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']
const LAUNCH_DAY = '2026-11-09'
/** Held intervals on launch day, in ms of round time: 8 of 10 slices right on #40. */
const SCHEDULE = [
  [2500, 8500],
  [13000, 26000],
  [33500, 41000],
]

// Storyboard (docs/LAUNCH.md): what each frame shows and says.
const FRAMES = [
  { file: '1-hold', shot: 'hold', title: '누르는 동안만 들고 있어요', sub: '떼면 팔아요. 조작은 이게 전부.' },
  { file: '2-home', shot: 'home', title: '매일 0시, 모두에게 같은 차트 하나', sub: '하루 한 번, 40초.' },
  { file: '3-news', shot: 'news', title: '공식 발표는 믿고, 소문은 의심하고', sub: '소문은 반이 틀려요.' },
  { file: '4-result', shot: 'result', title: '운일까 실력일까', sub: '아무 때나 누른 1,000판과 비교해요.' },
  { file: '5-habits', shot: 'habits', title: '40초면 매매 습관이 보여요', sub: '고칠 미션도 하나씩.' },
  { file: '6-challenge', shot: 'challenge', title: '친구에겐 도전장으로', sub: '같은 차트로 겨뤄요. 결과는 10칸으로 공유해요.' },
]
const TOSS = ['1-hold', '4-result', '5-habits']

/** Where the finger rests on the pad: clear of the pad's own text. */
const FINGER = { x: 0.66, y: 0.8 }

const kst = (key, time = '10:00:00') => new Date(`${key}T${time}+09:00`)

async function capture(browser, url) {
  mkdirSync('store/raw', { recursive: true })
  const context = await browser.newContext({
    viewport: { width: VIEW.width, height: VIEW.height },
    deviceScaleFactor: VIEW.scale,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  })
  const page = await context.newPage()
  page.on('pageerror', (err) => console.error('page error:', err.message))
  await page.clock.install({ time: kst(DAYS[0]) })
  await page.addInitScript(() => {
    // Seeded Math.random (mulberry32): practice seeds and the luck test repeat.
    let a = 0x9e3779b9
    Math.random = () => {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    // Skip the first-run tutorial: the store shows the game, not the rules.
    if (!localStorage.getItem('hold.save.v1')) localStorage.setItem('hold.save.v1', JSON.stringify({ v: 2, seenIntro: true }))
  })

  const shot = async (name) => {
    await page.clock.runFor(50)
    await page.screenshot({ path: `store/raw/${name}.png` })
    console.log(`store/raw/${name}.png`)
  }
  const resultShown = () => page.locator('.result-grade').count()
  /** Plays today's daily. `decide(ms, holding)` says whether to hold for the next 100 ms. */
  async function playDaily(decide, onTick = async () => {}) {
    await page.getByRole('button', { name: '시작하기', exact: true }).click()
    await page.clock.runFor(2500) // the 2.4 s countdown
    const pad = await page.locator('.pad').boundingBox()
    await page.mouse.move(pad.x + pad.width * FINGER.x, pad.y + pad.height * FINGER.y)
    let holding = false
    for (let ms = 0; ms < 46000; ms += 100) {
      const next = await decide(ms, holding)
      if (next !== holding) {
        await (next ? page.mouse.down() : page.mouse.up())
        holding = next
      }
      await onTick(ms, holding)
      await page.clock.runFor(100)
      if (ms % 500 === 0 && (await resultShown())) break
    }
    if (holding) await page.mouse.up()
    for (let i = 0; i < 50 && !(await resultShown()); i++) await page.clock.runFor(200)
    if (!(await resultShown())) throw new Error('the round never reached the result screen')
    await page.clock.runFor(1500) // the luck test runs after first paint
  }

  // A week of real dailies, played two ways on alternate days so the season
  // account ends near the market rather than far above it: a calm player
  // who holds from the open and follows the news, and an anxious one who
  // presses every 2.5 s, sells at the first +0.4% and sits on losers.
  const newsTrader = async (ms, holding) => {
    const tone = await page.evaluate(() => document.querySelector('.news.show .news-tone')?.textContent ?? '')
    if (/나쁜/.test(tone)) return false
    if (/좋은/.test(tone)) return true
    return holding || ms === 500 || ms % 6000 === 0
  }
  const quickSeller = async (ms, holding) => {
    if (!holding) return ms % 2500 === 0
    const trade = await page.evaluate(() => {
      const m = /([+-]?\d+(?:\.\d+)?)%/.exec(document.querySelector('.pad-sub')?.textContent ?? '')
      return m ? Number(m[1]) : 0
    })
    return trade < 0.4
  }
  for (const [i, key] of DAYS.entries()) {
    await page.clock.setSystemTime(kst(key))
    await page.goto(url)
    await page.clock.runFor(600)
    await playDaily(i % 2 ? newsTrader : quickSeller)
    console.log(`played ${key}`)
  }

  // Launch day.
  await page.clock.setSystemTime(kst(LAUNCH_DAY))
  await page.goto(url)
  await page.clock.runFor(600)
  await shot('home')

  const finger = async (on) => {
    await page.evaluate(([on, f]) => {
      document.getElementById('shot-finger')?.remove()
      if (!on) return
      const pad = document.querySelector('.pad').getBoundingClientRect()
      const dot = document.createElement('div')
      dot.id = 'shot-finger'
      const size = 64
      dot.style.cssText = `position:fixed;z-index:99;pointer-events:none;width:${size}px;height:${size}px;border-radius:50%;left:${pad.left + pad.width * f.x - size / 2}px;top:${pad.top + pad.height * f.y - size / 2}px;background:rgba(255,255,255,.22);box-shadow:0 0 0 3px rgba(255,255,255,.5)`
      document.body.append(dot)
    }, [on, FINGER])
  }
  const taken = new Set()
  const inSchedule = (ms) => SCHEDULE.some(([a, b]) => ms >= a && ms < b)
  await playDaily(
    async (ms) => inSchedule(ms),
    async (ms, holding) => {
      const tag = await page.evaluate(() => document.querySelector('.news.show .news-tag')?.textContent ?? null)
      const news = tag !== null
      if (!taken.has('news') && holding && news && /소문/.test(tag) && ms >= 16800) {
        taken.add('news')
        await finger(true)
        await shot('news')
        await finger(false)
      }
      // The held line climbing, once the rumor banner is gone.
      if (!taken.has('hold') && holding && !news && ms >= 21000) {
        taken.add('hold')
        await finger(true)
        await shot('hold')
        await finger(false)
      }
    },
  )
  for (const name of ['news', 'hold']) if (!taken.has(name)) throw new Error(`missed the ${name} shot`)
  await shot('result')

  await page.getByRole('button', { name: /도전장 보내기/ }).click()
  await page.clock.runFor(400)
  // Behind the sheet, show the top of the result rather than wherever the button scrolled to.
  await page.evaluate(() => window.scrollTo(0, 0))
  await shot('challenge')
  await page.keyboard.press('Escape')
  await page.clock.runFor(300)
  if (await page.locator('.sheet-scrim').count()) await page.locator('.sheet-scrim').click({ position: { x: 10, y: 10 } })
  await page.getByRole('button', { name: '홈으로' }).first().click()
  await page.clock.runFor(400)
  await page.getByRole('button', { name: /내 매매 습관/ }).click()
  await page.clock.runFor(400)
  await shot('habits')
  await context.close()
}

const dataUri = (name) => `data:image/png;base64,${readFileSync(`store/raw/${name}.png`).toString('base64')}`

async function compose(browser) {
  const aspect = VIEW.height / VIEW.width
  const frames = async (dir, width, height, list = FRAMES) => {
    mkdirSync(`store/${dir}`, { recursive: true })
    for (const f of list) {
      const path = `store/${dir}/${f.file}.png`
      await renderHtml(browser, frameHtml({ width, height, shot: dataUri(f.shot), shotAspect: aspect, title: f.title, sub: f.sub }), { width, height, path })
      console.log(`${path} ${width}x${height}`)
    }
  }
  const one = async (path, html, width, height) => {
    await renderHtml(browser, html, { width, height, path })
    console.log(`${path} ${width}x${height}`)
  }
  if (want.has('play')) {
    await frames('play', 1080, 1920)
    await one('store/play/feature-graphic.png', heroHtml({ width: 1024, height: 500, shot: dataUri('hold') }), 1024, 500)
  }
  if (want.has('toss')) {
    mkdirSync('store/toss', { recursive: true })
    const list = FRAMES.filter((f) => TOSS.includes(f.file))
    for (const [i, f] of list.entries()) {
      const path = `store/toss/screenshot-${i + 1}.png`
      await renderHtml(browser, frameHtml({ width: 636, height: 1048, shot: dataUri(f.shot), shotAspect: aspect, title: f.title, sub: f.sub }), {
        width: 636,
        height: 1048,
        path,
      })
      console.log(`${path} 636x1048`)
    }
    await one('store/toss/thumbnail.png', heroHtml({ width: 1932, height: 828, shot: dataUri('hold') }), 1932, 828)
    await one('store/toss/og.png', ogHtml({ width: 1200, height: 600 }), 1200, 600)
  }
  if (want.has('appstore')) await frames('appstore', 1320, 2868)
}

let server = null
let url = process.env.URL
if (!url) {
  server = await preview({ preview: { port: 4319, host: '127.0.0.1' }, logLevel: 'warn' })
  url = server.resolvedUrls.local[0]
}
const browser = await launch()
try {
  if (!process.argv.includes('--compose-only')) await capture(browser, url)
  await compose(browser)
} finally {
  await browser.close()
  if (server) await new Promise((resolve) => server.httpServer.close(resolve))
}
