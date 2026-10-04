import type { Company } from './market'

/**
 * Statistical model of a product, in annualized terms so the same numbers
 * drive a one-month round and a one-year round. Volatilities sit near the
 * real asset classes (single Korean stock ~35%, KOSPI ~20%, gold ~15%,
 * 10y government bond price ~7%, large crypto ~75%).
 */
export type Model = {
  /**
   * Total annualized volatility. The engine splits this variance between
   * news jumps, trend regimes and tick noise, so a year of play swings about
   * as much as the real asset does.
   */
  sigma: number
  /** Degrees of freedom of the Student-t shocks; lower means fatter tails. */
  tailNu: number
  /** Expected headlines per trading day (Poisson arrivals). */
  newsPerDay: number
  /** Typical news jump as a log return (bonds: yield move in decimal). */
  jump: number
  /** Bonds are priced from a simulated yield instead of a price walk. */
  bond?: {
    yield0: number
    /** Total annualized volatility of the yield, in decimal (0.009 = 90bp). */
    sigmaYield: number
    /** Mean-reversion speed of the yield (Vasicek kappa, per year). */
    kappa: number
  }
}

/**
 * Tradable products. Each one moves differently so that playing it teaches
 * what that kind of asset is like. Every name and headline is invented.
 */
export type ProductKey = 'stock' | 'bond' | 'gold' | 'coin' | 'lev2'

type Headlines = { up: string[]; down: string[] }

export type Product = {
  key: ProductKey
  name: string
  /** One line shown before playing. */
  pitch: string
  /** Label for confirmed news. Rumors are always 지라시. */
  filingLabel: string
  /** How the asset is referred to in headlines during the round. */
  blindName: string
  assets: readonly Company[]
  filings: Headlines
  rumors: Headlines
  model: Model
  rumorShare: number
  fee: number
  priceRange: [number, number]
  /** Daily-rebalanced leverage on an underlying index. */
  leverage?: number
  /** Total finished rounds needed to open it in practice. */
  unlockAt: number
}

