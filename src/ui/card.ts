import { platform } from '#platform'
import {
  CARD_DISCLAIMER,
  cardFootnote,
  cardHeadline,
  cardLayout,
  edgeText,
  gridCells,
  marketVerdicts,
  timingScore,
  type Box,
  type CardFormat,
} from '../core/card'
import { shownEdge } from '../core/copy'
import { direction } from '../core/format'
import type { Market } from '../core/market'
import type { RoundResult } from '../core/round'
import { toast } from './dom'

/**
 * The shareable result image: a 1080x1080 post or a 1080x1920 story, drawn
 * on a canvas that never enters the page. Spoiler-free like the share text:
 * the score and the O/X cells say how often you were right, never which way
 * the chart went (see core/card.ts).
 *
 * The O and X are drawn as shapes, not emoji, so every phone draws the same
 * card. Colors are the light theme's tokens (styles.css): ink, canvas,
 * surface, and red/blue only for the one signed number.
 */

const C = {
  ink: '#111418',
  ink2: '#4e5561',
  ink3: '#8a919c',
  ink4: '#b5bac2',
  canvas: '#f2f3f5',
  surface: '#ffffff',
  up: '#e0263a',
  down: '#1a62d6',
}
const FAMILY = "'HOLD Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif"

export type ResultCardOpts = {
  format?: CardFormat
  market: Market
  result: Pick<RoundResult, 'yourReturn' | 'buyHoldReturn' | 'held'>
  /** The daily's number, or null for practice and long rounds. */
  day: number | null
  /** Printed as text (no QR), without the scheme. */
  url: string
  streak?: number | null
  /** The habit type's name, e.g. "새가슴 익절형". */
  typeName?: string | null
}

/** Waits (at most 3 s) for the app font, so the card never draws in a fallback face. */
async function appFont() {
  if (!document.fonts) return
  const wait = Promise.all([
    document.fonts.load(`800 100px 'HOLD Sans'`, 'HOLD 타이밍'),
    document.fonts.load(`600 100px 'HOLD Sans'`, '가상 게임'),
  ]).then(() => document.fonts.ready)
  await Promise.race([wait.catch(() => {}), new Promise((resolve) => setTimeout(resolve, 3000))])
}

const font = (weight: number, size: number) => `${weight} ${size}px ${FAMILY}`

/** Shrinks the size until `text` fits `max` px. */
function fitSize(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, max: number) {
  let s = size
  ctx.font = font(weight, s)
  while (s > 12 && ctx.measureText(text).width > max) {
    s -= 2
    ctx.font = font(weight, s)
  }
  return s
}

function roundRect(ctx: CanvasRenderingContext2D, b: Box, r: number) {
  ctx.beginPath()
  ctx.moveTo(b.x + r, b.y)
  ctx.arcTo(b.x + b.width, b.y, b.x + b.width, b.y + b.height, r)
  ctx.arcTo(b.x + b.width, b.y + b.height, b.x, b.y + b.height, r)
  ctx.arcTo(b.x, b.y + b.height, b.x, b.y, r)
  ctx.arcTo(b.x, b.y, b.x + b.width, b.y, r)
  ctx.closePath()
}

/** A ring for a right call, a light cross for a wrong one. */
function verdictMark(ctx: CanvasRenderingContext2D, cell: Box, right: boolean) {
  const cx = cell.x + cell.width / 2
  const cy = cell.y + cell.height / 2
  const s = cell.width
  ctx.lineCap = 'round'
  if (right) {
    ctx.strokeStyle = C.ink
    ctx.lineWidth = s * 0.13
    ctx.beginPath()
    ctx.arc(cx, cy, s * 0.34, 0, Math.PI * 2)
    ctx.stroke()
  } else {
    ctx.strokeStyle = C.ink4
    ctx.lineWidth = s * 0.11
    const a = s * 0.27
    ctx.beginPath()
    ctx.moveTo(cx - a, cy - a)
    ctx.lineTo(cx + a, cy + a)
    ctx.moveTo(cx + a, cy - a)
    ctx.lineTo(cx - a, cy + a)
    ctx.stroke()
  }
}

/** Draws runs of [text, color, weight] from x on one baseline. */
function runs(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, parts: [string, string, number][]) {
  for (const [text, color, weight] of parts) {
    ctx.font = font(weight, size)
    ctx.fillStyle = color
    ctx.fillText(text, x, y)
    x += ctx.measureText(text).width
  }
  return x
}

