import { playPrice, TICKS_PER_SECOND, type Market, type RoundLength } from './market'
import type { ProductKey } from './products'
import { showsChance, skillTest } from './skill'

/**
 * Trading habits from behavioral finance, measured from one round's
 * press/release log. Every score is 0..1, higher means the habit showed more.
 *
 * Every score is built as evidence against a P&L-blind random trader on the
 * same chart: a habit only shows when the player's behavior is unlikely to
 * come from pressing at random. That keeps a random presser from being told
 * they have a habit, on every product and round length.
 */
export type HabitKey = 'holder' | 'chicken' | 'scalper' | 'chaser' | 'rumor'
/**
 * A habit type, or one of three "no habit" types: 'machine' (no habit, and
 * timing better than random by the records card's own skill test),
 * 'steady' (in the market, no habit, no timing edge shown yet: "탐색 중")
 * and 'watcher' (barely in the market).
 */
export type TypeKey = HabitKey | 'machine' | 'steady' | 'watcher'
export type HabitScores = Record<HabitKey, number>

export const HABIT_KEYS: readonly HabitKey[] = ['holder', 'chicken', 'scalper', 'chaser', 'rumor']

export const HABIT_LABELS: Record<HabitKey, string> = {
  holder: '손실 버티기',
  chicken: '너무 일찍 팔기',
  scalper: '잦은 매매',
  chaser: '오른 뒤 따라 사기',
  rumor: '소문 반응',
}

export const TYPES: Record<TypeKey, { name: string; line: string; tip: string }> = {
  holder: {
    name: '존버형',
    line: '떨어져도 놓지 않아요. 언젠가 오를 거라 믿죠. 손실은 오래, 수익은 짧게 가져가는 습관으로, 개인 투자자 연구에서 자주 관찰돼요.',
    tip: '손실이 깊어지기 전에 손을 떼 보기',
  },
  chicken: {
    name: '새가슴형',
    line: '조금만 올라도 팔아요. 수익을 챙기는 기분은 좋지만, 큰 상승은 대부분 놓쳐요.',
    tip: '수익 중일 때 1초만 더 누르고 있어 보기',
  },
  scalper: {
    name: '자주 사고파는 형',
    line: '가만히 있질 못해요. 매매할 때마다 수수료가 빠지니, 가장 큰 적은 시장이 아니라 내 손가락이에요.',
    tip: '매매 5번 이하로 한 판 끝내 보기',
  },
  chaser: {
    name: '따라 사는 형',
    line: '오르는 걸 보고 올라타요. 확신이 생겼을 땐 이미 많이 오른 뒤라, 꼭대기 근처에서 사는 일이 잦아요.',
    tip: '2초 사이 크게 오른 직후엔 한 박자 쉬어 보기',
  },
  rumor: {
    name: '소문 따라가는 형',
    line: '소문에 제일 먼저 움직여요. 빠르긴 한데, 이 게임의 소문은 반쯤 틀려서 결국 동전 던지기를 하는 셈이에요.',
    tip: '소문이 뜨면 가격이 실제로 움직이는지 보고 누르기',
  },
  machine: {
    name: '냉정한 기계형',
    line: '뚜렷한 나쁜 습관이 안 보이고, 아무 때나 누른 것보다 타이밍이 나았어요.',
    tip: '이 감각 그대로 오늘의 차트에서 시즌 계좌 키워 보기',
  },
  steady: {
    name: '탐색 중',
    line: '눈에 띄는 습관은 없지만, 아무 때나 누른 것보다 나은 타이밍은 아직 보이지 않았어요. 판이 쌓이면 달라질 수 있어요.',
    tip: '공식 발표가 뜨면 누르고, 가격이 움직일 때까지 들고 있어 보기',
  },
  watcher: {
    name: '관망형',
    line: '사고파는 일이 적거나 들고 있는 시간이 짧아서, 습관도 타이밍도 아직 드러나지 않았어요. 판이 쌓이면 달라져요.',
    tip: '공식 발표가 뜨면 누르고, 가격이 움직일 때까지 들고 있어 보기',
  },
}

/** Types with no leading habit: nothing is highlighted for them. */
export const NO_HABIT_TYPES: readonly TypeKey[] = ['machine', 'steady', 'watcher']

/** Rounds with at least one trade needed before a type is shown. */
export const PROFILE_MIN_ROUNDS = 5
/** Only the most recent rounds count, so the type can change as you do. */
export const PROFILE_WINDOW = 10

const AFTER_EXIT_TICKS = 3 * TICKS_PER_SECOND
const CHASE_LOOKBACK_TICKS = 2 * TICKS_PER_SECOND
/** A chase is buying right after a move of this many standard deviations. */
const CHASE_SIGMAS = 2
/** Ticks (2 s) a player must have spent both up and down before comparing sell rates. */
const MIN_STATE_TICKS = 20
/** Sells in a round before its sell rates are compared at all. */
const MIN_ROUND_SELLS = 3
/**
 * Sells while up needed before one round can claim a disposition effect.
 * Sells while down are not required: never selling at a loss is its purest form.
 */
