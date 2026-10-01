import { PLAY_TICKS, playPrice, TICKS_PER_SECOND, type Market } from './market'

/**
 * Trading habits from behavioral finance, measured from one round's
 * press/release log. Every score is 0..1, higher means the habit showed more.
 */
export type HabitKey = 'holder' | 'chicken' | 'scalper' | 'chaser' | 'rumor'
export type TypeKey = HabitKey | 'machine'
export type HabitScores = Record<HabitKey, number>

export const HABIT_KEYS: readonly HabitKey[] = ['holder', 'chicken', 'scalper', 'chaser', 'rumor']

export const HABIT_LABELS: Record<HabitKey, string> = {
  holder: '손실 버티기',
  chicken: '빠른 익절',
  scalper: '잦은 매매',
  chaser: '추격 매수',
  rumor: '지라시 반응',
}

export const TYPES: Record<TypeKey, { name: string; line: string; tip: string }> = {
  holder: {
    name: '존버형',
    line: '떨어져도 놓지 않아요. 언젠가 오를 거라 믿죠. 손실은 오래, 수익은 짧게 가져가는 개인 투자자의 가장 흔한 습관이에요.',
    tip: '이번 매매가 -3%를 넘으면 일단 손을 떼보세요.',
  },
  chicken: {
    name: '새가슴 익절형',
    line: '조금만 올라도 팔아요. 수익을 확정하는 기분은 좋지만, 큰 상승은 대부분 놓쳐요.',
    tip: '수익이 날 때 1초만 더 참아보세요.',
  },
  scalper: {
    name: '단타 중독형',
    line: '가만히 있질 못해요. 매매할 때마다 수수료가 빠지니, 가장 큰 적은 시장이 아니라 내 손가락이에요.',
    tip: '다음 판은 매매 5번 이하로 해보세요.',
  },
  chaser: {
    name: '추격 매수형',
    line: '오르는 걸 보고 올라타요. 확신이 생겼을 땐 이미 많이 오른 뒤라, 꼭대기 근처에서 사는 일이 잦아요.',
    tip: '2초 사이 크게 오른 직후엔 한 박자 쉬어보세요.',
  },
  rumor: {
    name: '지라시 추종형',
    line: '소문에 제일 먼저 움직여요. 빠르긴 한데, 지라시는 반이 틀려서 결국 동전 던지기를 하는 셈이에요.',
    tip: '지라시가 뜨면 가격이 실제로 움직이는지 보고 들어가세요.',
  },
  machine: {
    name: '냉정한 기계형',
    line: '뚜렷한 나쁜 습관이 안 보여요. 손실은 빨리 끊고, 확인된 정보에만 움직여요. 흔치 않은 유형이에요.',
    tip: '이 감각 그대로 오늘의 차트에서 계좌를 키워보세요.',
  },
}

/** Rounds with at least one trade needed before a type is shown. */
export const PROFILE_MIN_ROUNDS = 5
/** Only the most recent rounds count, so the type can change as you do. */
export const PROFILE_WINDOW = 10

const AFTER_EXIT_TICKS = 3 * TICKS_PER_SECOND
const CHASE_LOOKBACK_TICKS = 2 * TICKS_PER_SECOND
const CHASE_RISE = 0.025
const NEWS_REACTION_GRACE = 3

export type Trade = {
  entry: number
  /** Exclusive; PLAY_TICKS means it was closed at the bell. */
  exit: number
  ret: number
  /** Worst point during the trade, relative to entry (<= 0). */
  worst: number
}

export function tradesFrom(market: Market, held: boolean[]): Trade[] {
  const trades: Trade[] = []
  let t = 0
  while (t < PLAY_TICKS) {
    if (!held[t]) {
      t++
      continue
    }
    const entry = t
    while (t < PLAY_TICKS && held[t]) t++
    const p0 = playPrice(market, entry)
    let low = p0
    for (let i = entry; i <= t; i++) low = Math.min(low, playPrice(market, i))
    trades.push({ entry, exit: t, ret: playPrice(market, t) / p0 - 1, worst: low / p0 - 1 })
  }
  return trades
}

