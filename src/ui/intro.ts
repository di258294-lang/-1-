import { NEWS_LEAD_TICKS, TICKS_PER_SECOND } from '../core/market'
import { PRODUCT_ORDER, PRODUCTS } from '../core/products'
import { h } from './dom'
import { openSheet } from './sheet'

const pct = (x: number) => `${+(x * 100).toFixed(2)}%`

/** "0.05~0.1%" across every product, so the rule stays true as products change. */
function feeRange() {
  const fees = PRODUCT_ORDER.map((k) => PRODUCTS[k].fee)
  const lo = Math.min(...fees)
  const hi = Math.max(...fees)
  return lo === hi ? pct(lo) : `${+(lo * 100).toFixed(2)}~${pct(hi)}`
}

/** First-run rules. A few lines, one button. Esc closes without starting. */
export function showIntro(onDone: () => void) {
  const lead = `${(NEWS_LEAD_TICKS / TICKS_PER_SECOND).toFixed(1)}초`
  let close = () => {}
  const scrim = h(
    'div',
    { class: 'sheet-scrim', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'intro-title' },
    h(
      'div',
      { class: 'sheet' },
      h('h2', { id: 'intro-title' }, '누르고 있는 동안만', h('br'), '들고 있는 거예요'),
      h(
        'ul',
        { class: 'rules' },
        h('li', null, h('span', null, h('b', null, '손가락을 대면 사고, 떼면 팔아요.'), ' 한 판 동안 몇 번이든 괜찮아요.')),
        h('li', null, h('span', null, h('b', null, `사고팔 때마다 수수료 ${feeRange()}`), '가 빠져요. 너무 자주 누르면 손해예요.')),
        h('li', null, h('span', null, h('b', null, `뉴스가 뜨고 ${lead} 뒤에 가격이 움직여요.`), ' 공시는 믿어도 되지만 지라시는 반은 틀려요.')),
        h('li', null, h('span', null, h('b', null, '오늘의 차트 결과는 한 달 동안 계좌에 쌓여요.'), ' 판이 끝날 때마다 내 매매 습관도 알려줘요.')),
        h('li', null, h('span', null, '등장하는 회사와 뉴스는 모두 가상이고, 실제 돈은 오가지 않아요.')),
      ),
      h(
        'button',
        {
          class: 'btn btn-primary',
          onclick: () => {
            close()
            onDone()
          },
        },
        '알겠어요',
      ),
    ),
  )
  close = openSheet(scrim)
}