const MIN_ROUND_WIN_SELLS = 3
/** Sell-rate ratio below which a difference is not worth naming. */
const MIN_HAZARD_RATIO = 1.5
/** One-sided 5% level: pooled evidence must clear this to name a habit. */
const Z_FLAG = 1.64
/** Clean exits needed before the profile judges selling winners early. */
const MIN_POOLED_EXITS = 5
/**
 * Expected worst point of a driftless random walk over n steps, in units of
 * sigma * sqrt(n): E[max of -W] = sqrt(2 / pi) ≈ 0.80 (reflection principle).
 */
const RW_DRAWDOWN = Math.sqrt(2 / Math.PI)
/** Losers held at least this long (1 s) count toward depth; a tap is not riding a loss. */
const MIN_DEPTH_TICKS = TICKS_PER_SECOND
/** A profile habit at or above this names the type (the pooled 5% level). */
export const TYPE_MIN = 0.3

export type Trade = {
  entry: number
  /** Exclusive; playTicks means it was closed at the bell. */
  exit: number
  ret: number
  /** Worst point during the trade, relative to entry (<= 0). */
  worst: number
}

export function tradesFrom(market: Market, held: boolean[]): Trade[] {
  const playTicks = market.playTicks
  const trades: Trade[] = []
  let t = 0
  while (t < playTicks) {
    if (!held[t]) {
      t++
      continue
    }
    const entry = t
    while (t < playTicks && held[t]) t++
    const p0 = playPrice(market, entry)
    let low = p0
    for (let i = entry; i <= t; i++) low = Math.min(low, playPrice(market, i))
    trades.push({ entry, exit: t, ret: playPrice(market, t) / p0 - 1, worst: low / p0 - 1 })
  }
  return trades
}

/** Raw sell/exposure tick counts behind the disposition measure, for pooling. */
export type HabitCounts = { sellUp: number; expUp: number; sellDown: number; expDown: number }

/**
 * Sufficient statistics of one round, so the profile can pool evidence across
 * rounds instead of averaging noisy per-round scores. Stored on the record.
 */
export type HabitEvidence = {
  /**
   * Winners sold with a news-free 3 s window after, and the sum of how far the
   * move after each beat random winners of the same length on the chart (z).
   */
  exits: number
  exitZ: number
  /** Losing trades held 1 s or more, the sum of their worst points and of the random-walk expectation for them (as returns). */
  losses: number
  depth: number
  depthBase: number
  /** Rumors, reactions before the price moved, and how many chance alone would give on average. */
  rumors: number
  rumorHits: number
  rumorChance: number
  /** Buys right after a spike, and how many random presses would give on average. */
  chases: number
  chaseChance: number
}

export type RoundHabits = {
  trades: number
  scores: HabitScores
  /** Whether each habit could be measured at all this round (e.g. no losses = no holder score). */
  measurable: Record<HabitKey, boolean>
  counts: HabitCounts
  evidence: HabitEvidence
  facts: {
    lossTrades: number
    winTrades: number
    avgLossWorst: number
    avgLossHoldSec: number
    avgWinHoldSec: number
    /** Average move in the 3 seconds after selling a winner (news-free windows only). */
    missedAfterWin: number
    /** Winners whose 3 s after the sale had no news gap, the ones missedAfterWin averages. */
    cleanWinExits: number
    /** Losing trades held 1 s or more: their average worst point, and that depth over what a random hold of the same length would see (1 = normal). */
    heldLossWorst: number
    lossDepthRatio: number
    chaseEntries: number
    rumors: number
    rumorReactions: number
    wrongRumorReactions: number
    filings: number
    filingReactions: number
    fees: number
    /** Chance of selling within one second while up / while down. */
    sellRateUp: number
    sellRateDown: number
    /** Sells made while up / while down. */
    sellsUp: number
    sellsDown: number
    /** Evidence (z) that you sold faster while up than while down. */
    dispositionZ: number
    /** True when the round had enough time both up and down, and enough sells, to compare them. */
    comparableRates: boolean
    /** Which evidence the holder score came from: sell rates, loss depth, or neither. */
    holderBasis: 'rates' | 'depth' | 'none'
  }
}

const ramp = (x: number, lo: number, hi: number) => Math.max(0, Math.min(1, (x - lo) / (hi - lo)))
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/**
 * Per-tick volatility of this chart: the standard deviation of tick log
 * returns, leaving out the ticks around each news gap. Median-based
 * estimators understate it with fat tails and volatility clustering, which
 * would quietly turn "2 sigma" into 1.3 sigma, differently per product.
 */