export type RoundHabits = {
  trades: number
  scores: HabitScores
  facts: {
    lossTrades: number
    winTrades: number
    avgLossWorst: number
    avgLossHoldSec: number
    avgWinHoldSec: number
    /** Average move in the 3 seconds after selling a winner. */
    missedAfterWin: number
    chaseEntries: number
    rumors: number
    rumorReactions: number
    wrongRumorReactions: number
    filings: number
    filingReactions: number
    fees: number
  }
}

const ramp = (x: number, lo: number, hi: number) => Math.max(0, Math.min(1, (x - lo) / (hi - lo)))
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

export function analyzeRound(market: Market, held: boolean[], fees: number): RoundHabits {
  const trades = tradesFrom(market, held)
  const losses = trades.filter((t) => t.ret < 0)
  const wins = trades.filter((t) => t.ret > 0)
  const sec = (t: Trade) => (t.exit - t.entry) / TICKS_PER_SECOND

  const avgLossWorst = mean(losses.map((t) => t.worst))
  const avgLossHoldSec = mean(losses.map(sec))
  const avgWinHoldSec = mean(wins.map(sec))

  // Holding losers: how deep you let a losing trade go, plus whether you
  // held losers longer than winners (the disposition effect).
  let holder = 0
  if (losses.length) {
    const depth = ramp(-avgLossWorst, 0.025, 0.07)
    const disposition = wins.length ? ramp(avgLossHoldSec / Math.max(avgWinHoldSec, 0.1), 1.5, 4) : depth
    holder = depth * 0.6 + disposition * 0.4
  }

  // Selling winners early: what the price did right after you sold.
  const earlyExits = wins.filter((t) => t.exit + AFTER_EXIT_TICKS <= PLAY_TICKS)
  const missedAfterWin = mean(
    earlyExits.map((t) => playPrice(market, t.exit + AFTER_EXIT_TICKS) / playPrice(market, t.exit) - 1),
  )
  const chicken = earlyExits.length ? ramp(missedAfterWin, 0.012, 0.045) : 0

  const scalper = ramp(trades.length, 6, 14)

  const chaseEntries = trades.filter((t) => {
    const from = Math.max(0, t.entry - CHASE_LOOKBACK_TICKS)
    return t.entry - from >= 5 && playPrice(market, t.entry) / playPrice(market, from) - 1 > CHASE_RISE
  }).length
  const chaser = trades.length ? ramp(chaseEntries / trades.length, 0.25, 0.75) * Math.min(1, trades.length / 2) : 0

  // Did you act in the headline's direction before the price confirmed it?
  const reacted = (from: number, to: number, implied: 1 | -1) => {
    for (let t = Math.max(1, from); t < to && t < PLAY_TICKS; t++) {
      if (implied > 0 && held[t] && !held[t - 1]) return true
      if (implied < 0 && !held[t] && held[t - 1]) return true
    }
    return false
  }
  let rumors = 0
  let rumorReactions = 0
  let wrongRumorReactions = 0
  let filings = 0
  let filingReactions = 0
  for (const n of market.news) {
    const hit = reacted(n.at, n.impactAt + NEWS_REACTION_GRACE, n.implied)
    if (n.kind === 'rumor') {
      rumors++
      if (hit) {
        rumorReactions++
        if (n.actual !== n.implied) wrongRumorReactions++
      }
    } else {
      filings++
      if (hit) filingReactions++
    }
  }
  const rumor = rumors ? ramp(rumorReactions / rumors, 0.3, 1) * 0.85 + (wrongRumorReactions ? 0.15 : 0) : 0

  return {
    trades: trades.length,
    scores: { holder, chicken, scalper, chaser, rumor },
    facts: {
      lossTrades: losses.length,
      winTrades: wins.length,
      avgLossWorst,
      avgLossHoldSec,
      avgWinHoldSec,
      missedAfterWin,
      chaseEntries,
      rumors,
      rumorReactions,
      wrongRumorReactions,
      filings,
      filingReactions,
      fees,
    },
  }
}

export type Insight = { tone: 'warn' | 'good' | 'none'; habit?: HabitKey; title: string; line: string }

const pct = (x: number) => `${(Math.abs(x) * 100).toFixed(1)}%`
const secs = (x: number) => `${x.toFixed(1)}초`
const man = (won: number) => `${Math.round(won / 10_000).toLocaleString('ko-KR')}만 원`

