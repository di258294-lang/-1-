import { createRng, type Rng } from './rng'

export const TICKS_PER_SECOND = 10
export const ROUND_SECONDS = 40
export const PLAY_TICKS = ROUND_SECONDS * TICKS_PER_SECOND
/** Ticks shown before the round starts, so the player has context. */
export const HISTORY_TICKS = 120
/** Headlines land this many ticks before the price reacts. */
export const NEWS_LEAD_TICKS = 16

export type Company = { name: string; code: string; sector: string }

export type NewsKind = 'filing' | 'rumor'

export type NewsEvent = {
  /** Play-relative tick when the headline appears. */
  at: number
  /** Play-relative tick when the price starts reacting. */
  impactAt: number
  kind: NewsKind
  /** Headline with the company name, shown after the round. */
  headline: string
  /** Same headline with the name hidden, shown during the round. */
  blindHeadline: string
  /** Direction the headline implies. */
  implied: 1 | -1
  /** Direction the price actually took. */
  actual: 1 | -1
}

export type Market = {
  seed: number
  company: Company
  /** Absolute series: HISTORY_TICKS + PLAY_TICKS + 1 prices. */
  prices: number[]
  news: NewsEvent[]
}

// Every company and headline is invented. Keep names playful so nobody
// mistakes them for listed firms.
export const COMPANIES: readonly Company[] = [
  { name: '하늘다람 모빌리티', code: 'HDRM', sector: '모빌리티' },
  { name: '고요한바이오', code: 'GYHB', sector: '바이오' },
  { name: '반딧불에너지', code: 'BDBE', sector: '에너지' },
  { name: '모래시계게임즈', code: 'MRSG', sector: '게임' },
  { name: '파란고래해운', code: 'PRGH', sector: '해운' },
  { name: '솔방울푸드', code: 'SBUF', sector: '식품' },
  { name: '구름다리건설', code: 'GRDG', sector: '건설' },
  { name: '달팽이로지스', code: 'DPLG', sector: '물류' },
  { name: '은하수반도체', code: 'EHSB', sector: '반도체' },
  { name: '초록사과제약', code: 'CRSG', sector: '제약' },
  { name: '종이비행기항공', code: 'JIBH', sector: '항공' },
  { name: '물결소프트', code: 'MGSF', sector: '소프트웨어' },
  { name: '호두로보틱스', code: 'HDRB', sector: '로봇' },
  { name: '민들레화학', code: 'MDRH', sector: '화학' },
  { name: '밤하늘엔터', code: 'BHNE', sector: '엔터' },
  { name: '꿀벌페이', code: 'GBPY', sector: '핀테크' },
  { name: '도토리리테일', code: 'DTRR', sector: '유통' },
  { name: '너구리배터리', code: 'NGRB', sector: '2차전지' },
  { name: '해바라기전자', code: 'HBRJ', sector: '전자' },
  { name: '펭귄냉동', code: 'PGND', sector: '냉동물류' },
]

const FILING_UP = [
  '{n}, 1조 규모 공급계약 체결',
  '{n} 3분기 영업이익 예상치 상회',
  '{n}, 자사주 소각 결정',
  '{n} 신제품 사전예약 첫날 매진',
  '{n}, 해외 대형 파트너십 공시',
]
const FILING_DOWN = [
  '{n} 대표이사 돌연 사임',
  '{n}, 대규모 유상증자 결정',
  '{n} 주력 공장 가동 중단',
  '{n} 3분기 적자 전환',
  '{n}, 제품 자발적 리콜 발표',
]
const RUMOR_UP = [
  '{n} 인수합병설 확산',
  '{n}, 대기업 납품 임박설',
  '큰손이 {n} 모으고 있다는 소문',
  '{n} 실적 깜짝 개선 얘기 돌아',
]
const RUMOR_DOWN = [
  '{n} 회계 감리설 확산',
  '{n} 핵심 인력 대거 이탈설',
  '{n} 최대주주 지분 매각설',
  '{n} 계약 해지 가능성 제기',
]