export function tickVolatility(market: Market) {
  const skip = new Set<number>()
  for (const n of market.news) for (let d = -1; d <= 1; d++) skip.add(n.impactAt + d)
  const r: number[] = []
  for (let t = 1; t <= market.playTicks; t++) {
    if (!skip.has(t)) r.push(Math.log(playPrice(market, t) / playPrice(market, t - 1)))
  }
  if (r.length < 2) return 1e-6
  const mu = mean(r)
  const variance = r.reduce((a, x) => a + (x - mu) * (x - mu), 0) / (r.length - 1)
  return Math.max(1e-6, Math.sqrt(variance))
}

/**
 * Disposition effect as a rate comparison (Shefrin & Statman 1985; Odean
 * 1998): sells per tick spent up versus per tick spent down, as a log hazard
 * ratio with a half-sell continuity correction and its Poisson standard
 * error. Works on one round or on counts pooled across rounds.
 */
export function dispositionTest(c: HabitCounts) {
  const ok = c.expUp >= MIN_STATE_TICKS && c.expDown >= MIN_STATE_TICKS
  if (!ok) return { ok, ratio: 1, z: 0, rateUp: 0, rateDown: 0 }
  const rateUp = (c.sellUp + 0.5) / c.expUp
  const rateDown = (c.sellDown + 0.5) / c.expDown
  const z = Math.log(rateUp / rateDown) / Math.sqrt(1 / (c.sellUp + 0.5) + 1 / (c.sellDown + 0.5))
  return { ok, ratio: rateUp / rateDown, z, rateUp, rateDown }
}

/** Chance of at least `hits` successes among independent trials with these probabilities. */
function atLeast(hits: number, ps: number[]) {
  let dist = [1]
  for (const p of ps) {
    const next = new Array<number>(dist.length + 1).fill(0)
    dist.forEach((q, k) => {
      next[k] += q * (1 - p)
      next[k + 1] += q * p
    })
    dist = next
  }
  return sum(dist.slice(hits))
}

