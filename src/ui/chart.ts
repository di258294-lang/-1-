import type { Market } from '../core/market'
import { formatPrice } from '../core/format'
import { cssVar } from './dom'

export type ChartFrame = {
  /** Absolute tick range on the x axis. */
  from: number
  to: number
  /** Absolute fractional tick up to which the line is drawn. */
  head: number
  /** Play-relative held flags. */
  held: boolean[]
  /** Whether the position is open right now (covers the partial last segment). */
  holdingNow: boolean
  /** Absolute ticks where headlines appeared. */
  marks: number[]
  showHeadTag: boolean
}

type Palette = {
  ink: string
  ink3: string
  ink4: string
  grid: string
  up: string
  upSoft: string
  down: string
  downSoft: string
  surface: string
  onInk: string
}

function readPalette(): Palette {
  return {
    ink: cssVar('--ink'),
    ink3: cssVar('--ink-3'),
    ink4: cssVar('--ink-4'),
    grid: cssVar('--grid'),
    up: cssVar('--up'),
    upSoft: cssVar('--up-soft'),
    down: cssVar('--down'),
    downSoft: cssVar('--down-soft'),
    surface: cssVar('--surface'),
    onInk: cssVar('--on-ink'),
  }
}

/** Above 2x the extra pixels are invisible on a chart but cost fill rate. */
const MAX_DPR = 2

const UP_DOWN = [true, false] as const

/** CanvasRenderingContext2D.roundRect is missing before iOS 16 / Chrome 99. */
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r)
    return
  }
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** What the last painted frame depended on; equal state means skip. */
type Drawn = {
  from: number
  to: number
  head: number
  held: boolean[]
  heldLen: number
  holdingNow: boolean
  marksLen: number
  showHeadTag: boolean
  lo: number
  hi: number
  w: number
  h: number
  dpr: number
  theme: string
}

/**
 * Price chart on a canvas. Per frame it only walks the visible window, and
 * batches every line of one color into a single path (a handful of stroke()
 * calls instead of one per tick). It never reads layout while drawing: the
 * size comes from a ResizeObserver, which also repaints the last frame on
 * resize. draw() returns early when nothing visible changed.
 */
export class Chart {
  private ctx: CanvasRenderingContext2D
  private w = 0
  private h = 0
  private dpr = 1
  private sized = false
  private lo = 0
  private hi = 0
  private palette: Palette
  private themeKey = ''
  private media = window.matchMedia('(prefers-color-scheme: dark)')
  private observer: ResizeObserver | null = null
  private lastFrame: ChartFrame | null = null
  private drawn: Drawn | null = null

  // Reused between frames.
  private xs = new Float64Array(0)
  private ys = new Float64Array(0)
  private segA: number[] = []
  private segB: number[] = []
  private segEntry: number[] = []

