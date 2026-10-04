import { playPrice, type Market } from './market'
import { PRODUCTS } from './products'

export type Lesson = { title: string; line: string }

const pct = (x: number, digits = 1) => `${x > 0 ? '+' : x < 0 ? '-' : ''}${Math.abs(x * 100).toFixed(digits)}%`
const pp = (x: number, digits = 1) => `${x > 0 ? '+' : x < 0 ? '-' : ''}${Math.abs(x * 100).toFixed(digits)}%p`
/** Signed number from an integer count of tenths of a percent (12, '%p' -> "+1.2%p"). */
const tenths = (t: number, unit: '%' | '%p') => `${t > 0 ? '+' : t < 0 ? '-' : ''}${(Math.abs(t) / 10).toFixed(1)}${unit}`

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
          line: `"${filing.headline}" 뒤 금리가 ${pp(dy, 2)}, 채권은 ${pct(moveAfter(market, filing.impactAt))} 움직였어요. 이 채권은 듀레이션이 ${D}년이라, 금리가 1%p 움직이면 가격은 약 ${D}% 반대로 움직여요.`,
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
          line: `"${scare.headline}" 뒤 금이 ${pct(moveAfter(market, scare.impactAt))} 움직였어요. 그래서 금을 안전자산이라고 불러요.`,
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
          (rumors.length ? ` 뉴스 ${market.news.length}개 중 ${rumors.length}개가 지라시였고, 그중 ${wrong}개는 틀렸어요.` : ''),
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
      const pT = Math.round(p * 1000)
      const naiveT = Math.round(naive * 1000)
      const gapT = pT - naiveT
      const trendT = Math.round((compounded - (1 + naive)) * 1000)
      const dragT = gapT - trendT
      const split = `단순 ${L}배라면 ${tenths(naiveT, '%')}인데, 차이 ${tenths(gapT, '%p')} 중 추세 효과가 ${tenths(trendT, '%p')}, 매일 ${L}배로 다시 맞추면서 생긴 변동성 끌림이 ${tenths(dragT, '%p')}예요.`
      return {
        title: gapT < 0 ? '2배 상품은 출렁일수록 녹아요' : gapT > 0 ? '한 방향으로 쭉 가면 2배보다 더 벌어요' : '이번엔 거의 정확히 2배였어요',
        line:
          `지수 ${pct(u)}, 2배 상품 ${tenths(pT, '%')}. ${split}` +
          (isShort ? ' 끌림은 기간이 길수록 커져요. 장기 모드에서 1년치를 확인해 보세요.' : ''),
      }
    }
    default:
      return null
  }
}