export function drawResultCard(ctx: CanvasRenderingContext2D, opts: ResultCardOpts) {
  const l = cardLayout(opts.format ?? 'square')
  const { market, result } = opts
  const verdicts = marketVerdicts(market, result.held)
  const score = timingScore(verdicts)
  const textWidth = l.width - l.pad * 2

  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillStyle = C.canvas
  ctx.fillRect(0, 0, l.width, l.height)

  // "HOLD #128 · 주식 (가상 게임)", the wordmark in ink and the rest quieter.
  const headline = cardHeadline(opts.day, market)
  const rest = headline.slice(4)
  runs(ctx, l.pad, l.headline.y, l.headline.size, [
    ['HOLD', C.ink, 800],
    [rest, C.ink2, 600],
  ])

  ctx.fillStyle = C.surface
  roundRect(ctx, l.panel, l.panel.radius)
  ctx.fill()

  const inner = l.grid.area.x
  ctx.font = font(600, l.label.size)
  ctx.fillStyle = C.ink2
  ctx.fillText('타이밍', inner, l.label.y)

  const x = runs(ctx, inner, l.score.y, l.score.size, [[String(score), C.ink, 800]])
  runs(ctx, x + l.score.size * 0.04, l.score.y, Math.round(l.score.size * 0.42), [['/10', C.ink3, 700]])

  gridCells(verdicts.length, l.grid.cols, l.grid.area, l.grid.gap).forEach((cell, i) => verdictMark(ctx, cell, verdicts[i]))

  const edge = edgeText(result.yourReturn, result.buyHoldReturn)
  const lead = '그냥 들고 있기보다 '
  const dir = direction(shownEdge(result.yourReturn, result.buyHoldReturn))
  const edgeSize = fitSize(ctx, edge, 700, l.edge.size, l.panel.width - (inner - l.panel.x) * 2)
  runs(ctx, inner, l.edge.y, edgeSize, [
    [lead, C.ink2, 600],
    [edge.slice(lead.length), dir === 'up' ? C.up : dir === 'down' ? C.down : C.ink, 700],
  ])

  const note = cardFootnote(opts.streak, opts.typeName)
  if (note) {
    ctx.font = font(600, fitSize(ctx, note, 600, l.footnote.size, textWidth))
    ctx.fillStyle = C.ink2
    ctx.fillText(note, l.pad, l.footnote.y)
  }

  const url = opts.url.replace(/^https?:\/\//, '').replace(/\/$/, '')
  ctx.font = font(600, fitSize(ctx, url, 600, l.url.size, textWidth))
  ctx.fillStyle = C.ink
  ctx.fillText(url, l.pad, l.url.y)

  ctx.font = font(500, fitSize(ctx, CARD_DISCLAIMER, 500, l.disclaimer.size, textWidth))
  ctx.fillStyle = C.ink3
  ctx.fillText(CARD_DISCLAIMER, l.pad, l.disclaimer.y)
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (canvas.toBlob) {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))), 'image/png')
      return
    }
    // Very old WebViews: go through a data URL.
    fetch(canvas.toDataURL('image/png'))
      .then((r) => r.blob())
      .then(resolve, reject)
  })
}

/** Renders the result card as a PNG. */
export async function renderResultCard(opts: ResultCardOpts): Promise<Blob> {
  await appFont()
  const { width, height } = cardLayout(opts.format ?? 'square')
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d canvas unavailable')
  drawResultCard(ctx, opts)
  return toBlob(canvas)
}

/**
 * Only the browser can hand an image to the share sheet or save it as a
 * download. The Capacitor WebView ignores <a download> (and the Share plugin
 * needs a file on disk), and the Toss WebView is untested, so the app shows
 * the image button on the web only.
 */
export function imageShareAvailable() {
  return platform.kind === 'web'
}

const isCancel = (err: unknown) => (err as DOMException)?.name === 'AbortError'

/**
 * The share sheet with the image where the browser can share files (Android
 * Chrome, recent iOS Safari), else a download ("이미지 저장"). Resolves to what
 * happened; never rejects.
 */
export async function shareCard(blob: Blob, filename = 'hold.png'): Promise<'shared' | 'cancelled' | 'saved' | 'failed'> {
  try {
    const file = new File([blob], filename, { type: blob.type || 'image/png' })
    if (navigator.canShare?.({ files: [file] })) {
      try {
        // Files only: Instagram and some others drop the image when text comes along.
        await navigator.share({ files: [file] })
        return 'shared'
      } catch (err) {
        if (isCancel(err)) return 'cancelled'
        // NotAllowedError (activation expired) and friends: save it instead.
      }
    }
  } catch {
    // No File constructor (very old WebView): save it.
  }
  try {
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = filename
    a.style.display = 'none'
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(href), 10_000)
    toast('이미지를 저장했어요')
    return 'saved'
  } catch {
    toast('이미지를 저장하지 못했어요')
    return 'failed'
  }
}