/** The one thing worth telling the player about this round. */
export function roundInsight(h: RoundHabits): Insight {
  const f = h.facts
  if (h.trades === 0) {
    return { tone: 'none', title: '이번 판은 지켜보기만 했어요', line: '매매가 없어서 습관을 볼 수 없었어요.' }
  }
  const top = HABIT_KEYS.reduce((a, b) => (h.scores[b] > h.scores[a] ? b : a))
  if (h.scores[top] >= 0.5) {
    switch (top) {
      case 'holder':
        // Quote whichever evidence actually drove the score.
        return f.winTrades && f.avgLossHoldSec > f.avgWinHoldSec * 1.5
          ? {
              tone: 'warn',
              habit: top,
              title: '손실은 오래, 수익은 짧게 들고 있었어요',
              line: `손실 난 매매는 평균 ${secs(f.avgLossHoldSec)}, 수익 난 매매는 ${secs(f.avgWinHoldSec)} 들고 있었어요. 돈 버는 사람들은 반대로 해요.`,
            }
          : {
              tone: 'warn',
              habit: top,
              title: '손실을 끝까지 버텼어요',
              line: `손실 난 매매에서 평균 -${pct(f.avgLossWorst)}까지 내려가도 들고 있었어요.`,
            }
      case 'chicken':
        return {
          tone: 'warn',
          habit: top,
          title: '수익을 너무 빨리 확정했어요',
          line: `판 뒤 3초 동안 가격이 평균 ${pct(f.missedAfterWin)} 더 올랐어요.`,
        }
      case 'scalper':
        return {
          tone: 'warn',
          habit: top,
          title: '너무 자주 사고팔았어요',
          line: `40초 동안 ${h.trades}번 매매했고, 수수료로만 ${man(f.fees)}이 나갔어요.`,
        }
      case 'chaser':
        return {
          tone: 'warn',
          habit: top,
          title: '급하게 오른 뒤에 올라탔어요',
          line: `${h.trades}번 산 것 중 ${f.chaseEntries}번이 2초 사이 2.5% 넘게 오른 직후였어요.`,
        }
      case 'rumor':
        return {
          tone: 'warn',
          habit: top,
          title: '지라시에 바로 움직였어요',
          line:
            `지라시 ${f.rumors}개 중 ${f.rumorReactions}개에 가격이 움직이기 전에 반응했어요.` +
            (f.wrongRumorReactions ? ` 그중 ${f.wrongRumorReactions}개는 틀린 소문이었어요.` : ''),
        }
    }
  }
  if (f.filingReactions > 0) {
    return {
      tone: 'good',
      title: '공시에 빠르게 반응했어요',
      line: `공시 ${f.filings}개 중 ${f.filingReactions}개에 가격보다 먼저 맞게 움직였어요.`,
    }
  }
  if (f.lossTrades && f.avgLossWorst > -0.02) {
    return {
      tone: 'good',
      title: '손절이 빨랐어요',
      line: `손실 난 매매를 평균 -${pct(f.avgLossWorst)} 안에서 정리했어요.`,
    }
  }
  return { tone: 'good', title: '눈에 띄는 나쁜 습관이 없었어요', line: '이번 판은 깔끔하게 매매했어요.' }
}

export type Profile = { type: TypeKey; scores: HabitScores; rounds: number }

/** Average the recent rounds that had trades and pick the strongest habit. */
export function profileFrom(history: HabitScores[]): Profile | null {
  const recent = history.slice(-PROFILE_WINDOW)
  if (recent.length < PROFILE_MIN_ROUNDS) return null
  const scores = Object.fromEntries(
    HABIT_KEYS.map((k) => [k, mean(recent.map((s) => s[k]))]),
  ) as HabitScores
  const top = HABIT_KEYS.reduce((a, b) => (scores[b] > scores[a] ? b : a))
  // The good type needs every habit low, not just no single standout.
  const overall = mean(HABIT_KEYS.map((k) => scores[k]))
  const machine = scores[top] < 0.3 && overall < 0.12
  return { type: machine ? 'machine' : top, scores, rounds: recent.length }
}