export function analyzeRound(market: Market, held: boolean[], fees: number): RoundHabits {
  const playTicks = market.playTicks
  const trades = tradesFrom(market, held)
  const losses = trades.filter((t) => t.ret < 0)
  const wins = trades.filter((t) => t.ret > 0)
  const sec = (t: Trade) => (t.exit - t.entry) / TICKS_PER_SECOND
  // Every price threshold below is in units of this chart's own volatility,
  // so a 2% dip means the same thing on a calm bond as on a wild coin.
  const vol = tickVolatility(market)
  const impacts = market.news.map((n) => n.impactAt)
  const gapsIn = (from: number, to: number) => impacts.filter((t) => t >= from && t <= to)

  const avgLossWorst = mean(losses.map((t) => t.worst))
  const avgLossHoldSec = mean(losses.map(sec))
  const avgWinHoldSec = mean(wins.map(sec))

  // Disposition: sell rates while up versus while down, tick by tick.
  let expGain = 0
  let expLoss = 0
  let sellGain = 0
  let sellLoss = 0
  let entryPrice = 0
  let entries = 0
  let heldTicks = 0
  for (let t = 0; t < playTicks; t++) {
    if (held[t]) heldTicks++
    if (t > 0 && held[t - 1]) {
      const up = playPrice(market, t) > entryPrice
      if (up) expGain++
      else expLoss++
      if (!held[t]) {
        if (up) sellGain++
        else sellLoss++
      }
    }
    if (held[t] && (t === 0 || !held[t - 1])) {
      entryPrice = playPrice(market, t)
      entries++
    }
  }
  const counts: HabitCounts = { sellUp: sellGain, expUp: expGain, sellDown: sellLoss, expDown: expLoss }
  const disp = dispositionTest(counts)
  const comparable = disp.ok && sellGain + sellLoss >= MIN_ROUND_SELLS
  const dispScore =
    comparable && sellGain >= MIN_ROUND_WIN_SELLS && disp.ratio >= MIN_HAZARD_RATIO ? ramp(disp.z, 1.28, 2.33) : 0

  // Depth: how far losers you really held (1 s or more) fell, compared with
  // a random hold of the same length (wall-clock ticks, not days), excusing
  // any news gap inside it.
  const heldLosses = losses.filter((t) => t.exit - t.entry >= MIN_DEPTH_TICKS)
  const depth = sum(heldLosses.map((t) => -t.worst))
  const depthBase = sum(
    heldLosses.map((t) => {
      const gaps = gapsIn(t.entry + 1, t.exit).map((i) => Math.abs(Math.log(playPrice(market, i) / playPrice(market, i - 1))))
      return RW_DRAWDOWN * vol * Math.sqrt(t.exit - t.entry) + sum(gaps)
    }),
  )
  const lossDepthRatio = depthBase > 0 ? depth / depthBase : 0
  // One loser is enough only when it went far beyond anything chance gives.
  const depthScore = heldLosses.length
    ? ramp(lossDepthRatio, 2.5, 4) * (heldLosses.length >= 2 ? 1 : 0.5 + 0.5 * ramp(lossDepthRatio, 4, 8))
    : 0
  const holder = Math.max(dispScore, depthScore)

  // Selling winners early: did the price keep rising after you sold, more
  // than it does after a random winning trade of the same length on this
  // chart? Trends make every winner's next move lean up a little, so the raw
  // move alone would accuse anyone who ever sold a winner. News gaps are
  // left out, and the habit counts only when the price really kept rising.
  const W = AFTER_EXIT_TICKS
  const cleanAfter = new Array<boolean>(playTicks + 1).fill(false)
  for (let e = 0; e + W <= playTicks; e++) cleanAfter[e] = gapsIn(e, e + W + 1).length === 0
  const moveAfter = (e: number) => Math.log(playPrice(market, e + W) / playPrice(market, e))
  const baselines = new Map<number, { mu: number; sd: number } | null>()
  const baseline = (len: number) => {
    if (!baselines.has(len)) {
      const xs: number[] = []
      for (let e = len; e + W <= playTicks; e++) {
        if (cleanAfter[e] && playPrice(market, e) > playPrice(market, e - len)) xs.push(moveAfter(e))
      }
      const mu = mean(xs)
      const sd = xs.length > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - mu) * (x - mu), 0) / (xs.length - 1)) : 0
      baselines.set(len, xs.length >= 5 ? { mu, sd: Math.max(sd, 0.1 * vol * Math.sqrt(W)) } : null)
    }
    return baselines.get(len) ?? null
  }
  const exitScores: number[] = []
  const exitMoves: number[] = []
  for (const t of wins) {
    if (!cleanAfter[t.exit]) continue
    const b = baseline(Math.max(1, t.exit - t.entry))
    if (!b) continue
    const m = moveAfter(t.exit)
    exitMoves.push(m)
    exitScores.push((m - b.mu) / b.sd)
  }
  const exits = exitMoves.length
  const exitZ = sum(exitScores)
  const missedAfterWin = mean(exitMoves.map((x) => Math.exp(x) - 1))
  const chicken =
    exits >= 2 && missedAfterWin > 0 && exitZ > 0
      ? ramp(exitZ / Math.sqrt(exits), 1.28, 2.33) * Math.min(1, exits / 3)
      : 0

  // Normalized to trades per 40 seconds so short and long rounds compare.
  const scalper = ramp(trades.length * (400 / playTicks), 6, 14)

  const chased = (t: number) => {
    const from = Math.max(0, t - CHASE_LOOKBACK_TICKS)
    return t - from >= 5 && Math.log(playPrice(market, t) / playPrice(market, from)) > CHASE_SIGMAS * vol * Math.sqrt(t - from)
  }
  const chaseEntries = trades.filter((t) => chased(t.entry)).length
  // How often a press at a random moment on this chart lands right after a spike.
  let spikeTicks = 0
  for (let t = 5; t < playTicks; t++) if (chased(t)) spikeTicks++
  const chaseBase = spikeTicks / Math.max(1, playTicks - 5)
  const chaseExcess = trades.length ? (chaseEntries - trades.length * chaseBase) / trades.length : 0
  // One lucky buy is not a habit: a single round needs two.
  const chaser = ramp(chaseExcess, 0.25, 0.75) * (chaseEntries >= 2 ? 1 : 0.4)

  // Did you act in the headline's direction before the price moved? A press
  // on or after the gap is a reaction to the price, not to the headline.
  const reacted = (from: number, to: number, implied: 1 | -1) => {
    for (let t = Math.max(1, from); t < to && t < playTicks; t++) {
      if (implied > 0 && held[t] && !held[t - 1]) return true
      if (implied < 0 && !held[t] && held[t - 1]) return true
    }
    return false
  }
  // How often you would have done that anyway, pressing at your own pace.
  const rateIn = entries / Math.max(1, playTicks - heldTicks)
  const rateOut = (sellGain + sellLoss) / Math.max(1, heldTicks)
  const chanceOf = (from: number, to: number, implied: 1 | -1) => {
    const len = Math.max(0, Math.min(to, playTicks) - Math.max(1, from))
    const pIn = 1 - Math.exp(-rateIn * len)
    const pOut = 1 - Math.exp(-rateOut * len)
    const holding = held[Math.max(0, from - 1)]
    if (implied > 0) return holding ? pOut * (1 - Math.exp(-rateIn * len * 0.5)) : pIn
    return holding ? pOut : pIn * (1 - Math.exp(-rateOut * len * 0.5))
  }
  let rumors = 0
  let rumorReactions = 0
  let wrongRumorReactions = 0
  let filings = 0
  let filingReactions = 0
  const rumorChances: number[] = []
  for (const n of market.news) {
    const hit = reacted(n.at, n.impactAt, n.implied)
    if (n.kind === 'rumor') {
      rumors++
      rumorChances.push(chanceOf(n.at, n.impactAt, n.implied))
      if (hit) {
        rumorReactions++
        if (n.actual !== n.implied) wrongRumorReactions++
      }
    } else {
      filings++
      if (hit) filingReactions++
    }
  }
  // Scored by how unlikely that many reactions would be by chance.
  const pChance = atLeast(rumorReactions, rumorChances)
  const rumor = rumorReactions ? ramp(-Math.log10(Math.max(pChance, 1e-9)), 0.7, 2) * (rumorReactions >= 2 ? 1 : 0.4) : 0

  const perSecond = (h: number) => 1 - (1 - Math.min(1, h)) ** TICKS_PER_SECOND

  return {
    trades: trades.length,
    scores: { holder, chicken, scalper, chaser, rumor },
    measurable: {
      holder: losses.length > 0 || comparable,
      chicken: exits > 0,
      scalper: trades.length > 0,
      chaser: trades.length > 0,
      rumor: rumors > 0,
    },
    counts,
    evidence: {
      exits,
      exitZ,
      losses: heldLosses.length,
      depth,
      depthBase,
      rumors,
      rumorHits: rumorReactions,
      rumorChance: sum(rumorChances),
      chases: chaseEntries,
      chaseChance: trades.length * chaseBase,
    },
    facts: {
      lossTrades: losses.length,
      winTrades: wins.length,
      avgLossWorst,
      avgLossHoldSec,
      avgWinHoldSec,
      missedAfterWin,
      cleanWinExits: exits,
      heldLossWorst: -depth / Math.max(1, heldLosses.length),
      lossDepthRatio,
      chaseEntries,
      rumors,
      rumorReactions,
      wrongRumorReactions,
      filings,
      filingReactions,
      fees,
      sellRateUp: perSecond(disp.rateUp),
      sellRateDown: perSecond(disp.rateDown),
      sellsUp: sellGain,
      sellsDown: sellLoss,
      dispositionZ: disp.z,
      comparableRates: comparable,
      holderBasis: holder <= 0 ? 'none' : dispScore >= Math.min(0.5, depthScore) ? 'rates' : 'depth',
    },
  }
}

