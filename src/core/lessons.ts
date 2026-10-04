import { formatWon } from './format'
import { tradesFrom, type HabitKey, type Insight, type RoundHabits } from './habits'
import type { LuckResult } from './luck'
import { playPrice, TICKS_PER_SECOND, type Market } from './market'
import { PRODUCTS } from './products'
import type { RoundResult } from './round'

export type Lesson = { title: string; line: string }

const pct = (x: number, digits = 1) => `${x > 0 ? '+' : x < 0 ? '-' : ''}${Math.abs(x * 100).toFixed(digits)}%`
const pp = (x: number, digits = 1) => `${x > 0 ? '+' : x < 0 ? '-' : ''}${Math.abs(x * 100).toFixed(digits)}%포인트`
/** Signed number from an integer count of tenths of a percent (12, '%포인트' -> "+1.2%포인트"). */
const tenths = (t: number, unit: '%' | '%포인트') => `${t > 0 ? '+' : t < 0 ? '-' : ''}${(Math.abs(t) / 10).toFixed(1)}${unit}`

function range(market: Market) {
  let lo = Infinity
  let hi = 0
  for (let t = 0; t <= market.playTicks; t++) {
    const p = playPrice(market, t)
    lo = Math.min(lo, p)
    hi = Math.max(hi, p)
  }
  return hi / lo - 1
}

/** Window around a headline's impact: from just before to two seconds after. */
function impactWindow(market: Market, impactAt: number) {
  return { from: Math.max(0, impactAt - 1), to: Math.min(market.playTicks, impactAt + 20) }
}

function moveAfter(market: Market, impactAt: number) {
  const { from, to } = impactWindow(market, impactAt)
  return playPrice(market, to) / playPrice(market, from) - 1
}

/**
 * What this round showed about the product itself, independent of how the
 * player traded. Stocks have none: the habit card already covers them.
 */
