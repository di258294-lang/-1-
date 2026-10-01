import { HISTORY_TICKS, PLAY_TICKS, playPrice, type Market } from './market'
import { PRODUCTS } from './products'

export type Lesson = { title: string; line: string }

const pct = (x: number, digits = 1) => `${x > 0 ? '+' : x < 0 ? '-' : ''}${Math.abs(x * 100).toFixed(digits)}%`

function range(market: Market) {
  let lo = Infinity
  let hi = 0
  for (let t = 0; t <= PLAY_TICKS; t++) {
    const p = playPrice(market, t)
    lo = Math.min(lo, p)
    hi = Math.max(hi, p)
  }
  return hi / lo - 1
}

/** Price move from just before a headline's impact to two seconds after. */
function moveAfter(market: Market, impactAt: number) {
  const from = Math.max(0, impactAt - 1)
  const to = Math.min(PLAY_TICKS, impactAt + 20)
  return playPrice(market, to) / playPrice(market, from) - 1
}

/**
 * What this round showed about the product itself, independent of how the
 * player traded. Stocks have none: the habit card already covers them.
 */
export function productLesson(market: Market): Lesson | null {
  const product = PRODUCTS[market.product]
  const filing = market.news.find((n) => n.kind === 'filing')

  switch (market.product) {
    case 'bond': {
      if (filing) {
        const move = moveAfter(market, filing.impactAt)
        return {
          title: '금리와 채권은 반대로 움직여요',
          line: `"${filing.headline}" 뒤 채권이 ${pct(move)} 움직였어요. 금리가 오를 거란 뉴스엔 이미 있는 채권의 값이 내리고, 내릴 거란 뉴스엔 올라요.`,
        }
      }
      return {
        title: '채권은 잔잔해요',
        line: `40초 동안 고점과 저점 차이가 ${pct(range(market))}였어요. 주식보다 훨씬 덜 움직여요.`,
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
        line: `이번 판은 큰 위기 뉴스가 없어서 고점과 저점 차이가 ${pct(range(market))}에 그쳤어요.`,
      }
    }
    case 'coin': {
      const rumors = market.news.filter((n) => n.kind === 'rumor')
      const wrong = rumors.filter((n) => n.actual !== n.implied).length
      return {
        title: '코인은 크게 출렁여요',
        line:
          `40초 동안 고점과 저점 차이가 ${pct(range(market))}였어요.` +
          (rumors.length ? ` 뉴스 ${market.news.length}개 중 ${rumors.length}개가 지라시였고, 그중 ${wrong}개는 틀렸어요.` : ''),
      }
    }
    case 'lev2': {
      const index = market.underlying!
      const u = index[HISTORY_TICKS + PLAY_TICKS] / index[HISTORY_TICKS] - 1
      const p = playPrice(market, PLAY_TICKS) / playPrice(market, 0) - 1
      const lev = product.leverage ?? 2
      const naive = lev * u
      const gap = p - naive
      if (gap < -0.003) {
        return {
          title: '2배 상품은 오르락내리락하면 녹아요',
          line: `지수는 ${pct(u)}, 2배 상품은 ${pct(p)}였어요. 정확히 2배라면 ${pct(naive)}였어야 해요. 매 순간 2배로 맞추다 보니, 출렁일수록 조금씩 깎여요. 이걸 변동성 끌림이라고 해요.`,
        }
      }
      if (gap > 0.003) {
        return {
          title: '한 방향으로 쭉 가면 2배보다 더 벌어요',
          line: `지수는 ${pct(u)}, 2배 상품은 ${pct(p)}로 2배(${pct(naive)})보다 더 움직였어요. 추세가 이어질 땐 유리하지만, 오르락내리락하는 날엔 반대로 녹아요.`,
        }
      }
      return {
        title: '이번엔 거의 정확히 2배였어요',
        line: `지수는 ${pct(u)}, 2배 상품은 ${pct(p)}였어요. 출렁임이 적은 날엔 계산대로 움직여요.`,
      }
    }
    default:
      return null
  }
}