export type Insight = { tone: 'warn' | 'good' | 'none'; habit?: HabitKey; title: string; line: string }

/** "1.2%", with more digits for moves too small to show at one decimal. */
const pct = (x: number) => {
  const a = Math.abs(x) * 100
  return `${a >= 0.1 ? a.toFixed(1) : a.toFixed(2)}%`
}
const man = (won: number) => `${Math.round(won / 10_000).toLocaleString('ko-KR')}만 원`
const times = (x: number) => `${x.toFixed(1)}배`

/** The one thing worth telling the player about this round. */
export function roundInsight(h: RoundHabits): Insight {
  const f = h.facts
  if (h.trades === 0) {
    return { tone: 'none', title: '이번 판은 지켜보기만 했어요', line: '매매가 없어서 습관을 볼 수 없었어요.' }
  }
  const top = HABIT_KEYS.reduce((a, b) => (h.scores[b] > h.scores[a] ? b : a))
  if (h.scores[top] >= 0.5) {
    switch (top) {
      case 'holder': {
        // Quote whichever evidence actually drove the score.
        const ratio = f.sellRateUp / Math.max(f.sellRateDown, 1e-9)
        if (f.holderBasis === 'rates' && ratio >= MIN_HAZARD_RATIO) {
          return {
            tone: 'warn',
            habit: top,
            title: '수익은 빨리 팔고, 손실은 버텼어요',
            line: `수익 중에 ${f.sellsUp}번, 손실 중에 ${f.sellsDown}번 팔았어요. 들고 있던 시간을 감안하면, 수익 중일 때 1초 안에 팔 확률이 손실 중일 때의 ${times(ratio)}였어요. 오르면 빨리 팔고 내리면 버티는 습관이에요.`,
          }
        }
        return {
          tone: 'warn',
          habit: top,
          title: '손실을 끝까지 버텼어요',
          line: `1초 넘게 들고 있던 손실 매매에서 평균 -${pct(f.heldLossWorst)}까지 내려가도 들고 있었어요. 같은 시간 동안 보통 흔들리는 폭의 ${times(f.lossDepthRatio)}예요.`,
        }
      }
      case 'chicken':
        return {
          tone: 'warn',
          habit: top,
          title: '수익 중에 너무 일찍 팔았어요',
          line: `수익 중에 ${f.cleanWinExits}번 팔았는데, 팔고 나서 3초 동안 가격이 평균 ${pct(f.missedAfterWin)} 더 올랐어요.`,
        }
      case 'scalper':
        return {
          tone: 'warn',
          habit: top,
          title: '너무 자주 사고팔았어요',
          line: `${h.trades}번 매매했고, 수수료로만 ${man(f.fees)}이 나갔어요.`,
        }
      case 'chaser':
        return {
          tone: 'warn',
          habit: top,
          title: '급하게 오른 뒤에 올라탔어요',
          line: `${h.trades}번 산 것 중 ${f.chaseEntries}번이 2초 사이 평소 흔들림의 두 배 넘게 급등한 직후였어요.`,
        }
      case 'rumor':
        return {
          tone: 'warn',
          habit: top,
          title: '소문에 바로 움직였어요',
          line:
            `소문 ${f.rumors}개 중 ${f.rumorReactions}개에 가격이 움직이기 전에 반응했어요.` +
            (f.wrongRumorReactions ? ` 그중 ${f.wrongRumorReactions}개는 틀린 소문이었어요.` : ''),
        }
    }
  }
  if (f.filingReactions > 0) {
    return {
      tone: 'good',
      title: '공식 발표에 빠르게 반응했어요',
      line: `공식 발표 ${f.filings}개 중 ${f.filingReactions}개에 가격보다 먼저 맞게 움직였어요.`,
    }
  }
  // Shallower than a random hold of the same length would usually go.
  if (f.lossTrades >= 2 && f.lossDepthRatio > 0 && f.lossDepthRatio < 1) {
    return {
      tone: 'good',
      title: '손실을 빨리 정리했어요',
      line: `손실 난 매매를 평균 -${pct(f.avgLossWorst)} 안에서 정리했어요.`,
    }
  }
  return { tone: 'good', title: '눈에 띄는 나쁜 습관이 없었어요', line: '이번 판은 깔끔하게 매매했어요.' }
}

