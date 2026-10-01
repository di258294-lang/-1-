// Renders the store icon and splash PNGs from inline SVG with Chromium.
// Output goes to assets/, which @capacitor/assets turns into every native size.
//
//   node scripts/render-assets.mjs && npx capacitor-assets generate
import { chromium } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'

const INK = '#111418'
const CANVAS = '#f2f3f5'
const UP = '#ff4a5c'
const UP_TINT = 'rgba(255, 74, 92, 0.22)'

// Price line on a 100x100 grid. The last leg is the "held" segment.
const line = 'M14 66 L28 58 L38 62 L50 46 L58 50'
const held = 'M58 50 L72 30 L86 24'
const band = 'M58 50 L72 30 L86 24 L86 86 L58 86 Z'

function mark(scale = 1, stroke = 7) {
  return `<g transform="translate(${50 - 50 * scale} ${50 - 50 * scale}) scale(${scale})">
    <path d="${band}" fill="${UP_TINT}"/>
    <path d="${line}" fill="none" stroke="#fff" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${held}" fill="none" stroke="${UP}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="86" cy="24" r="${stroke * 0.8}" fill="${UP}"/>
  </g>`
}

const svg = (body, bg) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">${bg ? `<rect width="100" height="100" fill="${bg}"/>` : ''}${body}</svg>`

const wordmark = (color) => `<div style="font:800 140px/1 'Pretendard Variable',system-ui,sans-serif;letter-spacing:-6px;color:${color}">HOLD</div>`

const jobs = [
  // iOS masks the corners itself, so the icon is a full-bleed square.
  { file: 'icon-only.png', size: 1024, html: svg(mark(1), INK) },
  // Android adaptive icon: the mark must sit inside the central 66% safe zone.
  { file: 'icon-foreground.png', size: 1024, html: svg(mark(0.62), null) },
  { file: 'icon-background.png', size: 1024, html: svg('', INK) },
  { file: 'splash.png', size: 2732, html: `<div style="display:grid;place-items:center;height:100%;background:${CANVAS}">${wordmark(INK)}</div>` },
  // Google Play store listing graphics.
  { file: '../store/android/icon-512.png', size: 512, html: svg(mark(1), INK) },
  {
    file: '../store/android/feature-graphic.png',
    width: 1024,
    height: 500,
    html: `<div style="display:flex;align-items:center;gap:56px;height:100%;padding:0 80px;background:${INK};color:#fff;font-family:'Pretendard Variable',system-ui,sans-serif">
      <div style="width:200px;height:200px;flex:none">${svg(mark(1), null)}</div>
      <div><div style="font-weight:800;font-size:92px;letter-spacing:-4px;line-height:1">HOLD</div>
      <div style="margin-top:18px;font-weight:600;font-size:40px;letter-spacing:-1px;line-height:1.3">누르는 동안만 사요.<br><span style="color:${UP}">40초</span>면 매매 습관이 보여요.</div></div></div>`,
  },
  { file: 'splash-dark.png', size: 2732, html: `<div style="display:grid;place-items:center;height:100%;background:#0c0e11">${wordmark('#eef0f3')}</div>` },
]

// Inlined: a blank page cannot load a file:// font.
const fontFile = new URL('../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2', import.meta.url)
const font = `data:font/woff2;base64,${readFileSync(fontFile).toString('base64')}`
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const browser = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {})
for (const job of jobs) {
  const page = await browser.newPage({
    viewport: { width: job.width ?? job.size, height: job.height ?? job.size },
    deviceScaleFactor: 1,
  })
  await page.setContent(
    `<style>@font-face{font-family:'Pretendard Variable';src:url(${font}) format('woff2');font-weight:45 920}html,body{margin:0;height:100%;background:transparent}</style>${job.html}`,
  )
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `assets/${job.file}`, omitBackground: true })
  await page.close()
  console.log('assets/' + job.file)
}
await browser.close()
