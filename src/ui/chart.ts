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

export class Chart {
  private ctx: CanvasRenderingContext2D
  private w = 0
  private h = 0
  private lo = 0
  private hi = 0
  private palette: Palette
  private themeKey = ''
  private media = window.matchMedia('(prefers-color-scheme: dark)')

  constructor(
    private canvas: HTMLCanvasElement,
    private market: Market,
    private pad = { top: 16, right: 64, bottom: 16, left: 0 },
  ) {
    this.ctx = canvas.getContext('2d')!
    this.palette = readPalette()
  }

  /** Re-read colors when the OS scheme or an explicit data-theme changes. */
  private syncPalette() {
    const key = `${this.media.matches}|${document.documentElement.dataset.theme ?? ''}`
    if (key === this.themeKey) return
    this.themeKey = key
    this.palette = readPalette()
  }

  destroy() {}

  private fit() {
    const rect = this.canvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    const w = Math.round(rect.width * dpr)
    const h = Math.round(rect.height * dpr)
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.w = rect.width
    this.h = rect.height
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  private priceAt(abs: number) {
    const p = this.market.prices
    const i = Math.max(0, Math.min(p.length - 1, Math.floor(abs)))
    const j = Math.min(p.length - 1, i + 1)
    const f = abs - i
    return p[i] + (p[j] - p[i]) * Math.max(0, Math.min(1, f))
  }

  /** Draw a frame. `smooth` eases the y range so the chart does not jump. */
  draw(frame: ChartFrame, smooth = true) {
    this.fit()
    this.syncPalette()
    const { ctx, palette: c } = this
    const { from, to, head } = frame
    const prices = this.market.prices
    const last = Math.min(head, prices.length - 1)

    let lo = Infinity
    let hi = -Infinity
    for (let i = Math.max(0, Math.floor(from)); i <= Math.ceil(last); i++) {
      const v = prices[Math.min(i, prices.length - 1)]
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
      this.lo = targetLo < this.lo ? targetLo : this.lo + (targetLo - this.lo) * 0.06
      this.hi = targetHi > this.hi ? targetHi : this.hi + (targetHi - this.hi) * 0.06
    }

    const { top, right, bottom, left } = this.pad
    const plotW = this.w - left - right
    const plotH = this.h - top - bottom
    const x = (abs: number) => left + ((abs - from) / (to - from)) * plotW
    const y = (price: number) => top + (1 - (price - this.lo) / (this.hi - this.lo)) * plotH

    ctx.clearRect(0, 0, this.w, this.h)

    // Quiet horizontal guides.
    ctx.strokeStyle = c.grid
    ctx.lineWidth = 1
    for (let g = 1; g <= 3; g++) {
      const gy = Math.round(top + (plotH * g) / 4) + 0.5
      ctx.beginPath()
      ctx.moveTo(left, gy)
      ctx.lineTo(this.w - right + 8, gy)
      ctx.stroke()
    }

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
    type Seg = { a: number; b: number; entry: number }
    const segs: Seg[] = []
    const held = frame.held
    const H = this.market.historyTicks
    const playHead = head - H
    let open: Seg | null = null
    const lastWhole = Math.floor(playHead)
    for (let t = 0; t <= lastWhole; t++) {
      const isHeld = t < lastWhole ? !!held[t] : frame.holdingNow || !!held[t]
      if (isHeld && !open) {
        open = { a: t, b: t, entry: prices[H + t] }
      }
      if (open) {
        if (isHeld) open.b = Math.min(t + 1, playHead)
        else {
          segs.push(open)
          open = null
        }
      }
    }
    if (open) segs.push(open)

    for (const s of segs) {
      const a = H + s.a
      const b = H + s.b
      if (b <= a) continue
      const end = this.priceAt(b)
      ctx.fillStyle = end >= s.entry ? c.upSoft : c.downSoft
      ctx.beginPath()
      ctx.moveTo(x(a), this.h - bottom)
      for (let i = a; i < b; i++) ctx.lineTo(x(i), y(prices[i]))
      ctx.lineTo(x(b), y(end))
      ctx.lineTo(x(b), this.h - bottom)
      ctx.closePath()
      ctx.fill()
    }

    // Base line.
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.strokeStyle = c.ink
    ctx.lineWidth = 1.75
    ctx.beginPath()
    const first = Math.max(0, Math.floor(from))
    ctx.moveTo(x(first), y(prices[first]))
    for (let i = first + 1; i <= Math.floor(last); i++) ctx.lineTo(x(i), y(prices[i]))
    ctx.lineTo(x(last), y(this.priceAt(last)))
    ctx.stroke()

    // Colored overlay on held segments, split at the entry price.
    ctx.lineWidth = 2.5
    for (const s of segs) {
      const a = H + s.a
      const b = H + s.b
      let prevX = x(a)
      let prevY = y(prices[a])
      for (let i = a + 1; i <= Math.ceil(b); i++) {
        const abs = Math.min(i, b)
        const p = this.priceAt(abs)
        const up = p >= s.entry
        ctx.strokeStyle = up ? c.up : c.down
        ctx.beginPath()
        ctx.moveTo(prevX, prevY)
        ctx.lineTo(x(abs), y(p))
        ctx.stroke()
        prevX = x(abs)
        prevY = y(p)
      }
      // Entry level, only for the trade still open.
      if (frame.holdingNow && s === segs[segs.length - 1] && frame.showHeadTag) {
        ctx.save()
        ctx.setLineDash([3, 4])
        ctx.strokeStyle = c.ink3
        ctx.lineWidth = 1
        const ey = Math.round(y(s.entry)) + 0.5
        ctx.beginPath()
        ctx.moveTo(x(a), ey)
        ctx.lineTo(this.w - right + 8, ey)
        ctx.stroke()
        ctx.restore()
      }
    }

    // Headline markers along the bottom.
    ctx.fillStyle = c.ink3
    for (const m of frame.marks) {
      if (m > last || m < from) continue
      ctx.beginPath()
      ctx.arc(x(m), this.h - bottom + 8, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }

    if (frame.showHeadTag) {
      const hp = this.priceAt(last)
      const hx = x(last)
      const hy = y(hp)
      ctx.fillStyle = c.ink
      ctx.beginPath()
      ctx.arc(hx, hy, 4, 0, Math.PI * 2)
      ctx.fill()

      const label = formatPrice(hp)
      ctx.font = '600 12px "Pretendard Variable", Pretendard, system-ui, sans-serif'
      const tw = ctx.measureText(label).width
      const bw = tw + 14
      const bh = 22
      const bx = this.w - right + 10
      const by = Math.max(0, Math.min(this.h - bh, hy - bh / 2))
      ctx.fillStyle = c.ink
      ctx.beginPath()
      ctx.roundRect(bx, by, bw, bh, 6)
      ctx.fill()
      ctx.fillStyle = c.onInk
      ctx.textBaseline = 'middle'
      ctx.fillText(label, bx + 7, by + bh / 2 + 0.5)
    }
  }
}