/**
 * One analyzed round as stored in the save file. Everything the profile,
 * missions and records screens need is here, so they never re-simulate.
 */
export type HabitRecord = {
  /** 'd:<dateKey>' for daily rounds, 'p:<timestamp>' for practice. */
  id: string
  /** KST date key the round was played on ('' for records migrated from v1). */
  at: string
  product: ProductKey
  length: RoundLength
  trades: number
  heldRatio: number
  scores: HabitScores
  measurable: Record<HabitKey, boolean>
  counts: HabitCounts
  /** Luck-test percentile (0..1), filled in after the result screen computes it. */
  luckPct: number | null
  /** RoundHabits.evidence, so the profile can pool rounds. Missing on older records. */
  evidence?: HabitEvidence
}

export type Profile = {
  type: TypeKey
  scores: HabitScores
  rounds: number
  /** Mean share of the round held, over rounds that recorded it (missing on old profiles). */
  held?: number
  /**
   * What flagged the holder habit: 'rates' when only the pooled disposition
   * test (selling winners faster than losers) did, 'depth' when losers also
   * (or only) fell far deeper than random holds. Picks the holder mission.
   */
  holderBasis?: 'rates' | 'depth'
}

/**
 * Maps pooled evidence (a z statistic) to a 0..1 score that reaches TYPE_MIN
 * exactly at the one-sided 5% level, so only a significant habit names a type.
 */
const pooledScore = (z: number) => (z >= Z_FLAG ? TYPE_MIN + (1 - TYPE_MIN) * ramp(z, Z_FLAG, 3.5) : 0.97 * TYPE_MIN * ramp(z, 0, Z_FLAG))

/** The same mapping from a one-sided p-value, for rare-event counts where z is too lopsided. */
const pooledScoreP = (p: number) => {
  const s = -Math.log10(Math.max(p, 1e-12))
  const flag = -Math.log10(0.05)
  return s >= flag ? TYPE_MIN + (1 - TYPE_MIN) * ramp(s, flag, 3.5) : 0.97 * TYPE_MIN * ramp(s, 0, flag)
}

/**
 * Chance of at least k events from a Poisson count with this mean. For a sum
 * of independent rare events with the same mean it errs on the safe side.
 */
function poissonTail(k: number, lambda: number) {
  if (k <= 0) return 1
  let term = Math.exp(-lambda)
  let cdf = term
  for (let i = 1; i < k; i++) {
    term *= lambda / i
    cdf += term
  }
  return Math.max(0, 1 - cdf)
}

/** Participation below which "no habit" means barely playing (관망형). */
const MACHINE_MIN_HELD = 0.2
const MACHINE_MIN_TRADES = 2

/**
 * Pool the recent rounds and pick the strongest habit. Each habit counts only
 * the rounds where it could be measured, weighted by how much evidence each
 * round had, and the habits that compare rates pool their raw counts.
 */