  constructor(
    private canvas: HTMLCanvasElement,
    private market: Market,
    private pad = { top: 16, right: 64, bottom: 16, left: 0 },
  ) {
    this.ctx = canvas.getContext('2d')!
    this.palette = readPalette()
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver((entries) => {
        const box = entries[entries.length - 1].contentRect
        if (box.width === this.w && box.height === this.h && this.sized) return
        this.w = box.width
        this.h = box.height
        this.sized = true
        // Repaint at the new size; the caller may not draw again (static charts).
        // Next frame, not inside the callback: resizing the backing store here
        // can re-trigger layout and the "ResizeObserver loop" warning.
        requestAnimationFrame(() => {
          if (this.lastFrame) this.draw(this.lastFrame, false)
        })
      })
      this.observer.observe(canvas)
    }
  }

  /** Re-read colors when the OS scheme or an explicit data-theme changes. */
  private syncPalette() {
    const key = `${this.media.matches}|${document.documentElement.dataset.theme ?? ''}`
    if (key === this.themeKey) return
    this.themeKey = key
    this.palette = readPalette()
  }

  destroy() {
    this.observer?.disconnect()
    this.observer = null
    this.lastFrame = null
  }

  /** Size the backing store. Reads layout only before the first observation. */
  private fit() {
    if (!this.sized || !this.observer) {
      const rect = this.canvas.getBoundingClientRect()
      this.w = rect.width
      this.h = rect.height
      // Without an observer, keep measuring every frame (old WebViews).
      if (this.observer && rect.width > 0) this.sized = true
    }
    this.dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
    const bw = Math.round(this.w * this.dpr)
    const bh = Math.round(this.h * this.dpr)
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw
      this.canvas.height = bh
      this.drawn = null
    }
  }

  private priceAt(abs: number) {
    const p = this.market.prices
    const i = Math.max(0, Math.min(p.length - 1, Math.floor(abs)))
    const j = Math.min(p.length - 1, i + 1)
    const f = abs - i
    return p[i] + (p[j] - p[i]) * Math.max(0, Math.min(1, f))
  }

  /** True when the canvas already shows exactly this state. */
  private unchanged(frame: ChartFrame) {
    const d = this.drawn
    return (
      d !== null &&
      d.from === frame.from &&
      d.to === frame.to &&
      d.head === frame.head &&
      d.held === frame.held &&
      d.heldLen === frame.held.length &&
      d.holdingNow === frame.holdingNow &&
      d.marksLen === frame.marks.length &&
      d.showHeadTag === frame.showHeadTag &&
      d.lo === this.lo &&
      d.hi === this.hi &&
      d.w === this.w &&
      d.h === this.h &&
      d.dpr === this.dpr &&
      d.theme === this.themeKey
    )
  }

  /**
   * Held segments overlapping [from, head], in play-relative ticks: start a,
   * fractional end b, and the entry price. A segment that began before the
   * window keeps its real entry so its color stays right.
   */
  private collectSegments(frame: ChartFrame) {
    const { segA, segB, segEntry } = this
    segA.length = segB.length = segEntry.length = 0
    const prices = this.market.prices
    const held = frame.held
    const H = this.market.historyTicks
    const playHead = frame.head - H
    const lastWhole = Math.floor(playHead)
    const isHeld = (t: number) => (t < lastWhole ? !!held[t] : frame.holdingNow || !!held[t])

    let t = Math.max(0, Math.floor(frame.from) - H)
    if (t > lastWhole) return
    // Walk back to the start of a trade already open at the window's edge.
    if (isHeld(t)) while (t > 0 && held[t - 1]) t--

    let open = -1
    let end = 0
    for (; t <= lastWhole; t++) {
      if (isHeld(t)) {
        if (open < 0) open = t
        end = Math.min(t + 1, playHead)
      } else if (open >= 0) {
        segA.push(open)
        segB.push(end)
        segEntry.push(prices[H + open])
        open = -1
      }
    }
    if (open >= 0) {
      segA.push(open)
      segB.push(end)
      segEntry.push(prices[H + open])
    }
  }

  /** Draw a frame. `smooth` eases the y range so the chart does not jump. */
  draw(frame: ChartFrame, smooth = true) {
    this.lastFrame = frame
    this.fit()
    this.syncPalette()
    if (this.w <= 0 || this.h <= 0) return
    const { from, to, head } = frame
    const prices = this.market.prices
    const last = Math.min(head, prices.length - 1)
    const first = Math.max(0, Math.floor(from))
    const lastIdx = Math.min(prices.length - 1, Math.ceil(last))

    let lo = Infinity
    let hi = -Infinity
    for (let i = first; i <= lastIdx; i++) {
      const v = prices[i]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    const span = Math.max(hi - lo, hi * 0.02)
    const targetLo = lo - span * 0.12
    const targetHi = hi + span * 0.12
    if (!smooth || this.hi === 0) {
      this.lo = targetLo
      this.hi = targetHi
    } else {
      // Expand instantly, shrink slowly, so new extremes never leave the frame.
      // Snap once the gap is far below a pixel so a paused chart settles.
      const eps = (this.hi - this.lo) * 1e-4
      this.lo = targetLo < this.lo || Math.abs(targetLo - this.lo) < eps ? targetLo : this.lo + (targetLo - this.lo) * 0.06
      this.hi = targetHi > this.hi || Math.abs(targetHi - this.hi) < eps ? targetHi : this.hi + (targetHi - this.hi) * 0.06
    }

    if (this.unchanged(frame)) return
    this.drawn = {
      from,
      to,
      head,
      held: frame.held,
      heldLen: frame.held.length,
      holdingNow: frame.holdingNow,
      marksLen: frame.marks.length,
      showHeadTag: frame.showHeadTag,
      lo: this.lo,
      hi: this.hi,
      w: this.w,
      h: this.h,
      dpr: this.dpr,
      theme: this.themeKey,
    }

    const { ctx, palette: c } = this
    const { top, right, bottom, left } = this.pad
    const plotW = this.w - left - right
    const plotH = this.h - top - bottom
    const xScale = plotW / (to - from)
    const yScale = plotH / (this.hi - this.lo)
    const yBase = top + plotH
    const x = (abs: number) => left + (abs - from) * xScale
    const y = (price: number) => yBase - (price - this.lo) * yScale

    // Screen coordinates of every whole tick in view, computed once.
    const n = lastIdx - first + 1
    if (this.xs.length < n) {
      this.xs = new Float64Array(n + 256)
      this.ys = new Float64Array(n + 256)
    }
    const { xs, ys } = this
    for (let i = 0; i < n; i++) {
      xs[i] = x(first + i)
      ys[i] = y(prices[first + i])
    }
    const headX = x(last)
    const headY = y(this.priceAt(last))

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.w, this.h)

    // Quiet horizontal guides.
    ctx.strokeStyle = c.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let g = 1; g <= 3; g++) {
      const gy = Math.round(top + (plotH * g) / 4) + 0.5
      ctx.moveTo(left, gy)
      ctx.lineTo(this.w - right + 8, gy)
    }
    ctx.stroke()

    // Round start marker.
    const startX = x(this.market.historyTicks)
    if (startX > left && startX < this.w - right) {
      ctx.save()
      ctx.setLineDash([2, 4])
      ctx.strokeStyle = c.ink4
      ctx.beginPath()
      ctx.moveTo(Math.round(startX) + 0.5, top)
      ctx.lineTo(Math.round(startX) + 0.5, this.h - bottom)
      ctx.stroke()
      ctx.restore()
    }

    // Held segments: tinted area plus a colored line, red while the trade is
    // above its entry and blue while below, the way Korean brokers show P&L.
    this.collectSegments(frame)
    const { segA, segB, segEntry } = this
    const H = this.market.historyTicks
    const segCount = segA.length

    // Areas, one fill per color. Segments never overlap.
    for (const up of UP_DOWN) {
      let any = false
      ctx.beginPath()
      for (let s = 0; s < segCount; s++) {
        const a = Math.max(H + segA[s], first)
        const b = H + segB[s]
        if (b <= a) continue
        const end = this.priceAt(b)
        if (end >= segEntry[s] !== up) continue
        any = true
        ctx.moveTo(xs[a - first], this.h - bottom)
        for (let i = a; i < b; i++) ctx.lineTo(xs[i - first], ys[i - first])
        ctx.lineTo(x(b), y(end))
        ctx.lineTo(x(b), this.h - bottom)
        ctx.closePath()
      }
      if (any) {
        ctx.fillStyle = up ? c.upSoft : c.downSoft
        ctx.fill()
      }
    }

    // Base line.
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.strokeStyle = c.ink
    ctx.lineWidth = 1.75
    ctx.beginPath()
    ctx.moveTo(xs[0], ys[0])
    const lastWhole = Math.floor(last)
    for (let i = first + 1; i <= lastWhole; i++) ctx.lineTo(xs[i - first], ys[i - first])
    ctx.lineTo(headX, headY)
    ctx.stroke()

    // Colored overlay on held segments, split at the entry price: each
    // tick-to-tick piece takes the color of its end point. One path per color.
    ctx.lineWidth = 2.5
    for (const up of UP_DOWN) {
      let any = false
      ctx.beginPath()
      for (let s = 0; s < segCount; s++) {
        const a = Math.max(H + segA[s], first)
        const b = H + segB[s]
        if (b <= a) continue
        const entry = segEntry[s]
        let penDown = false
        let px = xs[a - first]
        let py = ys[a - first]
        const stop = Math.ceil(b)
        for (let i = a + 1; i <= stop; i++) {
          let cx: number
          let cy: number
          let p: number
          if (i <= b) {
            cx = xs[i - first]
            cy = ys[i - first]
            p = prices[i]
          } else {
            p = this.priceAt(b)
            cx = x(b)
            cy = y(p)
          }
          if (p >= entry === up) {
            if (!penDown) ctx.moveTo(px, py)
            ctx.lineTo(cx, cy)
            penDown = true
            any = true
          } else penDown = false
          px = cx
          py = cy
        }
      }
      if (any) {
        ctx.strokeStyle = up ? c.up : c.down
        ctx.stroke()
      }
    }

    // Entry level, only for the trade still open.
    if (frame.holdingNow && frame.showHeadTag && segCount > 0) {
      const s = segCount - 1
      ctx.save()
      ctx.setLineDash([3, 4])
      ctx.strokeStyle = c.ink3
      ctx.lineWidth = 1
      const ey = Math.round(y(segEntry[s])) + 0.5
      ctx.beginPath()
      ctx.moveTo(Math.max(left, x(H + segA[s])), ey)
      ctx.lineTo(this.w - right + 8, ey)
      ctx.stroke()
      ctx.restore()
    }

    // Headline markers along the bottom, one fill.
    let anyMark = false
    ctx.beginPath()
    const my = this.h - bottom + 8
    for (const m of frame.marks) {
      if (m > last || m < from) continue
      const mx = x(m)
      ctx.moveTo(mx + 2.5, my)
      ctx.arc(mx, my, 2.5, 0, Math.PI * 2)
      anyMark = true
    }
    if (anyMark) {
      ctx.fillStyle = c.ink3
      ctx.fill()
    }

    if (frame.showHeadTag) {
      const hp = this.priceAt(last)
      ctx.fillStyle = c.ink
      ctx.beginPath()
      ctx.arc(headX, headY, 4, 0, Math.PI * 2)
      ctx.fill()

      const label = formatPrice(hp)
      ctx.font = '600 12px "HOLD Sans", system-ui, sans-serif'
      const tw = ctx.measureText(label).width
      const bw = tw + 14
      const bh = 22
      // Keep the whole tag on screen, even for wide prices.
      const bx = Math.min(this.w - right + 10, this.w - bw - 6)
      const by = Math.max(0, Math.min(this.h - bh, headY - bh / 2))
      ctx.beginPath()
      roundRect(ctx, bx, by, bw, bh, 6)
      ctx.fill()
      ctx.fillStyle = c.onInk
      ctx.textBaseline = 'middle'
      ctx.fillText(label, bx + 7, by + bh / 2 + 0.5)
    }
  }
}