const STOCKS: readonly Company[] = [
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

export const PRODUCTS: Record<ProductKey, Product> = {
  stock: {
    key: 'stock',
    name: '주식',
    pitch: '공시와 지라시에 출렁이는 한 회사의 주식이에요.',
    filingLabel: '공시',
    blindName: '이 종목',
    assets: STOCKS,
    filings: {
      up: [
        '{n}, 1조 규모 공급계약 체결',
        '{n} 3분기 영업이익 예상치 상회',
        '{n}, 자사주 소각 결정',
        '{n} 신제품 사전예약 첫날 매진',
        '{n}, 해외 대형 파트너십 공시',
      ],
      down: [
        '{n} 대표이사 돌연 사임',
        '{n}, 대규모 유상증자 결정',
        '{n} 주력 공장 가동 중단',
        '{n} 3분기 적자 전환',
        '{n}, 제품 자발적 리콜 발표',
      ],
    },
    rumors: {
      up: ['{n} 인수합병설 확산', '{n}, 대기업 납품 임박설', '큰손이 {n} 모으고 있다는 소문', '{n} 실적 깜짝 개선 얘기 돌아'],
      down: ['{n} 회계 감리설 확산', '{n} 핵심 인력 대거 이탈설', '{n} 최대주주 지분 매각설', '{n} 계약 해지 가능성 제기'],
    },
    model: { sigma: 0.35, tailNu: 4, newsPerDay: 0.12, jump: 0.04 },
    rumorShare: 0.45,
    fee: 0.001,
    priceRange: [8000, 64000],
    unlockAt: 0,
  },
  bond: {
    key: 'bond',
    name: '채권',
    pitch: '잔잔하지만 금리 뉴스에는 반대로 움직여요.',
    filingLabel: '발표',
    blindName: '이 채권',
    assets: [
      { name: '가상 국고채 10년', code: 'KTB10', sector: '국채', duration: 8.5, convexity: 85 },
      { name: '가상 국고채 3년', code: 'KTB3', sector: '국채', duration: 2.8, convexity: 9 },
      { name: '가상 우량 회사채', code: 'CORP-AA', sector: '회사채', duration: 4.2, convexity: 21 },
    ],
    filings: {
      up: ['중앙은행, 기준금리 0.25%p 인하', '물가 상승률 예상보다 크게 둔화', '중앙은행 총재 "금리 인하 검토"', '경기 침체 우려 확산'],
      down: ['중앙은행, 기준금리 0.25%p 인상', '물가 상승률 석 달째 올라', '국채 대량 발행 계획 발표', '중앙은행 총재 "긴축 더 필요"'],
    },
    rumors: {
      up: ['이번 달 금리 내린다는 얘기 돌아', '큰손들이 국채 사들인다는 소문'],
      down: ['깜짝 금리 인상설 확산', '국채 발행 더 늘린다는 얘기 돌아'],
    },
    // Price comes from the yield: ln(1 + dP/P) = y*dt - D*dy + (C - D^2)/2*dy^2.
    // yield0 is ln(1.03), the continuous rate of 3% cash (CASH_RATE_ANNUAL), so carry matches cash.
    model: { sigma: 0, tailNu: 5, newsPerDay: 0.1, jump: 0.0015, bond: { yield0: Math.log(1.03), sigmaYield: 0.009, kappa: 0.5 } },
    rumorShare: 0.35,
    fee: 0.0005,
    priceRange: [95000, 110000],
    unlockAt: 1,
  },
  gold: {
    key: 'gold',
    name: '금',
    pitch: '평소엔 심심한데, 세상이 불안해지면 올라요.',
    filingLabel: '속보',
    blindName: '금',
    assets: [
      { name: '가상 금 현물', code: 'GOLD', sector: '원자재' },
      { name: '가상 금 선물', code: 'GOLD-F', sector: '원자재' },
    ],
    filings: {
      up: ['중동 긴장 급격히 고조', '증시 급락에 안전자산 쏠림', '각국 중앙은행 금 매입 확대', '달러 가치 급락'],
      down: ['휴전 협상 전격 타결', '달러 강세 이어져', '증시 사상 최고치 경신', '금리 인상에 금 매력 줄어'],
    },
    rumors: {
      up: ['대형 금융사가 금 사 모은다는 소문', '분쟁 더 커질 거라는 얘기 돌아'],
      down: ['중앙은행 금 매도설', '협상 곧 타결된다는 얘기 돌아'],
    },
    model: { sigma: 0.15, tailNu: 5, newsPerDay: 0.1, jump: 0.015 },
    rumorShare: 0.3,
    fee: 0.001,
    priceRange: [120000, 160000],
    unlockAt: 3,
  },
  coin: {
    key: 'coin',
    name: '코인',
    pitch: '주식의 두 배 넘게 출렁여요. 소문이 제일 많아요.',
    filingLabel: '공지',
    blindName: '이 코인',
    assets: [
      { name: '도토리코인', code: 'DTRC', sector: '가상자산' },
      { name: '구름체인', code: 'CLDC', sector: '가상자산' },
      { name: '두더지코인', code: 'DDJC', sector: '가상자산' },
      { name: '반딧불코인', code: 'BDBC', sector: '가상자산' },
      { name: '모래알토큰', code: 'SNDT', sector: '가상자산' },
    ],
    filings: {
      up: ['{n}, 대형 거래소 상장 확정', '{n} 재단, 대규모 소각 공지', '{n} 메인넷 업그레이드 성공'],
      down: ['{n}, 거래소 유의 종목 지정', '{n} 지갑 해킹 피해 공지', '{n} 재단 보유 물량 대량 해제'],
    },
    rumors: {
      up: ['유명 인플루언서가 {n} 샀다는 얘기', '{n} 곧 대형 호재 나온다는 소문', '고래 지갑이 {n} 모으는 중이라는 얘기'],
      down: ['{n} 개발자 잠적설', '{n} 상장폐지 가능성 제기', '큰손이 {n} 던진다는 소문'],
    },
    // tailNu 4: with nu = 3 the fourth moment of the shocks is infinite.
    model: { sigma: 0.75, tailNu: 4, newsPerDay: 0.15, jump: 0.07 },
    rumorShare: 0.75,
    fee: 0.0005,
    priceRange: [500, 5000],
    unlockAt: 5,
  },
  lev2: {
    key: 'lev2',
    name: '레버리지 2배',
    pitch: '지수가 움직인 만큼의 두 배로 움직여요. 그런데 진짜 두 배일까요?',
    filingLabel: '발표',
    blindName: '시장',
    assets: [
      { name: '가상 코리아지수 2배', code: 'KX2', sector: '레버리지' },
      { name: '가상 반도체지수 2배', code: 'SX2', sector: '레버리지' },
    ],
    filings: {
      up: ['외국인 하루 순매수 1조 넘어', '수출 실적 사상 최대', '주요 기업 실적 일제히 개선'],
      down: ['외국인 대규모 순매도', '수출 석 달 연속 감소', '해외 증시 급락 여파'],
    },
    rumors: {
      up: ['연기금이 대거 들어온다는 얘기', '정책 호재 곧 나온다는 소문'],
      down: ['대형 펀드 환매 쏟아진다는 얘기', '공매도 세력 몰려온다는 소문'],
    },
    // The model describes the index; the product is rebalanced to 2x daily.
    model: { sigma: 0.2, tailNu: 4, newsPerDay: 0.1, jump: 0.025 },
    rumorShare: 0.4,
    fee: 0.001,
    priceRange: [8000, 20000],
    leverage: 2,
    unlockAt: 8,
  },
}

export const PRODUCT_ORDER: readonly ProductKey[] = ['stock', 'bond', 'gold', 'coin', 'lev2']

/** Daily chart product by KST weekday, Sunday first. */
const WEEK: readonly ProductKey[] = ['stock', 'stock', 'bond', 'gold', 'stock', 'lev2', 'coin']

export function dailyProduct(dateKey: string): ProductKey {
  return WEEK[new Date(`${dateKey}T00:00:00Z`).getUTCDay()]
}

export const WEEKDAY_NAMES = ['일', '월', '화', '수', '목', '금', '토']