export function productLesson(market: Market): Lesson | null {
  const product = PRODUCTS[market.product]
  const filing = market.news.find((n) => n.kind === 'filing')
  const isShort = market.length === 'short'

  switch (market.product) {
    case 'bond': {
      const D = market.company.duration ?? 7
      if (filing && market.yields) {
        const { from, to } = impactWindow(market, filing.impactAt)
        const h = market.historyTicks
        const dy = market.yields[h + to] - market.yields[h + from]
        return {
          title: '금리와 채권은 반대로 움직여요',
          line: `「${filing.headline}」 뒤 금리가 ${pp(dy, 2)}, 채권은 ${pct(moveAfter(market, filing.impactAt))} 움직였어요. 이 채권은 금리가 1% 움직이면 가격이 약 ${D}% 반대로 움직여요.`,
        }
      }
      return {
        title: '채권은 잔잔해요',
        line: `고점과 저점 차이가 ${pct(range(market))}였어요. 금리가 크게 안 움직이면 채권은 이자를 받으며 천천히 가요.`,
      }
    }
    case 'gold': {
      const scare = market.news.find((n) => n.kind === 'filing' && n.implied > 0)
      if (scare) {
        return {
          title: '불안하면 금으로 돈이 몰려요',
          line: `「${scare.headline}」 뒤 금이 ${pct(moveAfter(market, scare.impactAt))} 움직였어요. 불안할 때 금이 오르는 경우가 많아 안전자산이라고 부르지만, 늘 그렇지는 않아요.`,
        }
      }
      return {
        title: '금은 평소에 심심해요',
        line: `큰 위기 뉴스가 없어서 고점과 저점 차이가 ${pct(range(market))}에 그쳤어요. 금의 1년 변동성은 주식의 절반 정도예요.`,
      }
    }
    case 'coin': {
      const rumors = market.news.filter((n) => n.kind === 'rumor')
      const wrong = rumors.filter((n) => n.actual !== n.implied).length
      return {
        title: '코인은 크게 출렁여요',
        line:
          `고점과 저점 차이가 ${pct(range(market))}였어요. 코인의 1년 변동성은 개별 주식의 두 배쯤 돼요.` +
          (rumors.length ? ` 뉴스 ${market.news.length}개 중 ${rumors.length}개가 소문이었고, 그중 ${wrong}개는 틀렸어요.` : ''),
      }
    }
    case 'lev2': {
      const index = market.underlying!
      const h = market.historyTicks
      const L = product.leverage ?? 2
      const u = index[h + market.playTicks] / index[h] - 1
      const p = playPrice(market, market.playTicks) / playPrice(market, 0) - 1
      const naive = L * u
      // Daily-rebalanced L-times fund: 1 + P ~ (1 + U)^L * exp(-(L^2 - L)/2 * sum of daily r^2).
      // That formula is the explanation; the numbers shown are exact: the
      // trend effect is (1 + U)^L - (1 + L*U) and the drag is whatever is
      // left, (1 + P) - (1 + U)^L, so trend + drag = gap with no residual.
      const compounded = (1 + u) ** L
      // Round to tenths of a percent first and derive the differences from
      // the rounded values, so every displayed number adds up exactly.
      // "단순 2배" is twice the index as shown, so the reader can check it.
      const uT = Math.round(u * 1000)
      const pT = Math.round(p * 1000)
      const naiveT = L * uT
      const gapT = pT - naiveT
      const trendT = Math.round((compounded - (1 + naive)) * 1000)
      const dragT = gapT - trendT
      const split = `단순 ${L}배라면 ${tenths(naiveT, '%')}인데, 차이 ${tenths(gapT, '%포인트')} 중 추세 효과가 ${tenths(trendT, '%포인트')}, 매일 ${L}배로 다시 맞추면서 생긴 변동성 끌림이 ${tenths(dragT, '%포인트')}예요.`
      return {
        title: gapT < 0 ? '2배 상품은 출렁일수록 녹아요' : gapT > 0 ? '한 방향으로 쭉 가면 2배보다 더 벌어요' : '이번엔 거의 정확히 2배였어요',
        line:
          `지수 ${tenths(uT, '%')}, 2배 상품 ${tenths(pT, '%')}. ${split}` +
          (isShort ? ' 끌림은 기간이 길수록 커져요. 장기 모드에서 1년치를 확인해 보세요.' : ''),
      }
    }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Micro-lessons (learning-design report §4, L1-L10)
//
// Short lessons tied to something that happened in this round. The result
// screen shows at most one per round, each id at most once ever (the seen
// ids are stored), and none on top of a mission success. Priority: L9 when
// the habit card warned but the round made money, then the lesson linked to
// the habit card, then this product's lesson, then a general one.
// Market facts only, never advice about real investing.

export type LessonId = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7' | 'L8' | 'L9' | 'L10' | `p:${string}`

export type CoachLesson = Lesson & { id: LessonId }

export type LessonContext = {
  market: Market
  result: Pick<
    RoundResult,
    'yourReturn' | 'buyHoldReturn' | 'cashReturn' | 'fees' | 'interest' | 'startEquity' | 'heldRatio' | 'held' | 'trades'
  >
  habits: RoundHabits
  insight: Insight
}

const abs1 = (x: number) => `${Math.abs(x * 100).toFixed(1)}%`
/** "0.2%", "0.15%": a fee with no trailing zeros. */
const feePct = (x: number) => `${Number((x * 100).toFixed(2))}%`
/** A span of ticks in the round's own unit: seconds in short rounds, days in long ones. */
const ticksText = (market: Market, ticks: number) =>
  market.length === 'long'
    ? `${Math.max(1, Math.round(ticks / market.ticksPerDay))}일`
    : `${Math.max(0.1, ticks / TICKS_PER_SECOND).toFixed(1)}초`
/** The 2-second swing missions use, so "deep" means the same on every chart. */
function swingOf(market: Market) {
  const r: number[] = []
  for (let t = 1; t <= market.playTicks; t++) r.push(Math.log(playPrice(market, t) / playPrice(market, t - 1)))
  const mu = r.reduce((a, b) => a + b, 0) / r.length
  const sd = Math.sqrt(r.reduce((a, x) => a + (x - mu) ** 2, 0) / Math.max(1, r.length - 1))
  return Math.max(1e-9, sd * Math.sqrt(2 * TICKS_PER_SECOND))
}

/** Log return and realized volatility per bucket of `size` ticks, and whether the player held most of it. */
function buckets(market: Market, held: boolean[], size: number) {
  const out: Array<{ ret: number; rv: number; held: boolean }> = []
  for (let a = 0; a + size <= market.playTicks; a += size) {
    let rv = 0
    let h = 0
    for (let t = a; t < a + size; t++) {
      const r = Math.log(playPrice(market, t + 1) / playPrice(market, t))
      rv += r * r
      if (held[t]) h++
    }
    out.push({ ret: Math.log(playPrice(market, a + size) / playPrice(market, a)), rv: Math.sqrt(rv), held: h * 2 >= size })
  }
  return out
}

type Rule = (c: LessonContext) => CoachLesson | null

/** L1: fees ate a real share of the account, or most of the gap to the market. */
const L1: Rule = ({ market, result }) => {
  const share = result.fees / result.startEquity
  const edge = Math.abs(result.yourReturn - result.buyHoldReturn)
  if (result.fees <= 0 || !(share >= 0.005 || (result.trades >= 4 && share >= edge / 2))) return null
  return {
    id: 'L1',
    title: '수수료가 쌓였어요',
    line: `이번 판 수수료는 ${formatWon(result.fees)}, 계좌의 ${abs1(share)}였어요. 한 번 사고팔 때마다 ${feePct(2 * market.feeRate)}씩 빠지니, 자주 사고팔수록 그만큼 더 올라야 본전이에요.`,
  }
}

/** L2: sitting out is a choice too. */
const L2: Rule = ({ result }) => {
  if (result.heldRatio >= 0.2 || Math.abs(result.buyHoldReturn - result.cashReturn) < 0.01) return null
  return {
    id: 'L2',
    title: '쉬는 것도 하나의 선택이에요',
    line: `손을 떼고 있는 동안 이자로 ${formatWon(result.interest)}을 받았고, 그사이 가격은 ${pct(result.buyHoldReturn)} 움직였어요. 쉬는 것도 그냥 들고 있기와 비교되는 하나의 선택이에요.`,
  }
}

/** L3: bought within 3 s after a good filing hit (or sold after a bad one), once the price had already moved. */
const L3: Rule = ({ market, result }) => {
  const held = result.held
  for (const n of market.news) {
    if (n.kind !== 'filing' || n.actual !== n.implied) continue
    const base = playPrice(market, Math.max(0, n.impactAt - 1))
    const end = Math.min(market.playTicks, n.impactAt + 3 * TICKS_PER_SECOND)
    for (let t = Math.max(1, n.impactAt); t < end; t++) {
      const acted = n.implied > 0 ? held[t] && !held[t - 1] : !held[t] && held[t - 1]
      if (!acted) continue
      const move = playPrice(market, t) / base - 1
      if (move * n.implied <= 0) break
      return {
        id: 'L3',
        title: '소식은 금방 가격에 들어가요',
        line: `「${n.headline}」 뒤 ${ticksText(market, t - n.impactAt + 1)} 만에 가격이 이미 ${pct(move)} 움직였어요. 모두가 아는 소식은 금방 가격에 반영돼서, 뒤늦게 따라가면 남는 몫이 작아요.`,
      }
    }
  }
  return null
}

/** L4: rumors are close to a coin flip. */
const L4: Rule = ({ market, habits }) => {
  const rumors = market.news.filter((n) => n.kind === 'rumor')
  if (!rumors.length) return null
  if (!(habits.facts.rumorReactions >= 1 || (market.product === 'coin' && rumors.length >= 2))) return null
  const right = rumors.filter((n) => n.actual === n.implied).length
  return {
    id: 'L4',
    title: '소문은 반쯤 틀려요',
    line: `이번 판 소문 ${rumors.length}개 중 맞은 건 ${right}개였어요. 맞을 확률이 반반에 가까운 정보에 먼저 움직이면, 맞을 때 버는 만큼 틀릴 때 잃기 쉬워요.`,
  }
}

/** L5: held through two big one-second swings (2.5x the median) within 5 s. */
const L5: Rule = ({ market, result }) => {
  const bs = buckets(market, result.held, TICKS_PER_SECOND)
  const sorted = bs.map((b) => b.rv).sort((a, b) => a - b)
  const median = sorted[sorted.length >> 1]
  if (!(median > 0)) return null
  const big = bs.map((b, i) => (b.held && b.rv >= 2.5 * median ? i : -1)).filter((i) => i >= 0)
  for (let k = 1; k < big.length; k++) {
    const gap = big[k] - big[k - 1]
    if (gap <= 5) {
      return {
        id: 'L5',
        title: '출렁임은 몰려서 와요',
        line: `크게 흔들린 뒤 ${gap}초 만에 또 크게 흔들렸고, 그동안 들고 있었어요. 시장의 출렁임은 한번 커지면 한동안 몰려서 오는 경향이 있어요.`,
      }
    }
  }
  return null
}

/** L6: a deep loss, and the bigger gain it takes to get back. */
const L6: Rule = ({ market, result }) => {
  const worst = tradesFrom(market, result.held).reduce((a, t) => Math.min(a, t.worst), 0)
  const x = -worst
  if (!(x >= 0.08 || (x >= 0.03 && x / swingOf(market) >= 3))) return null
  return {
    id: 'L6',
    title: '깊은 손실은 되돌리기 어려워요',
    line: `-${abs1(x)}까지 내려갔다가 제자리로 오려면 +${abs1(x / (1 - x))}가 필요해요. 손실이 깊을수록 회복에 필요한 수익은 더 빠르게 커져요.`,
  }
}

/** L9: the habit card warned, but the round beat the market anyway. */
const L9: Rule = ({ result, insight }) => {
  if (insight.tone !== 'warn' || result.yourReturn <= result.buyHoldReturn) return null
  return {
    id: 'L9',
    title: '결과와 과정은 달라요',
    line: '이번엔 시장보다 나았지만, 같은 방식으로 100판을 하면 결과는 달라질 수 있어요. 한 판의 결과만으로 방법이 좋았는지 알기는 어려워요.',
  }
}

/** L10: the whole rise came from a few seconds (days), and you were out for most of them. */
const L10: Rule = ({ market, result }) => {
  if (result.buyHoldReturn <= 0 || result.trades < 2) return null
  const long = market.length === 'long'
  const bs = buckets(market, result.held, long ? market.ticksPerDay : TICKS_PER_SECOND)
  const k = Math.max(1, Math.ceil(bs.length * 0.05))
  const top = [...bs].sort((a, b) => b.ret - a.ret).slice(0, k)
  if (top.reduce((a, b) => a + b.ret, 0) < Math.log(1 + result.buyHoldReturn)) return null
  const out = top.filter((b) => !b.held).length
  if (out * 2 < k) return null
  const unit = long ? '일' : '초'
  return {
    id: 'L10',
    title: '오르는 순간은 몰려 있어요',
    line: `이번 판 상승은 가장 많이 오른 ${k}${unit}에 다 몰려 있었고, 그중 ${out}${unit} 동안 손을 떼고 있었어요. 들어갔다 나왔다 하면 이런 몇 ${long ? '날' : '초'}을 놓치기 쉬워요.`,
  }
}

/** Lessons that go with the habit the card talked about. */
const LINKED: Record<HabitKey, Rule[]> = {
  scalper: [L1, L10],
  holder: [L6],
  chicken: [L10],
  chaser: [L3],
  rumor: [L4],
}
const GENERAL: Rule[] = [L1, L6, L3, L4, L2, L10, L5]

/** This round's product lesson, as a slot candidate with a per-product id. */
function productCandidate(market: Market): CoachLesson | null {
  const lesson = productLesson(market)
  return lesson && { id: `p:${market.product}`, ...lesson }
}

/** Every lesson this round triggers, best first, without duplicates. */
export function roundLessons(c: LessonContext): CoachLesson[] {
  const rules: Array<Rule | 'product'> = [L9, ...(c.insight.habit ? LINKED[c.insight.habit] : []), 'product', ...GENERAL]
  const out: CoachLesson[] = []
  for (const r of rules) {
    const l = r === 'product' ? productCandidate(c.market) : r(c)
    if (l && !out.some((o) => o.id === l.id)) out.push(l)
  }
  return out
}

/** The one lesson for the result screen's slot: the best one not seen before. */
export function pickLesson(c: LessonContext, seen: readonly string[]): CoachLesson | null {
  return roundLessons(c).find((l) => !seen.includes(l.id)) ?? null
}

/**
 * L8 (survivorship) and L7 (regression to the mean), which need the luck
 * test. Shown with the luck card, only on a round whose slot had no lesson.
 * `rounds` counts luck-tested rounds so far, including this one.
 */
export function luckLesson(luck: LuckResult, rounds: number, seen: readonly string[]): CoachLesson | null {
  const p = luck.percentile
  if (p >= 0.97 && !seen.includes('L8')) {
    const better = luck.nullReturns.filter((x) => x > luck.playerReturn + 1e-9).length
    if (better > 0) {
      return {
        id: 'L8',
        title: '잘된 이야기만 들리면',
        line: `아무렇게나 놓아 본 ${luck.sims.toLocaleString('ko-KR')}번 중에도 ${better}번은 이번 판의 나보다 잘했어요. 크게 번 이야기만 들리면 운도 방법처럼 보이기 쉬워요.`,
      }
    }
  }
  if ((p >= 0.9 || p <= 0.1) && rounds >= 3 && !seen.includes('L7')) {
    const rank = Math.max(1, Math.round((p >= 0.5 ? 1 - p : p) * 100))
    return {
      id: 'L7',
      title: '한 판은 평범해지기 쉬워요',
      line: `이번 판은 무작위로 놓아 본 판들 중 ${p >= 0.5 ? '상위' : '하위'} ${rank}%였어요. 한 판의 극단적인 결과는 다음 판에 평범해지기 쉬워요. 한 판보다 여러 판을 모아 봐야 우연과 구별하기 쉬워져요.`,
    }
  }
  return null
}