export function profileFrom(records: HabitRecord[]): Profile | null {
  const recent = records.slice(-PROFILE_WINDOW)
  if (recent.length < PROFILE_MIN_ROUNDS) return null

  const weighted = (k: HabitKey, weight: (r: HabitRecord) => number) => {
    const rs = recent.filter((r) => r.measurable[k])
    const w = sum(rs.map(weight))
    return w > 0 ? sum(rs.map((r) => weight(r) * r.scores[k])) / w : 0
  }
  const ev = recent.every((r) => r.evidence) ? recent.map((r) => r.evidence as HabitEvidence) : null
  const total = (pick: (e: HabitEvidence) => number) => (ev ? sum(ev.map(pick)) : 0)

  // Holder: the pooled disposition test, or losers that fell far deeper
  // than random holds of the same length.
  const pooled = recent.reduce<HabitCounts>(
    (a, r) => ({
      sellUp: a.sellUp + r.counts.sellUp,
      expUp: a.expUp + r.counts.expUp,
      sellDown: a.sellDown + r.counts.sellDown,
      expDown: a.expDown + r.counts.expDown,
    }),
    { sellUp: 0, expUp: 0, sellDown: 0, expDown: 0 },
  )
  const disp = dispositionTest(pooled)
  const dispScore = disp.ok && disp.ratio >= MIN_HAZARD_RATIO ? pooledScore(disp.z) : 0
  const depthScore = ev
    ? total((e) => e.depthBase) > 0
      ? ramp(total((e) => e.depth) / total((e) => e.depthBase), 2.2, 3.5) * Math.min(1, total((e) => e.losses) / 5)
      : 0
    : weighted('holder', (r) => r.trades)
  const holder = Math.max(dispScore, depthScore)

  // Chicken: the move after selling winners, pooled over enough clean exits.
  let chicken: number
  if (ev) {
    const exits = total((e) => e.exits)
    chicken = exits >= MIN_POOLED_EXITS ? pooledScore(total((e) => e.exitZ) / Math.sqrt(exits)) : 0
  } else {
    chicken = weighted('chicken', (r) => r.trades)
  }

  const scalper = weighted('scalper', () => 1)
  // Chaser: buys after spikes, pooled, against how often a random press would.
  let chaser: number
  if (ev) {
    const chases = total((e) => e.chases)
    const entries = sum(recent.map((r) => r.trades))
    chaser =
      chases >= 3
        ? pooledScoreP(poissonTail(chases, total((e) => e.chaseChance))) * ramp(chases / Math.max(1, entries), 0.1, 0.25)
        : 0
  } else {
    chaser = weighted('chaser', (r) => r.trades)
  }

  let rumor: number
  if (ev) {
    const hits = total((e) => e.rumorHits)
    rumor = hits >= 2 ? pooledScoreP(poissonTail(hits, total((e) => e.rumorChance))) : 0
  } else {
    rumor = weighted('rumor', () => 1)
  }

  const scores: HabitScores = { holder, chicken, scalper, chaser, rumor }
  const top = HABIT_KEYS.reduce((a, b) => (scores[b] > scores[a] ? b : a))
  // Records migrated from v1 carry no participation (heldRatio 0); skip them.
  const known = recent.filter((r) => r.heldRatio > 0)
  const held = known.length ? mean(known.map((r) => r.heldRatio)) : undefined
  let type: TypeKey = top
  if (scores[top] < TYPE_MIN) {
    // No habit stands out. 기계형 claims better-than-random timing, so it
    // uses exactly the records screen's skill test: the same luck results
    // (the latest SKILL_WINDOW luck-tested rounds of every record, not just
    // this window) and the same bar (the card's chance line, z ≥ SKILL_Z_SHOW,
    // which survives the repeated looks). The two screens then never
    // disagree. Otherwise 관망형 is about participation only: barely in the
    // market, or barely trading; an active player is 탐색 중. (Stop-loss
    // players rank below the median by design, MODEL.md §4, so luck must
    // never push an active player into 관망형.)
    const skilled = showsChance(skillTest(records.map((r) => r.luckPct)))
    const active =
      !known.length ||
      (mean(known.map((r) => r.heldRatio)) >= MACHINE_MIN_HELD && mean(known.map((r) => r.trades)) >= MACHINE_MIN_TRADES)
    type = skilled ? 'machine' : active ? 'steady' : 'watcher'
  }
  const profile: Profile = { type, scores, rounds: recent.length }
  if (held !== undefined) profile.held = held
  // 'rates' only when the selling-rate test alone carries the flag: a player
  // whose losers also ran deep gets the stop-loss mission, which (judged by
  // reaction time) separates a changed player from an unchanged one best.
  if (holder > 0) profile.holderBasis = dispScore > depthScore && depthScore < TYPE_MIN ? 'rates' : 'depth'
  return profile
}

