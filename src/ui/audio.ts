import { save } from '../core/storage'

/**
 * Small synthesized sounds, made in code (no files). Deliberately plain: no
 * fanfares, no jingles, and the same end tone whether the round went well or
 * badly. Celebratory feedback on trades makes people trade more
 * (Chapkovski et al. 2023), which is the habit this game wants to show, not
 * reward.
 *
 * Rules: off when settings.sound is off; the AudioContext starts on a user
 * gesture (unlockAudio); suspended while the app is in the background and
 * resumed when it comes back; never throws, even with no WebAudio at all.
 */

type Wave = OscillatorType

let ctx: AudioContext | null = null
let master: GainNode | null = null
let failed = false

function soundOn() {
  try {
    return save.getSettings().sound
  } catch {
    return false
  }
}

function create(): AudioContext | null {
  if (ctx || failed) return ctx
  try {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) {
      failed = true
      return null
    }
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = 0.6
    master.connect(ctx.destination)
    listen()
  } catch {
    failed = true
    ctx = null
  }
  return ctx
}

function suspend() {
  try {
    if (ctx && ctx.state === 'running') void ctx.suspend().catch(() => {})
  } catch {
    // Already closed.
  }
}

function resume() {
  try {
    if (ctx && ctx.state !== 'closed' && soundOn() && !document.hidden) void ctx.resume().catch(() => {})
  } catch {
    // Not allowed yet; the next gesture tries again.
  }
}

let listening = false
function listen() {
  if (listening) return
  listening = true
  const onVisibility = () => (document.hidden ? suspend() : resume())
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', suspend)
  window.addEventListener('pageshow', resume)
  // Capacitor and Cordova-style shells announce app pause and resume on document.
  document.addEventListener('pause', suspend)
  document.addEventListener('resume', resume)
}

/** Call from a user gesture (the first press on the pad, a settings toggle). */
export function unlockAudio() {
  if (!soundOn()) return
  if (create()) resume()
}

/** Settings toggled: stop at once when turned off, start when turned on (a gesture). */
export function setSoundEnabled(on: boolean) {
  if (on) unlockAudio()
  else suspend()
}

/** One enveloped note. Silent unless the context is running and sound is on. */
function note(freq: number, dur: number, opts: { wave?: Wave; gain?: number; delay?: number; to?: number } = {}) {
  if (!ctx || !master || ctx.state !== 'running' || !soundOn()) return
  try {
    const t0 = ctx.currentTime + (opts.delay ?? 0)
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.type = opts.wave ?? 'sine'
    osc.frequency.setValueAtTime(freq, t0)
    if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur)
    const peak = opts.gain ?? 0.15
    env.gain.setValueAtTime(0.0001, t0)
    env.gain.exponentialRampToValueAtTime(peak, t0 + 0.005)
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(env)
    env.connect(master)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
    osc.onended = () => {
      osc.disconnect()
      env.disconnect()
    }
  } catch {
    // A sound is never worth an error.
  }
}

export const sfx = {
  /** Soft click, slightly falling. */
  buy() {
    note(720, 0.06, { wave: 'triangle', gain: 0.16, to: 600 })
  },
  /** Same click, lower. */
  sell() {
    note(420, 0.07, { wave: 'triangle', gain: 0.16, to: 340 })
  },
  /** Confirmed news: two clear notes. A rumor: one dull, wavering note. */
  news(kind: 'filing' | 'rumor') {
    if (kind === 'filing') {
      note(880, 0.14, { gain: 0.1 })
      note(1320, 0.18, { gain: 0.08, delay: 0.09 })
    } else {
      note(620, 0.22, { wave: 'triangle', gain: 0.09, to: 560 })
    }
  },
  /** One second gone, in the last five. */
  tick() {
    note(1000, 0.03, { gain: 0.06 })
  },
  /** End of the round. The same tone for every result. */
  end() {
    note(523, 0.35, { gain: 0.12 })
  },
}
