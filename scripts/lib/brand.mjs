// Shared look for the launch images: the social preview (public/og.png), the
// store screenshots' caption frames and the wide store graphics. Rendered as
// HTML in Chromium, like scripts/render-assets.mjs.
//
// Follows docs/DESIGN.md: cold off-white canvas and white surfaces, ink text,
// red only for the held (rising) part of the price line, no gradients,
// borders, shadows, badges or emoji, left-aligned Korean sentences.
import { chromium } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'

export const C = {
  ink: '#111418',
  ink2: '#4e5561',
  ink3: '#8a919c',
  canvas: '#f2f3f5',
  surface: '#ffffff',
  grid: '#eceef1',
  up: '#e0263a',
  upSoft: '#fdebed',
}

export const PITCH = ['누르는 동안만 들고 있는', '40초 타이밍 게임']
export const DISCLAIMER = '모든 회사·가격·뉴스는 가상이에요'

// Inlined: a page set with setContent cannot load a file:// font. The full
// Pretendard (OFL), not the app's subset, so any caption renders.
const fontFile = new URL('../../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2', import.meta.url)
const FONT = `data:font/woff2;base64,${readFileSync(fontFile).toString('base64')}`
const BASE_CSS = `@font-face{font-family:'Pretendard Variable';src:url(${FONT}) format('woff2');font-weight:45 920}
*{box-sizing:border-box;margin:0}
html,body{height:100%}
body{background:${C.canvas};color:${C.ink};font-family:'Pretendard Variable',system-ui,sans-serif;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased;word-break:keep-all}`

export async function launch() {
  const exe = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
  return chromium.launch(existsSync(exe) ? { executablePath: exe } : {})
}

