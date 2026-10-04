import { generateMarket, type RoundLength } from '../core/market'
import { PRODUCT_ORDER, PRODUCTS, type ProductKey } from '../core/products'
import { hashString } from '../core/rng'
import { save } from '../core/storage'
import type { Navigate } from './app'
import { h } from './dom'
import { openSheet } from './sheet'

export function startPractice(go: Navigate, product: ProductKey, length: RoundLength = 'short') {
  const seed = hashString(`practice/${product}/${length}/${Date.now()}/${Math.random()}`)
  go({ name: 'play', mode: { kind: 'practice' }, market: generateMarket(seed, product, length) })
}

/**
 * What each product is, in plain words. Shown in the picker instead of the
 * product pitch, so nothing locked sounds like a prize: leverage and coins
 * are described by how they hurt as much as how they move.
 */
const PLAIN: Record<ProductKey, string> = {
  stock: '한 회사의 주식이에요. 회사 소식에 따라 오르내려요.',
  bond: '나라나 회사에 돈을 빌려주는 거예요. 잔잔하고, 금리가 오르면 내려요.',
  gold: '평소엔 잔잔하고, 세상이 불안해지면 오르는 편이에요.',
  coin: '주식보다 두 배 넘게 출렁여요. 소문이 많고, 그중 반은 틀려요.',
  lev2: '오를 때도 내릴 때도 두 배로 움직이고, 오르락내리락하면 깎여요.',
}

/** Products open for practice right now. */
export function openProducts(): ProductKey[] {
  return PRODUCT_ORDER.filter((k) => save.isUnlocked(k))
}

/**
 * Bottom sheet: pick what to practice. Locked products say how to open them.
 * With only one product open there is nothing to pick, so it starts at once.
 */
export function showProductSheet(go: Navigate, length: RoundLength = 'short') {
  const open = openProducts()
  if (open.length === 1) {
    startPractice(go, open[0], length)
    return
  }
  const played = save.roundsPlayed()
  let close = () => {}
  const pick = (key: ProductKey) => () => {
    close()
    startPractice(go, key, length)
  }

  const rows = PRODUCT_ORDER.map((key) => {
    const p = PRODUCTS[key]
    const isOpen = open.includes(key)
    return h(
      'button',
      { class: `product-row${isOpen ? '' : ' locked'}`, onclick: isOpen ? pick(key) : undefined, disabled: !isOpen },
      h('span', { class: 'product-name' }, p.name, h('small', null, PLAIN[key])),
      h(
        'span',
        { class: 'product-state num' },
        isOpen ? h('span', { class: 'chev', 'aria-hidden': 'true' }, '›') : `${Math.max(1, p.unlockAt - played)}판 더`,
      ),
    )
  })

  const scrim = h(
    'div',
    {
      class: 'sheet-scrim',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'product-title',
      onclick: (e: Event) => e.target === scrim && close(),
    },
    h(
      'div',
      { class: 'sheet' },
      h('h2', { id: 'product-title' }, length === 'long' ? '1년을 5분에, 무엇으로 할까요?' : '무엇으로 연습할까요?'),
      h(
        'p',
        { class: 'sheet-body' },
        length === 'long'
          ? '장기 모드는 1년치 시장을 5분에 보여줘요. 짧은 판에서는 안 보이던 것들이 보여요.'
          : '한 번이라도 사고판 판을 할수록 새 상품이 열려요. 요일마다 오늘의 차트 상품도 바뀌어요.',
      ),
      h('div', { class: 'product-list' }, ...rows),
    ),
  )
  close = openSheet(scrim)
}