// ---------------------------------------------------------------------------
// Bands and trends for the habits screen (coaching). Display helpers only:
// they read stored scores and never change how a habit is measured.

export type Band = 'low' | 'mid' | 'high'
export const BAND_LABELS: Record<Band, string> = { low: '낮음', mid: '보통', high: '높음' }

/**
 * A profile score as a band instead of a falsely precise number. "높음"
 * starts at TYPE_MIN, where the pooled evidence reaches the one-sided 5%
 * level; "보통" is a hint that has not got there yet.
 */
export function habitBand(score: number): Band {
  if (score >= TYPE_MIN) return 'high'
  if (score >= 0.12) return 'mid'
  return 'low'
}

/**
 * Habit trend windows, in rounds where the habit could be measured. The
 * baseline is rounds 6-15: the first 5 picked the first profile and mission,
 * so comparing against them would show regression to the mean as a change.
 * The latest window is the last 10. Nothing is said before round 25, and the
 * answer is only re-evaluated every 5 rounds, so each new round is not
 * another look.
 */
export const TREND_SKIP = 5
export const TREND_WINDOW = 10
export const TREND_MIN_ROUNDS = 25
export const TREND_STEP = 5
/** Two-sided permutation p below this (5% split over the 5 habits on screen). */
export const TREND_ALPHA = 0.01
/** And at least this big a change in the mean score. */
export const TREND_MIN_DIFF = 0.05
const TREND_PERMUTATIONS = 2000

export type HabitTrend = {
  /** Mean round score in the baseline (measurable rounds 6-15) and the latest 10, 0..1. */
  from: number
  to: number
  /** 'same' unless a permutation test gives p < TREND_ALPHA and |to - from| >= TREND_MIN_DIFF. */
  change: 'down' | 'up' | 'same'
  /** Rounds where the habit could be measured. */
  rounds: number
  /** Rounds the comparison used (a multiple of TREND_STEP, at most `rounds`). */
  evaluatedAt: number
}

/** Small deterministic generator for the permutation test (mulberry32). */
function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Whether a two-sided permutation test of the difference in means gives
 * p < alpha, with p = (1 + permutations at least as extreme) / (B + 1).
 * Stops as soon as p can no longer get below alpha, so a clear "no" is cheap.
 */
export function permutationSignificant(a: readonly number[], b: readonly number[], seed: number, alpha = TREND_ALPHA, B = TREND_PERMUTATIONS) {
  const all = [...a, ...b]
  const na = a.length
  const total = sum(all)
  const obs = Math.abs(mean([...a]) - mean([...b]))
  // p < alpha  <=>  extreme + 1 < alpha·(B + 1)
  const limit = alpha * (B + 1) - 1
  const rand = mulberry(seed)
  let extreme = 0
  for (let i = 0; i < B; i++) {
    // Partial Fisher-Yates: the first na slots become a random group a.
    let sa = 0
    for (let j = 0; j < na; j++) {
      const k = j + Math.floor(rand() * (all.length - j))
      const tmp = all[j]
      all[j] = all[k]
      all[k] = tmp
      sa += all[j]
    }
    const d = Math.abs(sa / na - (total - sa) / (all.length - na))
    if (d >= obs - 1e-12) {
      extreme++
      if (extreme >= limit) return false
    }
  }
  return extreme < limit
}

/**
 * Measurable rounds 6-15 against the latest 10, evaluated at the last
 * multiple of 5 rounds. Null (show "변화는 아직 판단하기 일러요") until 25
 * measurable rounds. Stationary scripted players get a false change at most
 * 3% of the time even when checked every 5 rounds (habits.test.ts).
 */
export function habitTrend(records: readonly HabitRecord[], key: HabitKey): HabitTrend | null {
  const rs = records.filter((r) => r.measurable[key])
  if (rs.length < TREND_MIN_ROUNDS) return null
  const at = rs.length - (rs.length % TREND_STEP)
  const used = rs.slice(0, at)
  const a = used.slice(TREND_SKIP, TREND_SKIP + TREND_WINDOW).map((r) => r.scores[key])
  const b = used.slice(-TREND_WINDOW).map((r) => r.scores[key])
  const from = mean(a)
  const to = mean(b)
  const diff = to - from
  let change: HabitTrend['change'] = 'same'
  if (Math.abs(diff) >= TREND_MIN_DIFF) {
    // Seeded by the habit and the evaluation point: the same history always gives the same answer.
    const seed = (HABIT_KEYS.indexOf(key) + 1) * 7919 + at * 104729
    if (permutationSignificant(a, b, seed)) change = diff < 0 ? 'down' : 'up'
  }
  return { from, to, change, rounds: rs.length, evaluatedAt: at }
}