/** Renders `html` at exactly width x height CSS pixels (scale 1) to `path`. */
export async function renderHtml(browser, html, { width, height, path }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>${BASE_CSS}</style>${html}`)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path, clip: { x: 0, y: 0, width, height } })
  await page.close()
}

/** A deterministic random walk that ends higher, like a good daily chart. */
function walk(n, seed = 7) {
  let s = seed
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648)
  const pts = [0]
  for (let i = 1; i < n; i++) {
    const drift = i > n * 0.55 ? 0.55 : -0.05
    pts.push(pts[i - 1] + drift + (rnd() - 0.5) * 2.4)
  }
  return pts
}

/**
 * The tiny chart motif: a price line in ink that turns red where it was held,
 * with the app's soft red band under the held part and a dot at the head.
 */
export function chartSvg(width, height, { stroke = 4, heldFrom = 0.58 } = {}) {
  const pts = walk(64)
  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const pad = stroke * 3
  const x = (i) => pad + (i / (pts.length - 1)) * (width - pad * 2)
  const y = (v) => pad + (1 - (v - min) / (max - min)) * (height - pad * 2)
  const cut = Math.round(heldFrom * (pts.length - 1))
  const path = (a, b) => pts.slice(a, b + 1).map((v, i) => `${i ? 'L' : 'M'}${x(a + i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  const held = path(cut, pts.length - 1)
  const band = `${held} L${x(pts.length - 1).toFixed(1)} ${height} L${x(cut).toFixed(1)} ${height} Z`
  const gridY = [0.25, 0.5, 0.75].map((f) => `<line x1="0" x2="${width}" y1="${f * height}" y2="${f * height}" stroke="${C.grid}" stroke-width="2"/>`).join('')
  const entry = y(pts[cut]).toFixed(1)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${gridY}
    <path d="${band}" fill="${C.upSoft}"/>
    <line x1="${x(cut)}" x2="${width}" y1="${entry}" y2="${entry}" stroke="${C.ink3}" stroke-width="2" stroke-dasharray="6 8"/>
    <path d="${path(0, cut)}" fill="none" stroke="${C.ink}" stroke-width="${stroke}" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${held}" fill="none" stroke="${C.up}" stroke-width="${stroke}" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(pts.length - 1)}" cy="${y(pts[pts.length - 1])}" r="${stroke * 2}" fill="${C.up}"/>
  </svg>`
}

/**
 * Social preview / Toss OG image: wordmark, the one-line pitch, the chart
 * motif on a white surface, and "가상 게임".
 */
export function ogHtml({ width, height }) {
  const k = height / 630
  const panelW = Math.round(width * 0.36)
  const panelH = Math.round(height - 200 * k)
  return `<div style="display:flex;gap:${56 * k}px;height:100%;padding:${100 * k}px ${80 * k}px">
    <div style="flex:1;display:flex;flex-direction:column;justify-content:space-between">
      <div>
        <div style="font-weight:800;font-size:${150 * k}px;line-height:.9;letter-spacing:-${6 * k}px">HOLD</div>
        <div style="margin-top:${40 * k}px;font-weight:700;font-size:${54 * k}px;line-height:1.28;letter-spacing:-${1.5 * k}px">${PITCH.join('<br>')}</div>
      </div>
      <div style="font-weight:600;font-size:${28 * k}px;color:${C.ink2}">가상 게임 · <span style="color:${C.ink3}">${DISCLAIMER}</span></div>
    </div>
    <div style="width:${panelW}px;height:${panelH}px;background:${C.surface};border-radius:${40 * k}px;padding:${36 * k}px;display:flex;flex-direction:column;justify-content:space-between">
      <div style="display:flex;justify-content:space-between;font-weight:600;font-size:${24 * k}px;color:${C.ink2}"><span>오늘의 차트</span><span style="color:${C.up}">보유 중</span></div>
      ${chartSvg(panelW - 72 * k, panelH - 140 * k, { stroke: 5 * k })}
    </div>
  </div>`
}

/**
 * A phone screenshot in a plain ink bezel. `crop` shows only the top part
 * of the screen, bleeding off the bottom of the image.
 */
function phone(shot, w, h, { crop = false } = {}) {
  const bezel = Math.round(w * 0.035)
  const radius = Math.round(w * 0.11)
  return `<div style="width:${w}px;height:${h}px;background:${C.ink};padding:${bezel}px;${crop ? `padding-bottom:0;border-radius:${radius}px ${radius}px 0 0` : `border-radius:${radius}px`}">
    <div style="width:100%;height:100%;border-radius:${radius - bezel}px${crop ? ` ${radius - bezel}px 0 0` : ''};background:url(${shot}) top center/100% auto no-repeat ${C.canvas}"></div>
  </div>`
}

/**
 * Store screenshot frame: caption on top, the app screen, the disclaimer at
 * the bottom. Scales from the 1080x1920 design to any size.
 */
export function frameHtml({ width, height, shot, shotAspect, title, sub }) {
  const k = width / 1080
  const top = Math.round(330 * k)
  const foot = Math.round(130 * k)
  const phoneH = height - top - foot
  const phoneW = Math.round(phoneH / shotAspect)
  // The caption gets at least `top`; a caption that wraps pushes the phone
  // down (it then bleeds off its bottom edge) instead of overlapping it.
  return `<div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <div style="min-height:${top}px;flex:none;padding:${104 * k}px ${80 * k}px ${24 * k}px">
      <div style="font-weight:800;font-size:${68 * k}px;line-height:1.2;letter-spacing:-${2 * k}px">${title}</div>
      ${sub ? `<div style="margin-top:${18 * k}px;font-weight:500;font-size:${40 * k}px;line-height:1.35;color:${C.ink2};letter-spacing:-${0.5 * k}px">${sub}</div>` : ''}
    </div>
    <div style="flex:1;min-height:0;display:flex;justify-content:center;overflow:hidden">${phone(shot, phoneW, phoneH)}</div>
    <div style="height:${foot}px;flex:none;padding:0 ${80 * k}px;display:flex;align-items:center;font-weight:500;font-size:${30 * k}px;color:${C.ink3}">${DISCLAIMER}</div>
  </div>`
}

/**
 * Wide store graphic (Toss thumbnail, Play feature graphic): wordmark and
 * pitch on the left, the top of the play screen on the right.
 */
export function heroHtml({ width, height, shot }) {
  const k = height / 500
  const phoneW = Math.round(300 * k)
  const phoneH = Math.round(height - 56 * k)
  return `<div style="display:flex;align-items:flex-end;justify-content:space-between;height:100%;padding:0 ${Math.round(width * 0.08)}px">
    <div style="align-self:center">
      <div style="font-weight:800;font-size:${112 * k}px;line-height:.9;letter-spacing:-${4.5 * k}px">HOLD</div>
      <div style="margin-top:${28 * k}px;font-weight:700;font-size:${40 * k}px;line-height:1.3;letter-spacing:-${1 * k}px">${PITCH.join('<br>')}</div>
      <div style="margin-top:${28 * k}px;font-weight:500;font-size:${21 * k}px;color:${C.ink3}">가상 게임 · ${DISCLAIMER}</div>
    </div>
    ${phone(shot, phoneW, phoneH, { crop: true })}
  </div>`
}