type RegimeKind = 'up' | 'down' | 'chop'

function headlines(template: string, company: Company) {
  return {
    headline: template.replace('{n}', company.name),
    blindHeadline: template.replace('{n}', '이 종목'),
  }
}

function planNews(rng: Rng, company: Company): NewsEvent[] {
  const count = rng.int(2, 3)
  const events: NewsEvent[] = []
  // Spread events across the round, leaving the first 4 seconds quiet.
  const slot = Math.floor((PLAY_TICKS - 60) / count)
  for (let i = 0; i < count; i++) {
    const at = 40 + i * slot + rng.int(0, slot - NEWS_LEAD_TICKS - 20)
    const kind: NewsKind = rng.chance(0.55) ? 'filing' : 'rumor'
    const implied: 1 | -1 = rng.chance(0.5) ? 1 : -1
    // Filings are facts. Rumors are a coin flip, so trading on them is gambling.
    const actual: 1 | -1 = kind === 'filing' || rng.chance(0.5) ? implied : ((-implied) as 1 | -1)
    const pool =
      kind === 'filing'
        ? implied > 0
          ? FILING_UP
          : FILING_DOWN
        : implied > 0
          ? RUMOR_UP
          : RUMOR_DOWN
    events.push({
      at,
      impactAt: at + NEWS_LEAD_TICKS,
      kind,
      ...headlines(rng.pick(pool), company),
      implied,
      actual,
    })
  }
  return events
}

export function generateMarket(seed: number): Market {
  const rng = createRng(seed)
  const company = rng.pick(COMPANIES)
  const news = planNews(rng, company)
  const total = HISTORY_TICKS + PLAY_TICKS + 1

  // Per-tick log-return drift and volatility for each regime.
  const regimeParams: Record<RegimeKind, () => { drift: number; vol: number }> = {
    up: () => ({ drift: rng.range(0.0007, 0.0016), vol: rng.range(0.0017, 0.0026) }),
    down: () => ({ drift: -rng.range(0.0007, 0.0018), vol: rng.range(0.0020, 0.0030) }),
    chop: () => ({ drift: rng.range(-0.00015, 0.00015), vol: rng.range(0.0022, 0.0032) }),
  }

  // Additive shocks keyed by absolute tick index.
  const shocks = new Map<number, number>()
  for (const ev of news) {
    // A false rumor hits as hard as a true one: the market punishes the crowd.
    const size = rng.range(0.045, 0.085)
    const spread = rng.int(3, 6)
    for (let k = 0; k < spread; k++) {
      const abs = HISTORY_TICKS + ev.impactAt + k
      shocks.set(abs, (shocks.get(abs) ?? 0) + (ev.actual * size) / spread)
    }
  }

  const prices = new Array<number>(total)
  let price = rng.range(8000, 64000)
  prices[0] = price

  let regime: RegimeKind = rng.pick(['up', 'down', 'chop'] as const)
  let params = regimeParams[regime]()
  let regimeLeft = rng.int(50, 130)
  // Small momentum term makes trends feel like trends rather than noise.
  let lastRet = 0

  for (let i = 1; i < total; i++) {
    if (regimeLeft-- <= 0) {
      const options: RegimeKind[] = (['up', 'down', 'chop'] as const).filter((r) => r !== regime)
      regime = rng.pick(options)
      params = regimeParams[regime]()
      regimeLeft = rng.int(50, 130)
    }
    const shock = shocks.get(i) ?? 0
    const ret = params.drift + params.vol * rng.gauss() + 0.18 * lastRet + shock
    lastRet = ret - shock
    price = price * Math.exp(ret)
    prices[i] = price
  }

  return { seed, company, prices, news }
}

/** Price at a play-relative tick (0 = round start). */
export function playPrice(market: Market, tick: number): number {
  return market.prices[HISTORY_TICKS + tick]
}
